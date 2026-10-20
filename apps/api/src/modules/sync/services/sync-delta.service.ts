/**
 * ZENTRA — Sync Delta Service
 * apps/api/src/modules/sync/services/sync-delta.service.ts
 *
 * Implements downstream row-level delta synchronization with opaque cursors:
 * - Scoped to user's authorized territory and assigned cases (zero cross-district leakage)
 * - Incremental updates based on server timestamps and tombstone sequences
 * - Bounded pagination with hasMore indicators
 * - Monotonic tombstone delivery for purging deleted mobile records
 * - Streams both service_cases and field_visits
 */

import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { decodeSyncCursor, encodeSyncCursor } from '../utils/sync-cursor';
import { RlsService } from '../../auth/rls.service';
import { resolveSecurityRole } from '../utils/sync-roles';
import type {
  SyncDeltaRequestQuery,
  SyncDeltaResponseData,
  SyncDeltaChangeItem,
  SyncTombstoneItem,
} from '@zentra/types';

@Injectable()
export class SyncDeltaService {
  constructor(
    @Inject(RlsService)
    private readonly rlsService: RlsService,
  ) {}

  /**
   * Fetches downstream delta changes and tombstones since the position represented by the opaque cursor.
   * Executes within transaction-local PostgreSQL RLS security context.
   */
  async fetchDelta(
    userId: string,
    userRoles: string[],
    query: SyncDeltaRequestQuery,
    activeRole?: string,
  ): Promise<SyncDeltaResponseData> {
    const role = resolveSecurityRole(userRoles, activeRole);

    return await this.rlsService.withSecurityContext(
      { userId, role },
      async (trx) => {
        const decoded = decodeSyncCursor(query.cursor);
        const { timestamp, tombstoneSeq, changeSeq, isLedgerCursor } = decoded;
        const cursorDate = new Date(timestamp);
        const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);

        const isMasterOrReporting =
          userRoles.includes('MASTER_ADMIN') || userRoles.includes('REPORTING_HEAD');

        let assignedDistrictIds: string[] = [];

        if (!isMasterOrReporting) {
          const userAssignments = await trx
            .selectFrom('user_territory_assignments')
            .where('user_id', '=', userId)
            .where((eb) =>
              eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', new Date())]),
            )
            .select(['district_id'])
            .execute();

          assignedDistrictIds = userAssignments.map((a) => a.district_id);
        }

        // --- Stage 6G Change Ledger Execution Path ---
        if (isLedgerCursor) {
          // 1. Watermark Retention Check
          const watermark = await trx
            .selectFrom('sync_retention_watermark')
            .where('watermark_id', '=', 1)
            .selectAll()
            .executeTakeFirst();

          if (watermark) {
            const minAvailableSeq = Number(watermark.min_available_seq ?? 1);
            const purgedThroughSeq = Number(watermark.purged_through_seq ?? 0);
            if (purgedThroughSeq > 0 && changeSeq < minAvailableSeq) {
              throw new HttpException(
                {
                  statusCode: 410,
                  error: 'Gone',
                  errorCode: 'CURSOR_EXPIRED_FULL_RESYNC_REQUIRED',
                  message:
                    'Delta cursor is older than the retention window. Complete local database re-sync is required.',
                },
                HttpStatus.GONE,
              );
            }
          }

          // 2. Query sync_change_ledger
          let ledgerQuery = trx
            .selectFrom('sync_change_ledger')
            .where('event_seq', '>', changeSeq)
            .selectAll()
            .orderBy('event_seq', 'asc')
            .limit(limit + 1);

          if (!isMasterOrReporting) {
            if (userRoles.includes('FIELD_ENGINEER')) {
              ledgerQuery = ledgerQuery.where((eb) =>
                eb.or([
                  eb('engineer_id', '=', userId),
                  eb('recipient_user_id', '=', userId),
                  eb(
                    'district_id',
                    'in',
                    assignedDistrictIds.length > 0
                      ? assignedDistrictIds
                      : ['00000000-0000-0000-0000-000000000000'],
                  ),
                ]),
              );
            } else if (userRoles.includes('DISTRICT_COORDINATOR')) {
              const districtList =
                assignedDistrictIds.length > 0
                  ? assignedDistrictIds
                  : ['00000000-0000-0000-0000-000000000000'];
              ledgerQuery = ledgerQuery.where('district_id', 'in', districtList);
            }
          }

          const fetchedEvents = await ledgerQuery.execute();
          const hasMore = fetchedEvents.length > limit;
          const events = hasMore ? fetchedEvents.slice(0, limit) : fetchedEvents;

          const changes: SyncDeltaChangeItem[] = [];
          const tombstones: SyncTombstoneItem[] = [];

          for (const ev of events) {
            const rawData = (ev.data as Record<string, any>) ?? {};
            if (ev.action === 'TOMBSTONE') {
              tombstones.push({
                entityType: ev.entity_type,
                entityId: ev.entity_id,
                deletedAt: new Date(ev.committed_at).toISOString(),
                reason: rawData.reason ?? 'DELETED',
              });
            } else {
              const formattedData = this.formatEntityData(ev.entity_type, rawData);
              changes.push({
                entityType: ev.entity_type,
                entityId: ev.entity_id,
                action: 'UPSERT',
                version: String(ev.version ?? 1),
                updatedAt: new Date(ev.committed_at).toISOString(),
                data: formattedData,
              });
            }
          }

          let nextChangeSeq = changeSeq;
          let latestTimestamp = cursorDate;
          if (events.length > 0) {
            nextChangeSeq = Number(events[events.length - 1]!.event_seq);
            const newestDate = new Date(events[events.length - 1]!.committed_at);
            if (newestDate > latestTimestamp) {
              latestTimestamp = newestDate;
            }
          }

          const nextCursor = encodeSyncCursor(latestTimestamp, tombstoneSeq, nextChangeSeq);

          return {
            changes,
            tombstones,
            nextCursor,
            hasMore,
            serverTimestamp: new Date().toISOString(),
          };
        }

        // --- Fallback: Legacy Downstream Query Path ---
        // 1. Query changed service cases
        let casesQuery = trx
          .selectFrom('service_cases')
      .innerJoin('schools', 'schools.school_id', 'service_cases.school_id')
      .where('service_cases.updated_at', '>', cursorDate)
      .where('service_cases.is_deleted', '=', false)
      .select([
        'service_cases.service_case_id',
        'service_cases.zentra_case_code',
        'service_cases.school_id',
        'service_cases.lab_id',
        'service_cases.lab_equipment_id',
        'service_cases.source_complaint_id',
        'service_cases.assigned_primary_engineer_id',
        'service_cases.assigned_secondary_engineer_id',
        'service_cases.operational_status',
        'service_cases.internal_priority',
        'service_cases.sla_target_at',
        'service_cases.actual_diagnosis_summary',
        'service_cases.actual_action_taken_summary',
        'service_cases.verification_status',
        'service_cases.created_at',
        'service_cases.updated_at',
      ])
      .orderBy('service_cases.updated_at', 'asc')
      .limit(limit + 1);

    // 2. Query changed field visits
    let visitsQuery = trx
      .selectFrom('field_visits')
      .innerJoin('service_cases', 'service_cases.service_case_id', 'field_visits.service_case_id')
      .innerJoin('schools', 'schools.school_id', 'service_cases.school_id')
      .where('field_visits.updated_at', '>', cursorDate)
      .where('field_visits.is_deleted', '=', false)
      .select([
        'field_visits.visit_id',
        'field_visits.service_case_id',
        'field_visits.engineer_id',
        'field_visits.visit_sequence_number',
        'field_visits.visit_date',
        'field_visits.status',
        'field_visits.check_in_timestamp',
        'field_visits.check_in_at_device',
        'field_visits.check_in_at_server',
        'field_visits.check_in_latitude',
        'field_visits.check_in_longitude',
        'field_visits.check_in_accuracy_meters',
        'field_visits.check_in_distance_meters',
        'field_visits.check_in_within_geofence',
        'field_visits.equipment_condition_observed',
        'field_visits.on_site_diagnosis',
        'field_visits.work_performed',
        'field_visits.visit_outcome',
        'field_visits.pending_reason_text',
        'field_visits.target_next_visit_date',
        'field_visits.check_out_timestamp',
        'field_visits.check_out_at_device',
        'field_visits.check_out_at_server',
        'field_visits.check_out_latitude',
        'field_visits.check_out_longitude',
        'field_visits.check_out_accuracy_meters',
        'field_visits.notes',
        'field_visits.version',
        'field_visits.client_operation_id',
        'field_visits.created_at',
        'field_visits.updated_at',
      ])
      .orderBy('field_visits.updated_at', 'asc')
      .limit(limit + 1);

    // 3. Query changed evidence files metadata (never binary media blobs)
    let evidenceQuery = trx
      .selectFrom('evidence_files')
      .innerJoin('field_visits', 'field_visits.visit_id', 'evidence_files.visit_id')
      .innerJoin('service_cases', 'service_cases.service_case_id', 'evidence_files.service_case_id')
      .innerJoin('schools', 'schools.school_id', 'service_cases.school_id')
      .where('evidence_files.updated_at', '>', cursorDate)
      .where('evidence_files.is_deleted', '=', false)
      .selectAll('evidence_files')
      .select([
        'schools.district_id as school_district_id',
        'field_visits.engineer_id as visit_engineer_id',
      ])
      .orderBy('evidence_files.updated_at', 'asc')
      .limit(limit + 1);

    // 4. Query changed conveyance claims
    let claimsQuery = trx
      .selectFrom('conveyance_claims')
      .innerJoin('field_visits', 'field_visits.visit_id', 'conveyance_claims.visit_id')
      .innerJoin('service_cases', 'service_cases.service_case_id', 'field_visits.service_case_id')
      .innerJoin('schools', 'schools.school_id', 'service_cases.school_id')
      .where('conveyance_claims.updated_at', '>', cursorDate)
      .where('conveyance_claims.is_deleted', '=', false)
      .selectAll('conveyance_claims')
      .select([
        'schools.district_id as school_district_id',
        'field_visits.engineer_id as visit_engineer_id',
      ])
      .orderBy('conveyance_claims.updated_at', 'asc')
      .limit(limit + 1);

    if (!isMasterOrReporting) {
      if (userRoles.includes('FIELD_ENGINEER')) {
        casesQuery = casesQuery.where((eb) =>
          eb.or([
            eb('service_cases.assigned_primary_engineer_id', '=', userId),
            eb('service_cases.assigned_secondary_engineer_id', '=', userId),
            eb(
              'schools.district_id',
              'in',
              assignedDistrictIds.length > 0 ? assignedDistrictIds : ['00000000-0000-0000-0000-000000000000'],
            ),
          ]),
        );

        visitsQuery = visitsQuery.where((eb) =>
          eb.or([
            eb('field_visits.engineer_id', '=', userId),
            eb('service_cases.assigned_primary_engineer_id', '=', userId),
            eb('service_cases.assigned_secondary_engineer_id', '=', userId),
            eb(
              'schools.district_id',
              'in',
              assignedDistrictIds.length > 0 ? assignedDistrictIds : ['00000000-0000-0000-0000-000000000000'],
            ),
          ]),
        );

        evidenceQuery = evidenceQuery.where((eb) =>
          eb.or([
            eb('field_visits.engineer_id', '=', userId),
            eb('evidence_files.created_by_user_id', '=', userId),
            eb('service_cases.assigned_primary_engineer_id', '=', userId),
            eb('service_cases.assigned_secondary_engineer_id', '=', userId),
            eb(
              'schools.district_id',
              'in',
              assignedDistrictIds.length > 0 ? assignedDistrictIds : ['00000000-0000-0000-0000-000000000000'],
            ),
          ]),
        );

        claimsQuery = claimsQuery.where((eb) =>
          eb.or([
            eb('conveyance_claims.engineer_id', '=', userId),
            eb('field_visits.engineer_id', '=', userId),
            eb(
              'schools.district_id',
              'in',
              assignedDistrictIds.length > 0 ? assignedDistrictIds : ['00000000-0000-0000-0000-000000000000'],
            ),
          ]),
        );
      } else if (userRoles.includes('DISTRICT_COORDINATOR')) {
        const districtList = assignedDistrictIds.length > 0 ? assignedDistrictIds : ['00000000-0000-0000-0000-000000000000'];
        casesQuery = casesQuery.where('schools.district_id', 'in', districtList);
        visitsQuery = visitsQuery.where('schools.district_id', 'in', districtList);
        evidenceQuery = evidenceQuery.where('schools.district_id', 'in', districtList);
        claimsQuery = claimsQuery.where('schools.district_id', 'in', districtList);
      }
    }

    const fetchedCases = await casesQuery.execute();
    const hasMoreCases = fetchedCases.length > limit;
    const cases = hasMoreCases ? fetchedCases.slice(0, limit) : fetchedCases;

    const fetchedVisits = await visitsQuery.execute();
    const hasMoreVisits = fetchedVisits.length > limit;
    const visits = hasMoreVisits ? fetchedVisits.slice(0, limit) : fetchedVisits;

    const fetchedEvidence = await evidenceQuery.execute();
    const hasMoreEvidence = fetchedEvidence.length > limit;
    const evidenceList = hasMoreEvidence ? fetchedEvidence.slice(0, limit) : fetchedEvidence;

    const fetchedClaims = await claimsQuery.execute();
    const hasMoreClaims = fetchedClaims.length > limit;
    const claimsList = hasMoreClaims ? fetchedClaims.slice(0, limit) : fetchedClaims;

    // 5. Query tombstones
    const fetchedTombstones = await trx
      .selectFrom('tombstones')
      .where('sync_sequence_number', '>', tombstoneSeq)
      .where('entity_type', 'in', ['service_cases', 'field_visits', 'evidence_files', 'conveyance_claims'])
      .selectAll()
      .orderBy('sync_sequence_number', 'asc')
      .limit(limit)
      .execute();

    // 4. Transform into response changes
    const caseChanges: SyncDeltaChangeItem[] = cases.map((c) => ({
      entityType: 'service_cases',
      entityId: c.service_case_id,
      action: 'UPSERT',
      version: String((c as any).version ?? 1),
      updatedAt: new Date(c.updated_at).toISOString(),
      data: {
        serviceCaseId: c.service_case_id,
        zentraCaseCode: c.zentra_case_code,
        version: Number((c as any).version ?? 1),
        schoolId: c.school_id,
        labId: c.lab_id,
        labEquipmentId: c.lab_equipment_id,
        sourceComplaintId: c.source_complaint_id,
        assignedPrimaryEngineerId: c.assigned_primary_engineer_id,
        assignedSecondaryEngineerId: c.assigned_secondary_engineer_id,
        operationalStatus: c.operational_status,
        internalPriority: c.internal_priority,
        slaTargetAt: c.sla_target_at ? new Date(c.sla_target_at).toISOString() : null,
        actualDiagnosisSummary: c.actual_diagnosis_summary,
        actualActionTakenSummary: c.actual_action_taken_summary,
        verificationStatus: c.verification_status,
        createdAt: new Date(c.created_at).toISOString(),
        updatedAt: new Date(c.updated_at).toISOString(),
      },
    }));

    const visitChanges: SyncDeltaChangeItem[] = visits.map((v) => ({
      entityType: 'field_visits',
      entityId: v.visit_id,
      action: 'UPSERT',
      version: String(v.version ?? 1),
      updatedAt: new Date(v.updated_at).toISOString(),
      data: {
        visitId: v.visit_id,
        serviceCaseId: v.service_case_id,
        engineerId: v.engineer_id,
        visitSequenceNumber: Number(v.visit_sequence_number),
        visitDate: v.visit_date instanceof Date ? v.visit_date.toISOString().split('T')[0]! : String(v.visit_date),
        status: v.status,
        checkInTimestamp: v.check_in_timestamp ? new Date(v.check_in_timestamp).toISOString() : null,
        checkInAtDevice: v.check_in_at_device ? new Date(v.check_in_at_device).toISOString() : null,
        checkInAtServer: v.check_in_at_server ? new Date(v.check_in_at_server).toISOString() : null,
        checkInLatitude: v.check_in_latitude !== null ? Number(v.check_in_latitude) : null,
        checkInLongitude: v.check_in_longitude !== null ? Number(v.check_in_longitude) : null,
        checkInAccuracyMeters: v.check_in_accuracy_meters !== null ? Number(v.check_in_accuracy_meters) : null,
        checkInDistanceMeters: v.check_in_distance_meters !== null ? Number(v.check_in_distance_meters) : null,
        checkInWithinGeofence: v.check_in_within_geofence !== null ? Boolean(v.check_in_within_geofence) : null,
        equipmentConditionObserved: v.equipment_condition_observed,
        onSiteDiagnosis: v.on_site_diagnosis,
        workPerformed: v.work_performed,
        visitOutcome: v.visit_outcome,
        pendingReasonText: v.pending_reason_text,
        targetNextVisitDate: v.target_next_visit_date instanceof Date ? v.target_next_visit_date.toISOString().split('T')[0]! : (v.target_next_visit_date ? String(v.target_next_visit_date) : null),
        checkOutTimestamp: v.check_out_timestamp ? new Date(v.check_out_timestamp).toISOString() : null,
        checkOutAtDevice: v.check_out_at_device ? new Date(v.check_out_at_device).toISOString() : null,
        checkOutAtServer: v.check_out_at_server ? new Date(v.check_out_at_server).toISOString() : null,
        checkOutLatitude: v.check_out_latitude !== null ? Number(v.check_out_latitude) : null,
        checkOutLongitude: v.check_out_longitude !== null ? Number(v.check_out_longitude) : null,
        checkOutAccuracyMeters: v.check_out_accuracy_meters !== null ? Number(v.check_out_accuracy_meters) : null,
        notes: v.notes,
        version: Number(v.version ?? 1),
        clientOperationId: v.client_operation_id,
        createdAt: new Date(v.created_at).toISOString(),
        updatedAt: new Date(v.updated_at).toISOString(),
      },
    }));

    const evidenceChanges: SyncDeltaChangeItem[] = evidenceList.map((e) => ({
      entityType: 'evidence_files',
      entityId: e.evidence_file_id,
      action: 'UPSERT',
      version: String((e as any).version ?? 1),
      updatedAt: new Date(e.updated_at).toISOString(),
      data: {
        evidenceId: e.evidence_file_id,
        visitId: e.visit_id,
        serviceCaseId: e.service_case_id,
        evidenceSlot: e.evidence_slot,
        evidenceType: e.evidence_type,
        localMediaId: e.local_media_id,
        storagePath: e.storage_path,
        objectStorageProvider: e.object_storage_provider,
        mimeType: e.mime_type,
        fileSizeBytes: Number(e.file_size_bytes),
        fileChecksumSha256: e.file_checksum_sha256,
        capturedAt: new Date(e.captured_at).toISOString(),
        uploadedAt: e.uploaded_at ? new Date(e.uploaded_at).toISOString() : null,
        uploadStatus: e.upload_status,
        gpsLatitude: e.gps_latitude !== null ? Number(e.gps_latitude) : null,
        gpsLongitude: e.gps_longitude !== null ? Number(e.gps_longitude) : null,
        gpsAccuracyMeters: e.gps_accuracy_meters !== null ? Number(e.gps_accuracy_meters) : null,
        isVerified: e.is_verified,
        version: Number((e as any).version ?? 1),
        createdAt: new Date(e.created_at).toISOString(),
        updatedAt: new Date(e.updated_at).toISOString(),
      },
    }));

    const claimChanges: SyncDeltaChangeItem[] = claimsList.map((c) => ({
      entityType: 'conveyance_claims',
      entityId: c.conveyance_claim_id,
      action: 'UPSERT',
      version: String(c.version ?? 1),
      updatedAt: new Date(c.updated_at).toISOString(),
      data: {
        claimId: c.conveyance_claim_id,
        fieldVisitId: c.visit_id,
        engineerId: c.engineer_id,
        travelMode: c.travel_mode,
        startingOdometerKm: c.starting_odometer_km !== null ? Number(c.starting_odometer_km) : null,
        endingOdometerKm: c.ending_odometer_km !== null ? Number(c.ending_odometer_km) : null,
        claimedDistanceKm: Number(c.claimed_distance_km),
        appliedRatePerKm: Number(c.applied_rate_per_km),
        calculatedAmount: Number(c.calculated_amount),
        approvedAmount: c.approved_amount !== null ? Number(c.approved_amount) : null,
        status: c.claim_status,
        ratePolicyVersion: c.rate_policy_version,
        isProvisionalPolicy: Boolean(c.is_provisional_policy),
        notes: c.remarks,
        reviewerNotes: c.correction_notes,
        rejectionReason: c.rejection_reason,
        version: Number(c.version ?? 1),
        createdAt: new Date(c.created_at).toISOString(),
        updatedAt: new Date(c.updated_at).toISOString(),
      },
    }));

    // Combine and sort chronologically by updatedAt
    const allChanges = [...caseChanges, ...visitChanges, ...evidenceChanges, ...claimChanges].sort((a, b) => {
      const timeDiff = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.entityId.localeCompare(b.entityId);
    });

    const hasMoreChanges = allChanges.length > limit;
    const boundedChanges = hasMoreChanges ? allChanges.slice(0, limit) : allChanges;

    // 5. Calculate new cursor
    let latestTimestamp = cursorDate;
    if (boundedChanges.length > 0) {
      const newestDate = new Date(boundedChanges[boundedChanges.length - 1]!.updatedAt);
      if (newestDate > latestTimestamp) {
        latestTimestamp = newestDate;
      }
    }

    let latestTombstoneSeq = tombstoneSeq;
    if (fetchedTombstones.length > 0) {
      const newestSeq = Number(fetchedTombstones[fetchedTombstones.length - 1]!.sync_sequence_number);
      if (newestSeq > latestTombstoneSeq) {
        latestTombstoneSeq = newestSeq;
      }
    }

    const nextCursor = encodeSyncCursor(latestTimestamp, latestTombstoneSeq);

    const tombstones: SyncTombstoneItem[] = fetchedTombstones.map((t) => ({
      entityType: t.entity_type,
      entityId: t.entity_id,
      deletedAt: new Date(t.deleted_at).toISOString(),
      reason: t.tombstone_reason,
    }));

    return {
      changes: boundedChanges,
      tombstones,
      nextCursor,
      hasMore: hasMoreChanges || hasMoreCases || hasMoreVisits || hasMoreEvidence || hasMoreClaims,
      serverTimestamp: new Date().toISOString(),
    };
      },
    );
  }

  private formatEntityData(
    entityType: string,
    raw: Record<string, any>,
  ): Record<string, any> {
    if (entityType === 'service_cases') {
      return {
        serviceCaseId: raw.serviceCaseId ?? raw.service_case_id,
        zentraCaseCode: raw.zentraCaseCode ?? raw.zentra_case_code,
        version: Number(raw.version ?? 1),
        schoolId: raw.schoolId ?? raw.school_id,
        labId: raw.labId ?? raw.lab_id,
        labEquipmentId: raw.labEquipmentId ?? raw.lab_equipment_id,
        sourceComplaintId: raw.sourceComplaintId ?? raw.source_complaint_id,
        assignedPrimaryEngineerId:
          raw.assignedPrimaryEngineerId ?? raw.assigned_primary_engineer_id,
        assignedSecondaryEngineerId:
          raw.assignedSecondaryEngineerId ?? raw.assigned_secondary_engineer_id,
        operationalStatus: raw.operationalStatus ?? raw.operational_status,
        internalPriority: raw.internalPriority ?? raw.internal_priority,
        slaTargetAt: raw.slaTargetAt
          ? new Date(raw.slaTargetAt).toISOString()
          : raw.sla_target_at
            ? new Date(raw.sla_target_at).toISOString()
            : null,
        actualDiagnosisSummary:
          raw.actualDiagnosisSummary ?? raw.actual_diagnosis_summary,
        actualActionTakenSummary:
          raw.actualActionTakenSummary ?? raw.actual_action_taken_summary,
        verificationStatus: raw.verificationStatus ?? raw.verification_status,
        createdAt: new Date(raw.createdAt ?? raw.created_at).toISOString(),
        updatedAt: new Date(raw.updatedAt ?? raw.updated_at).toISOString(),
      };
    }

    if (entityType === 'field_visits') {
      return {
        visitId: raw.visitId ?? raw.visit_id,
        serviceCaseId: raw.serviceCaseId ?? raw.service_case_id,
        engineerId: raw.engineerId ?? raw.engineer_id,
        visitSequenceNumber: Number(
          raw.visitSequenceNumber ?? raw.visit_sequence_number ?? 1,
        ),
        visitDate:
          raw.visitDate instanceof Date
            ? raw.visitDate.toISOString().split('T')[0]!
            : typeof raw.visit_date === 'string'
              ? raw.visit_date.split('T')[0]!
              : String(raw.visitDate ?? raw.visit_date),
        status: raw.status,
        checkInTimestamp: raw.checkInTimestamp
          ? new Date(raw.checkInTimestamp).toISOString()
          : raw.check_in_timestamp
            ? new Date(raw.check_in_timestamp).toISOString()
            : null,
        checkInAtDevice: raw.checkInAtDevice
          ? new Date(raw.checkInAtDevice).toISOString()
          : raw.check_in_at_device
            ? new Date(raw.check_in_at_device).toISOString()
            : null,
        checkInAtServer: raw.checkInAtServer
          ? new Date(raw.checkInAtServer).toISOString()
          : raw.check_in_at_server
            ? new Date(raw.check_in_at_server).toISOString()
            : null,
        checkInLatitude:
          raw.checkInLatitude !== undefined && raw.checkInLatitude !== null
            ? Number(raw.checkInLatitude)
            : raw.check_in_latitude !== null && raw.check_in_latitude !== undefined
              ? Number(raw.check_in_latitude)
              : null,
        checkInLongitude:
          raw.checkInLongitude !== undefined && raw.checkInLongitude !== null
            ? Number(raw.checkInLongitude)
            : raw.check_in_longitude !== null && raw.check_in_longitude !== undefined
              ? Number(raw.check_in_longitude)
              : null,
        checkInAccuracyMeters:
          raw.checkInAccuracyMeters !== undefined && raw.checkInAccuracyMeters !== null
            ? Number(raw.checkInAccuracyMeters)
            : raw.check_in_accuracy_meters !== null && raw.check_in_accuracy_meters !== undefined
              ? Number(raw.check_in_accuracy_meters)
              : null,
        checkInDistanceMeters:
          raw.checkInDistanceMeters !== undefined && raw.checkInDistanceMeters !== null
            ? Number(raw.checkInDistanceMeters)
            : raw.check_in_distance_meters !== null && raw.check_in_distance_meters !== undefined
              ? Number(raw.check_in_distance_meters)
              : null,
        checkInWithinGeofence:
          raw.checkInWithinGeofence !== undefined && raw.checkInWithinGeofence !== null
            ? Boolean(raw.checkInWithinGeofence)
            : raw.check_in_within_geofence !== null && raw.check_in_within_geofence !== undefined
              ? Boolean(raw.check_in_within_geofence)
              : null,
        equipmentConditionObserved:
          raw.equipmentConditionObserved ?? raw.equipment_condition_observed,
        onSiteDiagnosis: raw.onSiteDiagnosis ?? raw.on_site_diagnosis,
        workPerformed: raw.workPerformed ?? raw.work_performed,
        visitOutcome: raw.visitOutcome ?? raw.visit_outcome,
        pendingReasonText: raw.pendingReasonText ?? raw.pending_reason_text,
        targetNextVisitDate: raw.targetNextVisitDate
          ? String(raw.targetNextVisitDate)
          : raw.target_next_visit_date
            ? String(raw.target_next_visit_date)
            : null,
        checkOutTimestamp: raw.checkOutTimestamp
          ? new Date(raw.checkOutTimestamp).toISOString()
          : raw.check_out_timestamp
            ? new Date(raw.check_out_timestamp).toISOString()
            : null,
        checkOutAtDevice: raw.checkOutAtDevice
          ? new Date(raw.checkOutAtDevice).toISOString()
          : raw.check_out_at_device
            ? new Date(raw.check_out_at_device).toISOString()
            : null,
        checkOutAtServer: raw.checkOutAtServer
          ? new Date(raw.checkOutAtServer).toISOString()
          : raw.check_out_at_server
            ? new Date(raw.check_out_at_server).toISOString()
            : null,
        checkOutLatitude:
          raw.checkOutLatitude !== undefined && raw.checkOutLatitude !== null
            ? Number(raw.checkOutLatitude)
            : raw.check_out_latitude !== null && raw.check_out_latitude !== undefined
              ? Number(raw.check_out_latitude)
              : null,
        checkOutLongitude:
          raw.checkOutLongitude !== undefined && raw.checkOutLongitude !== null
            ? Number(raw.checkOutLongitude)
            : raw.check_out_longitude !== null && raw.check_out_longitude !== undefined
              ? Number(raw.check_out_longitude)
              : null,
        checkOutAccuracyMeters:
          raw.checkOutAccuracyMeters !== undefined && raw.checkOutAccuracyMeters !== null
            ? Number(raw.checkOutAccuracyMeters)
            : raw.check_out_accuracy_meters !== null && raw.check_out_accuracy_meters !== undefined
              ? Number(raw.check_out_accuracy_meters)
              : null,
        notes: raw.notes,
        version: Number(raw.version ?? 1),
        clientOperationId: raw.clientOperationId ?? raw.client_operation_id,
        createdAt: new Date(raw.createdAt ?? raw.created_at).toISOString(),
        updatedAt: new Date(raw.updatedAt ?? raw.updated_at).toISOString(),
      };
    }

    if (entityType === 'evidence_files') {
      return {
        evidenceId: raw.evidenceId ?? raw.evidence_file_id,
        visitId: raw.visitId ?? raw.visit_id,
        serviceCaseId: raw.serviceCaseId ?? raw.service_case_id,
        evidenceSlot: raw.evidenceSlot ?? raw.evidence_slot,
        evidenceType: raw.evidenceType ?? raw.evidence_type,
        localMediaId: raw.localMediaId ?? raw.local_media_id,
        storagePath: raw.storagePath ?? raw.storage_path,
        objectStorageProvider:
          raw.objectStorageProvider ?? raw.object_storage_provider,
        mimeType: raw.mimeType ?? raw.mime_type,
        fileSizeBytes: Number(raw.fileSizeBytes ?? raw.file_size_bytes ?? 0),
        fileChecksumSha256: raw.fileChecksumSha256 ?? raw.file_checksum_sha256,
        capturedAt: new Date(raw.capturedAt ?? raw.captured_at).toISOString(),
        uploadedAt: raw.uploadedAt
          ? new Date(raw.uploadedAt).toISOString()
          : raw.uploaded_at
            ? new Date(raw.uploaded_at).toISOString()
            : null,
        uploadStatus: raw.uploadStatus ?? raw.upload_status,
        gpsLatitude:
          raw.gpsLatitude !== undefined && raw.gpsLatitude !== null
            ? Number(raw.gpsLatitude)
            : raw.gps_latitude !== null && raw.gps_latitude !== undefined
              ? Number(raw.gps_latitude)
              : null,
        gpsLongitude:
          raw.gpsLongitude !== undefined && raw.gpsLongitude !== null
            ? Number(raw.gpsLongitude)
            : raw.gps_longitude !== null && raw.gps_longitude !== undefined
              ? Number(raw.gps_longitude)
              : null,
        gpsAccuracyMeters:
          raw.gpsAccuracyMeters !== undefined && raw.gpsAccuracyMeters !== null
            ? Number(raw.gpsAccuracyMeters)
            : raw.gps_accuracy_meters !== null && raw.gps_accuracy_meters !== undefined
              ? Number(raw.gps_accuracy_meters)
              : null,
        isVerified: Boolean(raw.isVerified ?? raw.is_verified),
        version: Number(raw.version ?? 1),
        createdAt: new Date(raw.createdAt ?? raw.created_at).toISOString(),
        updatedAt: new Date(raw.updatedAt ?? raw.updated_at).toISOString(),
      };
    }

    if (entityType === 'conveyance_claims') {
      return {
        claimId: raw.claimId ?? raw.conveyance_claim_id,
        fieldVisitId: raw.fieldVisitId ?? raw.visit_id,
        engineerId: raw.engineerId ?? raw.engineer_id,
        travelMode: raw.travelMode ?? raw.travel_mode,
        startingOdometerKm:
          raw.startingOdometerKm !== undefined && raw.startingOdometerKm !== null
            ? Number(raw.startingOdometerKm)
            : raw.starting_odometer_km !== null && raw.starting_odometer_km !== undefined
              ? Number(raw.starting_odometer_km)
              : null,
        endingOdometerKm:
          raw.endingOdometerKm !== undefined && raw.endingOdometerKm !== null
            ? Number(raw.endingOdometerKm)
            : raw.ending_odometer_km !== null && raw.ending_odometer_km !== undefined
              ? Number(raw.ending_odometer_km)
              : null,
        claimedDistanceKm: Number(raw.claimedDistanceKm ?? raw.claimed_distance_km ?? 0),
        appliedRatePerKm: Number(raw.appliedRatePerKm ?? raw.applied_rate_per_km ?? 0),
        calculatedAmount: Number(raw.calculatedAmount ?? raw.calculated_amount ?? 0),
        approvedAmount:
          raw.approvedAmount !== undefined && raw.approvedAmount !== null
            ? Number(raw.approvedAmount)
            : raw.approved_amount !== null && raw.approved_amount !== undefined
              ? Number(raw.approved_amount)
              : null,
        status: raw.status ?? raw.claim_status,
        ratePolicyVersion: Number(raw.ratePolicyVersion ?? raw.rate_policy_version ?? 1),
        isProvisionalPolicy: Boolean(
          raw.isProvisionalPolicy ?? raw.is_provisional_policy,
        ),
        notes: raw.notes ?? raw.remarks,
        reviewerNotes: raw.reviewerNotes ?? raw.correction_notes,
        rejectionReason: raw.rejectionReason ?? raw.rejection_reason,
        version: Number(raw.version ?? 1),
        createdAt: new Date(raw.createdAt ?? raw.created_at).toISOString(),
        updatedAt: new Date(raw.updatedAt ?? raw.updated_at).toISOString(),
      };
    }

    return raw;
  }
}

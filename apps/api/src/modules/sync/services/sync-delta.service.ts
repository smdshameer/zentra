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

import { Injectable, Inject } from '@nestjs/common';
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
        const { timestamp, tombstoneSeq } = decodeSyncCursor(query.cursor);
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
}

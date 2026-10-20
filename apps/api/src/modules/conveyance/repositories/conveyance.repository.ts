/**
 * ZENTRA — Conveyance Claims Repository (Phase 15)
 * apps/api/src/modules/conveyance/repositories/conveyance.repository.ts
 *
 * Implements Kysely data access, multi-hop lineage retrieval,
 * territory-isolated filtering, and administrative audit logging.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema } from '../../../database/database.types';
import type {
  ConveyanceClaim,
  ConveyanceSummaryStats,
  ConveyanceQueryFilters,
} from '@zentra/types';
import { generateUuidV7 } from '@zentra/shared';

export interface ClaimLineage {
  conveyanceClaimId: string;
  visitId: string;
  serviceCaseId: string;
  engineerId: string;
  districtId: string;
  schoolId: string;
  claimStatus: string;
  version: number;
}

@Injectable()
export class ConveyanceRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  /**
   * Inserts a new conveyance claim record into PostgreSQL.
   */
  async create(data: {
    conveyance_claim_id: string;
    visit_id: string;
    service_case_id: string;
    engineer_id: string;
    policy_id: string | null;
    travel_date: string;
    from_location: string;
    to_location: string;
    travel_mode: string;
    starting_odometer_km?: number | null;
    ending_odometer_km?: number | null;
    calculated_odometer_distance_km?: number | null;
    gps_distance_km?: number | null;
    captured_distance_km?: number | null;
    claimed_distance_km: number;
    approved_distance_km?: number | null;
    applied_rate_per_km: number;
    rate_policy_version: number;
    is_provisional_policy: boolean;
    calculated_amount: number;
    claimed_amount: number;
    approved_amount?: number | null;
    supporting_evidence_file_id?: string | null;
    claim_status: string;
    submitted_at?: Date | null;
    submitted_by_user_id?: string | null;
    remarks?: string | null;
    version?: number;
    client_operation_id?: string | null;
  }) {
    return this.db
      .insertInto('conveyance_claims')
      .values({
        conveyance_claim_id: data.conveyance_claim_id,
        visit_id: data.visit_id,
        service_case_id: data.service_case_id,
        engineer_id: data.engineer_id,
        submitted_by_user_id: data.submitted_by_user_id ?? null,
        policy_id: data.policy_id,
        travel_date: data.travel_date,
        from_location: data.from_location,
        to_location: data.to_location,
        travel_mode: data.travel_mode,
        starting_odometer_km: data.starting_odometer_km ?? null,
        ending_odometer_km: data.ending_odometer_km ?? null,
        calculated_odometer_distance_km: data.calculated_odometer_distance_km ?? null,
        gps_distance_km: data.gps_distance_km ?? null,
        captured_distance_km: data.captured_distance_km ?? null,
        claimed_distance_km: data.claimed_distance_km,
        approved_distance_km: data.approved_distance_km ?? null,
        applied_rate_per_km: data.applied_rate_per_km,
        rate_policy_version: data.rate_policy_version,
        is_provisional_policy: data.is_provisional_policy,
        calculated_amount: data.calculated_amount,
        claimed_amount: data.claimed_amount,
        approved_amount: data.approved_amount ?? null,
        supporting_evidence_file_id: data.supporting_evidence_file_id ?? null,
        claim_status: data.claim_status,
        submitted_at: data.submitted_at ?? null,
        remarks: data.remarks ?? null,
        version: data.version ?? 1,
        client_operation_id: data.client_operation_id ?? null,
        is_tombstoned: false,
        is_deleted: false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Finds an active conveyance claim by its primary key.
   */
  async findById(claimId: string) {
    return this.db
      .selectFrom('conveyance_claims')
      .selectAll()
      .where('conveyance_claim_id', '=', claimId)
      .where('is_deleted', '=', false)
      .executeTakeFirst();
  }

  /**
   * Finds an active conveyance claim for a given field visit (duplicate prevention).
   */
  async findByVisitId(visitId: string) {
    return this.db
      .selectFrom('conveyance_claims')
      .selectAll()
      .where('visit_id', '=', visitId)
      .where('is_deleted', '=', false)
      .where('is_tombstoned', '=', false)
      .executeTakeFirst();
  }

  /**
   * Retrieves deterministic lineage for a conveyance claim:
   * Claim -> Visit -> Service Case -> School -> District
   */
  async getClaimLineage(claimId: string): Promise<ClaimLineage | null> {
    const res = await this.db
      .selectFrom('conveyance_claims as c')
      .innerJoin('field_visits as fv', 'fv.visit_id', 'c.visit_id')
      .innerJoin('service_cases as sc', 'sc.service_case_id', 'c.service_case_id')
      .innerJoin('schools as s', 's.school_id', 'sc.school_id')
      .select([
        'c.conveyance_claim_id as conveyanceClaimId',
        'c.visit_id as visitId',
        'c.service_case_id as serviceCaseId',
        'c.engineer_id as engineerId',
        'c.claim_status as claimStatus',
        'c.version as version',
        's.district_id as districtId',
        's.school_id as schoolId',
      ])
      .where('c.conveyance_claim_id', '=', claimId)
      .where('c.is_deleted', '=', false)
      .executeTakeFirst();

    return res ? (res as ClaimLineage) : null;
  }

  /**
   * Retrieves an enriched conveyance claim with joined human-readable labels.
   */
  async findEnrichedById(claimId: string): Promise<ConveyanceClaim | null> {
    const row = await this.db
      .selectFrom('conveyance_claims as c')
      .innerJoin('field_visits as fv', 'fv.visit_id', 'c.visit_id')
      .innerJoin('service_cases as sc', 'sc.service_case_id', 'c.service_case_id')
      .innerJoin('schools as s', 's.school_id', 'sc.school_id')
      .innerJoin('districts as d', 'd.district_id', 's.district_id')
      .innerJoin('users as u', 'u.user_id', 'c.engineer_id')
      .leftJoin('users as rev', 'rev.user_id', 'c.reviewed_by_user_id')
      .leftJoin('users as sub', 'sub.user_id', 'c.submitted_by_user_id')
      .select([
        'c.conveyance_claim_id as conveyanceClaimId',
        'c.visit_id as visitId',
        'c.service_case_id as serviceCaseId',
        'c.engineer_id as engineerId',
        'c.submitted_by_user_id as submittedByUserId',
        'c.policy_id as policyId',
        'c.travel_date as travelDate',
        'c.from_location as fromLocation',
        'c.to_location as toLocation',
        'c.travel_mode as travelMode',
        'c.starting_odometer_km as startingOdometerKm',
        'c.ending_odometer_km as endingOdometerKm',
        'c.calculated_odometer_distance_km as calculatedOdometerDistanceKm',
        'c.gps_distance_km as gpsDistanceKm',
        'c.captured_distance_km as capturedDistanceKm',
        'c.claimed_distance_km as claimedDistanceKm',
        'c.approved_distance_km as approvedDistanceKm',
        'c.applied_rate_per_km as appliedRatePerKm',
        'c.rate_policy_version as ratePolicyVersion',
        'c.is_provisional_policy as isProvisionalPolicy',
        'c.calculated_amount as calculatedAmount',
        'c.claimed_amount as claimedAmount',
        'c.approved_amount as approvedAmount',
        'c.supporting_evidence_file_id as supportingEvidenceFileId',
        'c.claim_status as claimStatus',
        'c.submitted_at as submittedAt',
        'c.reviewed_by_user_id as reviewedByUserId',
        'c.reviewed_at as reviewedAt',
        'c.rejection_reason as rejectionReason',
        'c.correction_notes as correctionNotes',
        'c.remarks as remarks',
        'c.version as version',
        'c.client_operation_id as clientOperationId',
        'c.is_tombstoned as isTombstoned',
        'c.is_deleted as isDeleted',
        'c.created_at as createdAt',
        'c.updated_at as updatedAt',
        'u.full_name as engineerName',
        'sc.zentra_case_code as serviceCaseNumber',
        's.school_name as schoolName',
        'd.district_name as districtName',
        'rev.full_name as reviewerName',
        'sub.full_name as submittedByName',
      ])
      .where('c.conveyance_claim_id', '=', claimId)
      .where('c.is_deleted', '=', false)
      .executeTakeFirst();

    if (!row) return null;

    return {
      ...row,
      startingOdometerKm: row.startingOdometerKm != null ? Number(row.startingOdometerKm) : null,
      endingOdometerKm: row.endingOdometerKm != null ? Number(row.endingOdometerKm) : null,
      calculatedOdometerDistanceKm: row.calculatedOdometerDistanceKm != null ? Number(row.calculatedOdometerDistanceKm) : null,
      gpsDistanceKm: row.gpsDistanceKm != null ? Number(row.gpsDistanceKm) : null,
      capturedDistanceKm: row.capturedDistanceKm != null ? Number(row.capturedDistanceKm) : null,
      claimedDistanceKm: Number(row.claimedDistanceKm),
      approvedDistanceKm: row.approvedDistanceKm != null ? Number(row.approvedDistanceKm) : null,
      appliedRatePerKm: Number(row.appliedRatePerKm),
      calculatedAmount: Number(row.calculatedAmount),
      claimedAmount: Number(row.claimedAmount),
      approvedAmount: row.approvedAmount != null ? Number(row.approvedAmount) : null,
      travelMode: row.travelMode as any,
      claimStatus: row.claimStatus as any,
      travelDate: String(row.travelDate),
      submittedAt: row.submittedAt ? new Date(row.submittedAt).toISOString() : null,
      reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : null,
      reviewerName: row.reviewerName ?? undefined,
      submittedByName: row.submittedByName ?? undefined,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  /**
   * Updates an existing claim record.
   */
  async update(claimId: string, data: Record<string, any>) {
    return this.db
      .updateTable('conveyance_claims')
      .set({
        ...data,
        updated_at: new Date(),
        version: sql`version + 1`,
      })
      .where('conveyance_claim_id', '=', claimId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Finds and filters claims with territory restrictions, search, and pagination.
   */
  async findAll(
    filters: ConveyanceQueryFilters,
    allowedDistrictIds?: string[],
    engineerIdFilter?: string,
  ): Promise<{ items: ConveyanceClaim[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 20));
    const offset = (page - 1) * limit;

    let baseQuery = this.db
      .selectFrom('conveyance_claims as c')
      .innerJoin('field_visits as fv', 'fv.visit_id', 'c.visit_id')
      .innerJoin('service_cases as sc', 'sc.service_case_id', 'c.service_case_id')
      .innerJoin('schools as s', 's.school_id', 'sc.school_id')
      .innerJoin('districts as d', 'd.district_id', 's.district_id')
      .innerJoin('users as u', 'u.user_id', 'c.engineer_id')
      .leftJoin('users as rev', 'rev.user_id', 'c.reviewed_by_user_id')
      .leftJoin('users as sub', 'sub.user_id', 'c.submitted_by_user_id')
      .where('c.is_deleted', '=', false);

    // Territory scoping
    if (allowedDistrictIds !== undefined) {
      baseQuery = baseQuery.where(
        's.district_id',
        'in',
        allowedDistrictIds.length > 0 ? allowedDistrictIds : ['00000000-0000-0000-0000-000000000000'],
      );
    }
    if (engineerIdFilter) {
      baseQuery = baseQuery.where('c.engineer_id', '=', engineerIdFilter);
    }

    // Filters
    if (filters.status) {
      baseQuery = baseQuery.where('c.claim_status', '=', filters.status);
    }
    if (filters.travelMode) {
      baseQuery = baseQuery.where('c.travel_mode', '=', filters.travelMode);
    }
    if (filters.engineerId) {
      baseQuery = baseQuery.where('c.engineer_id', '=', filters.engineerId);
    }
    if (filters.districtId) {
      baseQuery = baseQuery.where('s.district_id', '=', filters.districtId);
    }
    if (filters.serviceCaseId) {
      baseQuery = baseQuery.where('c.service_case_id', '=', filters.serviceCaseId);
    }
    if (filters.visitId) {
      baseQuery = baseQuery.where('c.visit_id', '=', filters.visitId);
    }
    if (filters.startDate) {
      baseQuery = baseQuery.where('c.travel_date', '>=', filters.startDate);
    }
    if (filters.endDate) {
      baseQuery = baseQuery.where('c.travel_date', '<=', filters.endDate);
    }
    if (filters.search) {
      const term = `%${filters.search.toLowerCase()}%`;
      baseQuery = baseQuery.where((eb) =>
        eb.or([
          eb(sql`LOWER(sc.case_number)`, 'like', term),
          eb(sql`LOWER(s.school_name)`, 'like', term),
          eb(sql`LOWER(u.full_name)`, 'like', term),
          eb(sql`LOWER(c.from_location)`, 'like', term),
          eb(sql`LOWER(c.to_location)`, 'like', term),
        ]),
      );
    }

    // Total count
    const countResult = await baseQuery
      .select(sql<string>`COUNT(c.conveyance_claim_id)`.as('count'))
      .executeTakeFirst();
    const total = countResult ? parseInt(countResult.count, 10) : 0;

    // Paginated items
    const rows = await baseQuery
      .select([
        'c.conveyance_claim_id as conveyanceClaimId',
        'c.visit_id as visitId',
        'c.service_case_id as serviceCaseId',
        'c.engineer_id as engineerId',
        'c.submitted_by_user_id as submittedByUserId',
        'c.policy_id as policyId',
        'c.travel_date as travelDate',
        'c.from_location as fromLocation',
        'c.to_location as toLocation',
        'c.travel_mode as travelMode',
        'c.starting_odometer_km as startingOdometerKm',
        'c.ending_odometer_km as endingOdometerKm',
        'c.calculated_odometer_distance_km as calculatedOdometerDistanceKm',
        'c.gps_distance_km as gpsDistanceKm',
        'c.captured_distance_km as capturedDistanceKm',
        'c.claimed_distance_km as claimedDistanceKm',
        'c.approved_distance_km as approvedDistanceKm',
        'c.applied_rate_per_km as appliedRatePerKm',
        'c.rate_policy_version as ratePolicyVersion',
        'c.is_provisional_policy as isProvisionalPolicy',
        'c.calculated_amount as calculatedAmount',
        'c.claimed_amount as claimedAmount',
        'c.approved_amount as approvedAmount',
        'c.supporting_evidence_file_id as supportingEvidenceFileId',
        'c.claim_status as claimStatus',
        'c.submitted_at as submittedAt',
        'c.reviewed_by_user_id as reviewedByUserId',
        'c.reviewed_at as reviewedAt',
        'c.rejection_reason as rejectionReason',
        'c.correction_notes as correctionNotes',
        'c.remarks as remarks',
        'c.version as version',
        'c.client_operation_id as clientOperationId',
        'c.is_tombstoned as isTombstoned',
        'c.is_deleted as isDeleted',
        'c.created_at as createdAt',
        'c.updated_at as updatedAt',
        'u.full_name as engineerName',
        'sc.zentra_case_code as serviceCaseNumber',
        's.school_name as schoolName',
        'd.district_name as districtName',
        'rev.full_name as reviewerName',
        'sub.full_name as submittedByName',
      ])
      .orderBy('c.travel_date', 'desc')
      .orderBy('c.created_at', 'desc')
      .offset(offset)
      .limit(limit)
      .execute();

    const items: ConveyanceClaim[] = rows.map((row) => ({
      ...row,
      startingOdometerKm: row.startingOdometerKm != null ? Number(row.startingOdometerKm) : null,
      endingOdometerKm: row.endingOdometerKm != null ? Number(row.endingOdometerKm) : null,
      calculatedOdometerDistanceKm: row.calculatedOdometerDistanceKm != null ? Number(row.calculatedOdometerDistanceKm) : null,
      gpsDistanceKm: row.gpsDistanceKm != null ? Number(row.gpsDistanceKm) : null,
      capturedDistanceKm: row.capturedDistanceKm != null ? Number(row.capturedDistanceKm) : null,
      claimedDistanceKm: Number(row.claimedDistanceKm),
      approvedDistanceKm: row.approvedDistanceKm != null ? Number(row.approvedDistanceKm) : null,
      appliedRatePerKm: Number(row.appliedRatePerKm),
      calculatedAmount: Number(row.calculatedAmount),
      claimedAmount: Number(row.claimedAmount),
      approvedAmount: row.approvedAmount != null ? Number(row.approvedAmount) : null,
      travelMode: row.travelMode as any,
      claimStatus: row.claimStatus as any,
      travelDate: String(row.travelDate),
      submittedAt: row.submittedAt ? new Date(row.submittedAt).toISOString() : null,
      reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : null,
      reviewerName: row.reviewerName ?? undefined,
      submittedByName: row.submittedByName ?? undefined,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retrieves summary statistics and territory-aware reporting totals.
   */
  async getSummaryStats(
    allowedDistrictIds?: string[],
    engineerIdFilter?: string,
  ): Promise<ConveyanceSummaryStats> {
    let query = this.db
      .selectFrom('conveyance_claims as c')
      .innerJoin('service_cases as sc', 'sc.service_case_id', 'c.service_case_id')
      .innerJoin('schools as s', 's.school_id', 'sc.school_id')
      .innerJoin('districts as d', 'd.district_id', 's.district_id')
      .where('c.is_deleted', '=', false);

    if (allowedDistrictIds !== undefined) {
      query = query.where(
        's.district_id',
        'in',
        allowedDistrictIds.length > 0 ? allowedDistrictIds : ['00000000-0000-0000-0000-000000000000'],
      );
    }
    if (engineerIdFilter) {
      query = query.where('c.engineer_id', '=', engineerIdFilter);
    }

    const rows = await query
      .select([
        'c.claim_status as claimStatus',
        sql<string>`COUNT(c.conveyance_claim_id)`.as('count'),
        sql<string>`COALESCE(SUM(c.claimed_amount), 0)`.as('totalClaimed'),
        sql<string>`COALESCE(SUM(c.approved_amount), 0)`.as('totalApproved'),
      ])
      .groupBy('c.claim_status')
      .execute();

    let totalClaimsCount = 0;
    let draftCount = 0;
    let submittedCount = 0;
    let underReviewCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let returnedCount = 0;
    let paidCount = 0;
    let totalClaimedAmount = 0;
    let totalApprovedAmount = 0;
    let totalPaidAmount = 0;

    for (const r of rows) {
      const c = parseInt(r.count, 10);
      const claimed = parseFloat(r.totalClaimed);
      const approved = parseFloat(r.totalApproved);

      totalClaimsCount += c;
      totalClaimedAmount += claimed;
      totalApprovedAmount += approved;

      switch (r.claimStatus) {
        case 'DRAFT':
          draftCount += c;
          break;
        case 'SUBMITTED':
          submittedCount += c;
          break;
        case 'UNDER_REVIEW':
          underReviewCount += c;
          break;
        case 'APPROVED':
          approvedCount += c;
          break;
        case 'REJECTED':
          rejectedCount += c;
          break;
        case 'RETURNED_FOR_CORRECTION':
          returnedCount += c;
          break;
        case 'PAID':
          paidCount += c;
          totalPaidAmount += approved;
          break;
      }
    }

    // District-wise breakdown
    const districtRows = await query
      .select([
        'd.district_id as districtId',
        'd.district_name as districtName',
        sql<string>`COUNT(c.conveyance_claim_id)`.as('count'),
        sql<string>`COALESCE(SUM(c.claimed_amount), 0)`.as('totalClaimed'),
        sql<string>`COALESCE(SUM(c.approved_amount), 0)`.as('totalApproved'),
      ])
      .groupBy(['d.district_id', 'd.district_name'])
      .orderBy('d.district_name', 'asc')
      .execute();

    const districtWiseBreakdown = districtRows.map((dr) => ({
      districtId: dr.districtId,
      districtName: dr.districtName,
      claimsCount: parseInt(dr.count, 10),
      totalClaimedAmount: parseFloat(dr.totalClaimed),
      totalApprovedAmount: parseFloat(dr.totalApproved),
    }));

    return {
      totalClaimsCount,
      draftCount,
      submittedCount,
      underReviewCount,
      approvedCount,
      rejectedCount,
      returnedCount,
      paidCount,
      totalClaimedAmount: Number(totalClaimedAmount.toFixed(2)),
      totalApprovedAmount: Number(totalApprovedAmount.toFixed(2)),
      totalPaidAmount: Number(totalPaidAmount.toFixed(2)),
      districtWiseBreakdown,
    };
  }

  /**
   * Records an immutable event in administrative audit_events.
   */
  async logAuditEvent(data: {
    actorUserId: string | null;
    actionType: string;
    targetEntityId: string;
    preMutationState?: Record<string, unknown> | null;
    postMutationState?: Record<string, unknown> | null;
  }) {
    await this.db
      .insertInto('audit_events')
      .values({
        audit_event_id: generateUuidV7(),
        actor_user_id: data.actorUserId,
        actor_ip_address: null,
        actor_device_id: null,
        event_category: 'CONVEYANCE_GOVERNANCE',
        target_entity_type: 'conveyance_claims',
        target_entity_id: data.targetEntityId,
        action_type: data.actionType,
        pre_mutation_state: data.preMutationState ?? null,
        post_mutation_state: data.postMutationState ?? null,
      })
      .execute();
  }
}

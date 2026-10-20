/**
 * ZENTRA — Conveyance Service (Phase 15)
 * apps/api/src/modules/conveyance/services/conveyance.service.ts
 *
 * Implements authoritative conveyance claim lifecycle management:
 * - Deterministic distance and odometer calculation
 * - Configuration-driven reimbursement and calculation transparency
 * - Multi-hop territory isolation and Row-Level Security
 * - Duplicate claim prevention (1 active claim per visit)
 * - Self-approval prevention (Field Engineers cannot approve own claims)
 * - Administrative audit trail logging
 */

import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Kysely } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema } from '../../../database/database.types';
import { ConveyanceRepository } from '../repositories/conveyance.repository';
import { ConveyancePolicyService } from './conveyance-policy.service';
import type {
  CreateConveyanceClaimDto,
  SubmitConveyanceClaimDto,
  ReviewConveyanceClaimDto,
  ApproveConveyanceClaimDto,
  RejectConveyanceClaimDto,
  ReturnConveyanceClaimDto,
  PayConveyanceClaimDto,
  ConveyanceQueryFiltersDto,
} from '@zentra/contracts';
import type {
  ConveyanceClaim,
  ConveyanceSummaryStats,
  ConveyanceCalculationBreakdown,
  UserProfile,
  AccessTokenClaims,
} from '@zentra/types';
import { generateUuidV7 } from '@zentra/shared';

export type UserContext =
  | AccessTokenClaims
  | UserProfile
  | {
      userId: string;
      roles: string[];
      activeRole?: string;
      territoryDistrictIds?: string[];
      territories?: { districtId: string }[];
    };

@Injectable()
export class ConveyanceService {
  constructor(
    @Inject(ConveyanceRepository)
    private readonly conveyanceRepository: ConveyanceRepository,
    @Inject(ConveyancePolicyService)
    private readonly policyService: ConveyancePolicyService,
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  /**
   * Evaluates territory authorization based on deterministic entity lineage.
   * Master Admin and Reporting Head have universal access (Reporting Head read-only).
   * Field Engineers only have access to claims they created.
   * District Coordinators have access if the school district is in their territory.
   */
  private checkTerritoryAuthorization(
    user: UserContext,
    districtId: string,
    engineerId?: string,
  ): void {
    const roles = user.roles || [];
    if (roles.includes('MASTER_ADMIN') || roles.includes('REPORTING_HEAD')) {
      return;
    }

    const userId = (user as any).userId || (user as any).sub;

    // Field Engineers are restricted strictly to their own claims
    if (roles.includes('FIELD_ENGINEER')) {
      if (engineerId && engineerId === userId) {
        return;
      }
      throw new ForbiddenException(
        `AUTHORIZATION_ERROR: Field Engineer ${userId} is not authorized for another engineer's claim`,
      );
    }

    // District territory assignment check for coordinators
    const userDistricts: string[] =
      (user as any).territoryDistrictIds ||
      ((user as any).territories || []).map((t: any) => t.districtId) ||
      [];

    if (!userDistricts.includes(districtId)) {
      throw new ForbiddenException(
        `AUTHORIZATION_ERROR: User ${userId} is not authorized for district ${districtId}`,
      );
    }
  }

  /**
   * Creates a new conveyance claim linked to a completed/eligible field visit.
   */
  async createClaim(
    dto: CreateConveyanceClaimDto,
    currentUser: UserContext,
  ): Promise<ConveyanceClaim> {
    const currentUserId = (currentUser as any).userId || (currentUser as any).sub;
    const isFieldEngineer = (currentUser.roles || []).includes('FIELD_ENGINEER');

    // 1. Verify Field Visit and Service Case relationships
    const visit = await this.db
      .selectFrom('field_visits as fv')
      .innerJoin('service_cases as sc', 'sc.service_case_id', 'fv.service_case_id')
      .innerJoin('schools as s', 's.school_id', 'sc.school_id')
      .select([
        'fv.visit_id as visitId',
        'fv.service_case_id as serviceCaseId',
        'fv.engineer_id as engineerId',
        'fv.status as visitStatus',
        's.district_id as districtId',
      ])
      .where('fv.visit_id', '=', dto.visitId)
      .where('fv.is_deleted', '=', false)
      .executeTakeFirst();

    if (!visit) {
      throw new NotFoundException(`Field visit ${dto.visitId} not found`);
    }

    if (visit.serviceCaseId !== dto.serviceCaseId) {
      throw new BadRequestException(
        `MISMATCHED_CASE: Field visit ${dto.visitId} does not belong to service case ${dto.serviceCaseId}`,
      );
    }

    // 2. Authorize actor
    this.checkTerritoryAuthorization(currentUser, visit.districtId, visit.engineerId);

    // 3. Authoritative Engineer assignment (Condition 4: DO NOT trust engineer_id from request body)
    if (isFieldEngineer) {
      if ((dto as any).engineerId && (dto as any).engineerId !== currentUserId) {
        throw new ForbiddenException(
          'AUTHORIZATION_ERROR: Field engineers cannot create claims on behalf of another engineer',
        );
      }
      if (visit.engineerId !== currentUserId) {
        throw new ForbiddenException(
          'AUTHORIZATION_ERROR: Field engineers cannot claim visits assigned to another engineer',
        );
      }
    }
    const effectiveEngineerId = isFieldEngineer ? currentUserId : (visit.engineerId || currentUserId);

    // 4. Duplicate Claim Prevention: Only 1 active claim allowed per field visit
    const existingClaim = await this.conveyanceRepository.findByVisitId(dto.visitId);
    if (existingClaim) {
      throw new ConflictException(
        `DUPLICATE_CLAIM: An active conveyance claim already exists for field visit ${dto.visitId} (Claim ID: ${existingClaim.conveyance_claim_id})`,
      );
    }

    // 5. Odometer & Distance Calculation
    let calculatedOdometerDistanceKm: number | null = null;
    if (dto.startingOdometerKm != null && dto.endingOdometerKm != null) {
      if (dto.endingOdometerKm < dto.startingOdometerKm) {
        throw new BadRequestException(
          'INVALID_ODOMETER: Ending odometer reading cannot be less than starting reading',
        );
      }
      calculatedOdometerDistanceKm = Number(
        (dto.endingOdometerKm - dto.startingOdometerKm).toFixed(2),
      );
    }

    if (dto.claimedDistanceKm <= 0) {
      throw new BadRequestException(
        'INVALID_DISTANCE: Claimed distance must be greater than zero',
      );
    }

    // Condition 1: Explicitly preserve captured/evidenced distance
    const capturedDistanceKm =
      dto.capturedDistanceKm ??
      (calculatedOdometerDistanceKm != null
        ? calculatedOdometerDistanceKm
        : dto.gpsDistanceKm ?? dto.claimedDistanceKm);

    // 6. Configuration-driven Reimbursement Calculation (Condition 2: Deterministic District Precedence)
    const policy = await this.policyService.resolveRatePolicy(dto.travelMode, {
      districtId: visit.districtId,
      effectiveDate: dto.travelDate,
    });
    const calculatedAmount = Number(
      (dto.claimedDistanceKm * policy.ratePerKm).toFixed(2),
    );
    const claimedAmount = calculatedAmount;

    // 7. Initial Status
    const claimId = generateUuidV7();
    const initialStatus = dto.submitDirectly ? 'SUBMITTED' : 'DRAFT';
    const submittedAt = dto.submitDirectly ? new Date() : null;

    // 8. Persist Claim with distinct captured, claimed, and historical audit fields
    await this.conveyanceRepository.create({
      conveyance_claim_id: claimId,
      visit_id: dto.visitId,
      service_case_id: dto.serviceCaseId,
      engineer_id: effectiveEngineerId,
      submitted_by_user_id: dto.submitDirectly ? currentUserId : null,
      policy_id: policy.policyId,
      travel_date: dto.travelDate,
      from_location: dto.fromLocation,
      to_location: dto.toLocation,
      travel_mode: dto.travelMode,
      starting_odometer_km: dto.startingOdometerKm,
      ending_odometer_km: dto.endingOdometerKm,
      calculated_odometer_distance_km: calculatedOdometerDistanceKm,
      gps_distance_km: dto.gpsDistanceKm ?? null,
      captured_distance_km: capturedDistanceKm,
      claimed_distance_km: dto.claimedDistanceKm,
      approved_distance_km: null,
      applied_rate_per_km: policy.ratePerKm,
      rate_policy_version: policy.policyVersion,
      is_provisional_policy: policy.isProvisional,
      calculated_amount: calculatedAmount,
      claimed_amount: claimedAmount,
      approved_amount: null,
      supporting_evidence_file_id: dto.supportingEvidenceFileId ?? null,
      claim_status: initialStatus,
      submitted_at: submittedAt,
      remarks: dto.remarks ?? null,
      client_operation_id: dto.clientOperationId ?? null,
    });

    // 9. Audit Logging
    await this.conveyanceRepository.logAuditEvent({
      actorUserId: currentUserId,
      actionType: dto.submitDirectly ? 'CLAIM_SUBMITTED' : 'CLAIM_CREATED',
      targetEntityId: claimId,
      postMutationState: {
        claimId,
        visitId: dto.visitId,
        engineerId: effectiveEngineerId,
        travelMode: dto.travelMode,
        capturedDistanceKm,
        claimedDistanceKm: dto.claimedDistanceKm,
        appliedRatePerKm: policy.ratePerKm,
        ratePolicyVersion: policy.policyVersion,
        claimedAmount,
        status: initialStatus,
      },
    });

    const enriched = await this.conveyanceRepository.findEnrichedById(claimId);
    if (!enriched) {
      throw new NotFoundException(`Created conveyance claim ${claimId} not found`);
    }

    return enriched;
  }

  /**
   * Submits a draft or returned conveyance claim for coordinator review.
   */
  async submitClaim(
    claimId: string,
    dto: SubmitConveyanceClaimDto,
    currentUser: UserContext,
  ): Promise<ConveyanceClaim> {
    const lineage = await this.conveyanceRepository.getClaimLineage(claimId);
    if (!lineage) {
      throw new NotFoundException(`Conveyance claim ${claimId} not found`);
    }

    const currentUserId = (currentUser as any).userId || (currentUser as any).sub;
    const roles = currentUser.roles || [];
    const isFieldEngineer = roles.includes('FIELD_ENGINEER');

    // Condition 5: Field engineers can only submit their own claims
    if (isFieldEngineer && lineage.engineerId !== currentUserId) {
      throw new ForbiddenException(
        'AUTHORIZATION_ERROR: Field engineers can only submit their own conveyance claims',
      );
    }

    this.checkTerritoryAuthorization(currentUser, lineage.districtId, lineage.engineerId);

    // State transition guard
    if (
      lineage.claimStatus !== 'DRAFT' &&
      lineage.claimStatus !== 'RETURNED_FOR_CORRECTION'
    ) {
      throw new BadRequestException(
        `INVALID_STATE_TRANSITION: Cannot submit claim currently in status ${lineage.claimStatus}`,
      );
    }

    await this.conveyanceRepository.update(claimId, {
      claim_status: 'SUBMITTED',
      submitted_at: new Date(),
      submitted_by_user_id: currentUserId,
      remarks: dto.remarks !== undefined ? dto.remarks : undefined,
    });

    const isProxySubmission = currentUserId !== lineage.engineerId;
    await this.conveyanceRepository.logAuditEvent({
      actorUserId: currentUserId,
      actionType: 'CLAIM_SUBMITTED',
      targetEntityId: claimId,
      preMutationState: { status: lineage.claimStatus },
      postMutationState: {
        status: 'SUBMITTED',
        submittedBy: currentUserId,
        isProxySubmission,
        ownerEngineerId: lineage.engineerId,
      },
    });

    return (await this.conveyanceRepository.findEnrichedById(claimId))!;
  }

  /**
   * Transitions a claim to UNDER_REVIEW (Supervisor / Coordinator has opened review).
   */
  async reviewClaim(
    claimId: string,
    dto: ReviewConveyanceClaimDto,
    currentUser: UserContext,
  ): Promise<ConveyanceClaim> {
    const lineage = await this.conveyanceRepository.getClaimLineage(claimId);
    if (!lineage) {
      throw new NotFoundException(`Conveyance claim ${claimId} not found`);
    }

    const currentUserId = (currentUser as any).userId || (currentUser as any).sub;
    const roles = currentUser.roles || [];

    // Role check: Field Engineers cannot review claims
    if (
      roles.includes('FIELD_ENGINEER') &&
      !roles.includes('MASTER_ADMIN') &&
      !roles.includes('DISTRICT_COORDINATOR')
    ) {
      throw new ForbiddenException(
        'AUTHORIZATION_ERROR: Field Engineers cannot review conveyance claims',
      );
    }

    this.checkTerritoryAuthorization(currentUser, lineage.districtId);

    if (lineage.claimStatus !== 'SUBMITTED') {
      throw new BadRequestException(
        `INVALID_STATE_TRANSITION: Cannot start review on claim in status ${lineage.claimStatus}`,
      );
    }

    await this.conveyanceRepository.update(claimId, {
      claim_status: 'UNDER_REVIEW',
      reviewed_by_user_id: currentUserId,
      reviewed_at: new Date(),
      remarks: dto.reviewNotes !== undefined ? dto.reviewNotes : undefined,
    });

    await this.conveyanceRepository.logAuditEvent({
      actorUserId: currentUserId,
      actionType: 'CLAIM_REVIEWED',
      targetEntityId: claimId,
      preMutationState: { status: lineage.claimStatus },
      postMutationState: { status: 'UNDER_REVIEW' },
    });

    return (await this.conveyanceRepository.findEnrichedById(claimId))!;
  }

  /**
   * Approves a conveyance claim.
   * Strictly enforces:
   * 1. Self-approval prevention (Approver != Claim Engineer)
   * 2. Field Engineer role prohibition (Field Engineers cannot approve)
   * 3. Territory isolation
   */
  async approveClaim(
    claimId: string,
    dto: ApproveConveyanceClaimDto,
    currentUser: UserContext,
  ): Promise<ConveyanceClaim> {
    const claim = await this.conveyanceRepository.findById(claimId);
    if (!claim) {
      throw new NotFoundException(`Conveyance claim ${claimId} not found`);
    }

    const lineage = await this.conveyanceRepository.getClaimLineage(claimId);
    if (!lineage) {
      throw new NotFoundException(`Conveyance claim ${claimId} lineage not found`);
    }

    const currentUserId = (currentUser as any).userId || (currentUser as any).sub;
    const roles = currentUser.roles || [];

    // 1. Self-Approval Prevention
    if (claim.engineer_id === currentUserId) {
      throw new ForbiddenException(
        'SELF_APPROVAL_PROHIBITED: Field engineers are strictly prohibited from approving their own conveyance claims',
      );
    }

    // 2. Field Engineer Role Prohibition
    if (
      roles.includes('FIELD_ENGINEER') &&
      !roles.includes('MASTER_ADMIN') &&
      !roles.includes('DISTRICT_COORDINATOR')
    ) {
      throw new ForbiddenException(
        'AUTHORIZATION_ERROR: Field Engineers do not hold approval authority for conveyance claims',
      );
    }

    // 3. Territory check
    this.checkTerritoryAuthorization(currentUser, lineage.districtId);

    // 4. State machine guard
    if (claim.claim_status !== 'UNDER_REVIEW' && claim.claim_status !== 'SUBMITTED') {
      throw new BadRequestException(
        `INVALID_STATE_TRANSITION: Cannot approve claim currently in status ${claim.claim_status}`,
      );
    }

    // 5. Calculate authoritative approved values
    const approvedDistanceKm =
      dto.approvedDistanceKm ?? Number(claim.claimed_distance_km);
    const appliedRate = Number(claim.applied_rate_per_km);
    const approvedAmount =
      dto.approvedAmount ?? Number((approvedDistanceKm * appliedRate).toFixed(2));

    await this.conveyanceRepository.update(claimId, {
      claim_status: 'APPROVED',
      approved_distance_km: approvedDistanceKm,
      approved_amount: approvedAmount,
      reviewed_by_user_id: currentUserId,
      reviewed_at: new Date(),
      remarks: dto.approvalNotes ?? claim.remarks,
    });

    await this.conveyanceRepository.logAuditEvent({
      actorUserId: currentUserId,
      actionType: 'CLAIM_APPROVED',
      targetEntityId: claimId,
      preMutationState: {
        status: claim.claim_status,
        claimedAmount: claim.claimed_amount,
      },
      postMutationState: {
        status: 'APPROVED',
        approvedDistanceKm,
        approvedAmount,
        approvedBy: currentUserId,
      },
    });

    return (await this.conveyanceRepository.findEnrichedById(claimId))!;
  }

  /**
   * Rejects a conveyance claim with an authoritative reason.
   */
  async rejectClaim(
    claimId: string,
    dto: RejectConveyanceClaimDto,
    currentUser: UserContext,
  ): Promise<ConveyanceClaim> {
    const claim = await this.conveyanceRepository.findById(claimId);
    if (!claim) {
      throw new NotFoundException(`Conveyance claim ${claimId} not found`);
    }

    const lineage = await this.conveyanceRepository.getClaimLineage(claimId);
    if (!lineage) {
      throw new NotFoundException(`Conveyance claim ${claimId} lineage not found`);
    }

    const currentUserId = (currentUser as any).userId || (currentUser as any).sub;
    const roles = currentUser.roles || [];

    if (
      roles.includes('FIELD_ENGINEER') &&
      !roles.includes('MASTER_ADMIN') &&
      !roles.includes('DISTRICT_COORDINATOR')
    ) {
      throw new ForbiddenException(
        'AUTHORIZATION_ERROR: Field Engineers do not hold rejection authority for conveyance claims',
      );
    }

    this.checkTerritoryAuthorization(currentUser, lineage.districtId);

    if (claim.claim_status !== 'UNDER_REVIEW' && claim.claim_status !== 'SUBMITTED') {
      throw new BadRequestException(
        `INVALID_STATE_TRANSITION: Cannot reject claim currently in status ${claim.claim_status}`,
      );
    }

    await this.conveyanceRepository.update(claimId, {
      claim_status: 'REJECTED',
      rejection_reason: dto.rejectionReason,
      reviewed_by_user_id: currentUserId,
      reviewed_at: new Date(),
    });

    await this.conveyanceRepository.logAuditEvent({
      actorUserId: currentUserId,
      actionType: 'CLAIM_REJECTED',
      targetEntityId: claimId,
      preMutationState: { status: claim.claim_status },
      postMutationState: {
        status: 'REJECTED',
        rejectionReason: dto.rejectionReason,
        rejectedBy: currentUserId,
      },
    });

    return (await this.conveyanceRepository.findEnrichedById(claimId))!;
  }

  /**
   * Returns a claim to the engineer for correction with feedback notes.
   */
  async returnClaimForCorrection(
    claimId: string,
    dto: ReturnConveyanceClaimDto,
    currentUser: UserContext,
  ): Promise<ConveyanceClaim> {
    const claim = await this.conveyanceRepository.findById(claimId);
    if (!claim) {
      throw new NotFoundException(`Conveyance claim ${claimId} not found`);
    }

    const lineage = await this.conveyanceRepository.getClaimLineage(claimId);
    if (!lineage) {
      throw new NotFoundException(`Conveyance claim ${claimId} lineage not found`);
    }

    const currentUserId = (currentUser as any).userId || (currentUser as any).sub;
    const roles = currentUser.roles || [];

    if (
      roles.includes('FIELD_ENGINEER') &&
      !roles.includes('MASTER_ADMIN') &&
      !roles.includes('DISTRICT_COORDINATOR')
    ) {
      throw new ForbiddenException(
        'AUTHORIZATION_ERROR: Field Engineers do not hold review authority for conveyance claims',
      );
    }

    this.checkTerritoryAuthorization(currentUser, lineage.districtId);

    if (claim.claim_status !== 'UNDER_REVIEW' && claim.claim_status !== 'SUBMITTED') {
      throw new BadRequestException(
        `INVALID_STATE_TRANSITION: Cannot return claim currently in status ${claim.claim_status}`,
      );
    }

    await this.conveyanceRepository.update(claimId, {
      claim_status: 'RETURNED_FOR_CORRECTION',
      correction_notes: dto.correctionNotes,
      reviewed_by_user_id: currentUserId,
      reviewed_at: new Date(),
    });

    await this.conveyanceRepository.logAuditEvent({
      actorUserId: currentUserId,
      actionType: 'CLAIM_RETURNED_FOR_CORRECTION',
      targetEntityId: claimId,
      preMutationState: { status: claim.claim_status },
      postMutationState: {
        status: 'RETURNED_FOR_CORRECTION',
        correctionNotes: dto.correctionNotes,
        returnedBy: currentUserId,
      },
    });

    return (await this.conveyanceRepository.findEnrichedById(claimId))!;
  }

  /**
   * Marks an approved claim as PAID (Financial Settlement Transition).
   */
  async payClaim(
    claimId: string,
    dto: PayConveyanceClaimDto,
    currentUser: UserContext,
  ): Promise<ConveyanceClaim> {
    const claim = await this.conveyanceRepository.findById(claimId);
    if (!claim) {
      throw new NotFoundException(`Conveyance claim ${claimId} not found`);
    }

    const lineage = await this.conveyanceRepository.getClaimLineage(claimId);
    if (!lineage) {
      throw new NotFoundException(`Conveyance claim ${claimId} lineage not found`);
    }

    const currentUserId = (currentUser as any).userId || (currentUser as any).sub;
    const roles = currentUser.roles || [];

    // Financial settlement restricted to Master Admin or Reporting Head
    if (!roles.includes('MASTER_ADMIN') && !roles.includes('REPORTING_HEAD')) {
      throw new ForbiddenException(
        'AUTHORIZATION_ERROR: Payment processing requires administrative or reporting head authorization',
      );
    }

    if (claim.claim_status !== 'APPROVED') {
      throw new BadRequestException(
        `INVALID_STATE_TRANSITION: Cannot pay claim in status ${claim.claim_status}. Claim must be APPROVED first.`,
      );
    }

    await this.conveyanceRepository.update(claimId, {
      claim_status: 'PAID',
      remarks: dto.paymentReference
        ? `Payment ref: ${dto.paymentReference}. ${claim.remarks || ''}`
        : claim.remarks,
    });

    await this.conveyanceRepository.logAuditEvent({
      actorUserId: currentUserId,
      actionType: 'CLAIM_PAID',
      targetEntityId: claimId,
      preMutationState: { status: claim.claim_status },
      postMutationState: {
        status: 'PAID',
        paymentReference: dto.paymentReference,
        paidBy: currentUserId,
      },
    });

    return (await this.conveyanceRepository.findEnrichedById(claimId))!;
  }

  /**
   * Retrieves claim by ID with full calculation transparency breakdown.
   */
  async getClaimById(
    claimId: string,
    currentUser: UserContext,
  ): Promise<{ claim: ConveyanceClaim; calculation: ConveyanceCalculationBreakdown }> {
    const lineage = await this.conveyanceRepository.getClaimLineage(claimId);
    if (!lineage) {
      throw new NotFoundException(`Conveyance claim ${claimId} not found`);
    }

    this.checkTerritoryAuthorization(currentUser, lineage.districtId, lineage.engineerId);

    const claim = await this.conveyanceRepository.findEnrichedById(claimId);
    if (!claim) {
      throw new NotFoundException(`Conveyance claim ${claimId} not found`);
    }

    const calculation: ConveyanceCalculationBreakdown = {
      claimedDistanceKm: claim.claimedDistanceKm,
      capturedDistanceKm: claim.capturedDistanceKm,
      appliedRatePerKm: claim.appliedRatePerKm,
      ratePolicyVersion: claim.ratePolicyVersion,
      isProvisionalPolicy: claim.isProvisionalPolicy,
      calculatedAmount: claim.calculatedAmount,
      approvedDistanceKm: claim.approvedDistanceKm,
      approvedAmount: claim.approvedAmount,
      explanation: `${claim.claimedDistanceKm} km × ₹${claim.appliedRatePerKm}/km = ₹${claim.calculatedAmount}${
        claim.isProvisionalPolicy ? ' (Provisional Policy)' : ''
      }`,
    };

    return { claim, calculation };
  }

  /**
   * Lists claims with territory-aware filtering and search.
   */
  async listClaims(
    filters: ConveyanceQueryFiltersDto,
    currentUser: UserContext,
  ) {
    const roles = currentUser.roles || [];
    const currentUserId = (currentUser as any).userId || (currentUser as any).sub;

    let allowedDistrictIds: string[] | undefined = undefined;
    let engineerIdFilter: string | undefined = undefined;

    if (roles.includes('MASTER_ADMIN') || roles.includes('REPORTING_HEAD')) {
      // Unrestricted
    } else if (roles.includes('DISTRICT_COORDINATOR')) {
      allowedDistrictIds =
        (currentUser as any).territoryDistrictIds ||
        ((currentUser as any).territories || []).map((t: any) => t.districtId) ||
        [];
    } else if (roles.includes('FIELD_ENGINEER')) {
      engineerIdFilter = currentUserId;
    }

    return this.conveyanceRepository.findAll(
      filters,
      allowedDistrictIds,
      engineerIdFilter,
    );
  }

  /**
   * Retrieves summary reporting metrics.
   */
  async getSummary(currentUser: UserContext): Promise<ConveyanceSummaryStats> {
    const roles = currentUser.roles || [];
    const currentUserId = (currentUser as any).userId || (currentUser as any).sub;

    let allowedDistrictIds: string[] | undefined = undefined;
    let engineerIdFilter: string | undefined = undefined;

    if (roles.includes('MASTER_ADMIN') || roles.includes('REPORTING_HEAD')) {
      // Statewide access
    } else if (roles.includes('DISTRICT_COORDINATOR')) {
      allowedDistrictIds =
        (currentUser as any).territoryDistrictIds ||
        ((currentUser as any).territories || []).map((t: any) => t.districtId) ||
        [];
    } else if (roles.includes('FIELD_ENGINEER')) {
      engineerIdFilter = currentUserId;
    }

    return this.conveyanceRepository.getSummaryStats(
      allowedDistrictIds,
      engineerIdFilter,
    );
  }
}

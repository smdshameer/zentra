/**
 * ZENTRA — Dispatch Engine Service
 * apps/api/src/modules/service-cases/services/dispatch-engine.service.ts
 *
 * Implements field engineer dispatching with:
 * - Multi-district and block territory verification
 * - Controlled emergency cross-district assignment with mandatory justification
 * - Primary and secondary engineer roles
 * - Append-only immutable assignment ledger
 * - Workload calculation and engineer availability
 */

import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { Kysely } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema } from '../../../database/database.types';
import { ServiceCasesRepository } from '../repositories/service-cases.repository';
import { AssignmentHistoryRepository } from '../repositories/assignment-history.repository';
import { StatusHistoryRepository } from '../repositories/status-history.repository';
import { CaseAuditEventsRepository } from '../repositories/audit-events.repository';
import { generateUuidV7 } from '@zentra/shared';
import type { AssignmentRole, AssignmentAction, EngineerWorkloadSummary } from '@zentra/types';

/**
 * Candidate default workload capacity threshold for technical demonstration only.
 * CANDIDATE CONFIGURATION — REQUIRES OPERATIONAL CONFIRMATION.
 * Note: ZENTRA policy has not established an authoritative contractual workload capacity limit.
 */
export const CANDIDATE_DEFAULT_WORKLOAD_CAPACITY = 8;

/**
 * Technical sanity threshold for emergency justification text.
 * CONFIGURABLE / REQUIRES CLARIFICATION — Temporary technical sanity check to prevent empty justifications.
 * Note: ZENTRA policy has not established an authoritative minimum justification length.
 */
export const TECHNICAL_MIN_EMERGENCY_JUSTIFICATION_LENGTH = 10;

export interface AssignEngineerInput {
  serviceCaseId: string;
  engineerId: string;
  assignmentRole?: AssignmentRole;
  reassignmentReason?: string | null;
  isEmergencyCrossDistrict?: boolean;
  emergencyJustification?: string | null;
  actorUserId: string;
  actorIpAddress?: string | null;
  actorDeviceId?: string | null;
}

@Injectable()
export class DispatchEngineService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
    @Inject(ServiceCasesRepository)
    private readonly casesRepo: ServiceCasesRepository,
    @Inject(AssignmentHistoryRepository)
    private readonly assignmentHistoryRepo: AssignmentHistoryRepository,
    @Inject(StatusHistoryRepository)
    private readonly statusHistoryRepo: StatusHistoryRepository,
    @Inject(CaseAuditEventsRepository)
    private readonly auditRepo: CaseAuditEventsRepository,
  ) {}

  /**
   * Assign or reassign an engineer to a service case
   */
  async assignEngineer(input: AssignEngineerInput) {
    return await this.db.transaction().execute(async (trx) => {
      // 1. Fetch service case
      const serviceCase = await this.casesRepo.findById(input.serviceCaseId, trx);
      if (!serviceCase) {
        throw new NotFoundException(`Service case ${input.serviceCaseId} not found`);
      }

      // 2. Fetch engineer and verify existence and status
      const engineer = await trx
        .selectFrom('users')
        .select(['user_id', 'full_name', 'account_status', 'is_active'])
        .where('user_id', '=', input.engineerId)
        .executeTakeFirst();

      if (!engineer) {
        throw new NotFoundException(`Engineer ${input.engineerId} not found`);
      }

      if (engineer.account_status !== 'ACTIVE' || !engineer.is_active) {
        throw new BadRequestException(`Engineer account is not ACTIVE (status: ${engineer.account_status})`);
      }

      // 3. Verify territory assignment for the school's district
      const school = await trx
        .selectFrom('schools')
        .select(['school_id', 'district_id', 'block_id'])
        .where('school_id', '=', serviceCase.schoolId)
        .executeTakeFirst();

      if (!school) {
        throw new NotFoundException(`School ${serviceCase.schoolId} not found`);
      }

      // Check if engineer has active assignment in this district
      const territoryMatches = await trx
        .selectFrom('user_territory_assignments')
        .selectAll()
        .where('user_id', '=', input.engineerId)
        .where('district_id', '=', school.district_id)
        .where((eb) =>
          eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', new Date())]),
        )
        .execute();

      const hasTerritoryMatch = territoryMatches.length > 0;
      const isEmergency = Boolean(input.isEmergencyCrossDistrict);

      if (!hasTerritoryMatch) {
        if (!isEmergency) {
          throw new BadRequestException(
            `Territory mismatch: Engineer '${engineer.full_name}' is not assigned to the case district. Cross-district dispatch requires emergency justification.`,
          );
        }

        if (
          !input.emergencyJustification ||
          input.emergencyJustification.trim().length < TECHNICAL_MIN_EMERGENCY_JUSTIFICATION_LENGTH
        ) {
          throw new BadRequestException(
            `Emergency cross-district dispatch requires an emergency justification (minimum ${TECHNICAL_MIN_EMERGENCY_JUSTIFICATION_LENGTH} characters for technical safety; policy threshold REQUIRES CLARIFICATION).`,
          );
        }
      }

      const role: AssignmentRole = input.assignmentRole || 'PRIMARY';
      const previousEngineerId =
        role === 'PRIMARY'
          ? serviceCase.assignedPrimaryEngineerId
          : serviceCase.assignedSecondaryEngineerId;

      const action: AssignmentAction = previousEngineerId ? 'REASSIGNED' : 'ASSIGNED';

      if (action === 'REASSIGNED' && !input.reassignmentReason && !input.emergencyJustification) {
        throw new BadRequestException('Reassignment requires a reason.');
      }

      // 4. Update service case
      const now = new Date();
      if (role === 'PRIMARY') {
        const shouldAdvanceToAssigned = serviceCase.operationalStatus === 'REGISTERED';
        const targetStatus = shouldAdvanceToAssigned ? 'ASSIGNED' : serviceCase.operationalStatus;

        await trx
          .updateTable('service_cases')
          .set({
            assigned_primary_engineer_id: input.engineerId,
            assigned_at: now,
            operational_status: targetStatus,
            updated_at: now,
          })
          .where('service_case_id', '=', input.serviceCaseId)
          .execute();

        // If status changed from REGISTERED to ASSIGNED, record status history
        if (shouldAdvanceToAssigned) {
          const statusHistoryId = generateUuidV7();
          await this.statusHistoryRepo.record(
            {
              status_history_id: statusHistoryId,
              service_case_id: input.serviceCaseId,
              from_status: 'REGISTERED',
              to_status: 'ASSIGNED',
              changed_by_user_id: input.actorUserId,
              transition_reason: isEmergency
                ? `Emergency cross-district dispatch: ${input.emergencyJustification}`
                : 'Engineer dispatched',
            },
            trx,
          );
        }
      } else {
        await trx
          .updateTable('service_cases')
          .set({
            assigned_secondary_engineer_id: input.engineerId,
            updated_at: now,
          })
          .where('service_case_id', '=', input.serviceCaseId)
          .execute();
      }

      // 5. Record in immutable assignment_history ledger
      const assignmentHistoryId = generateUuidV7();
      await this.assignmentHistoryRepo.record(
        {
          assignment_history_id: assignmentHistoryId,
          service_case_id: input.serviceCaseId,
          assigned_by_user_id: input.actorUserId,
          engineer_id: input.engineerId,
          assignment_role: role,
          previous_engineer_id: previousEngineerId || null,
          action: action,
          assigned_at: now,
          reassignment_reason: input.reassignmentReason || null,
          is_emergency_cross_district: isEmergency,
          emergency_justification: input.emergencyJustification || null,
        },
        trx,
      );

      // 6. Record Administrative Audit Log
      await this.auditRepo.logEvent(
        {
          actorUserId: input.actorUserId,
          actorIpAddress: input.actorIpAddress,
          actorDeviceId: input.actorDeviceId,
          eventCategory: 'SERVICE_CASE',
          targetEntityType: 'SERVICE_CASE',
          targetEntityId: input.serviceCaseId,
          actionType: isEmergency ? 'EMERGENCY_DISPATCH' : 'DISPATCH_ASSIGNMENT',
          preMutationState: {
            assignedEngineerId: previousEngineerId,
            assignmentRole: role,
          },
          postMutationState: {
            assignedEngineerId: input.engineerId,
            assignmentRole: role,
            action,
            isEmergencyCrossDistrict: isEmergency,
            emergencyJustification: input.emergencyJustification,
          },
        },
        trx,
      );

      return await this.casesRepo.findById(input.serviceCaseId, trx);
    });
  }

  /**
   * Retrieves eligible engineers for a district/block with workload counts
   */
  async getEligibleEngineers(
    districtId: string,
    blockId?: string,
    workloadCapacityThreshold: number = CANDIDATE_DEFAULT_WORKLOAD_CAPACITY,
  ): Promise<EngineerWorkloadSummary[]> {
    // 1. Find all active engineers assigned to this district
    let query = this.db
      .selectFrom('users as u')
      .innerJoin('user_roles as ur', 'ur.user_id', 'u.user_id')
      .innerJoin('roles as r', 'r.role_id', 'ur.role_id')
      .innerJoin('user_territory_assignments as uta', 'uta.user_id', 'u.user_id')
      .innerJoin('districts as d', 'd.district_id', 'uta.district_id')
      .where('r.role_code', '=', 'FIELD_ENGINEER')
      .where('u.account_status', '=', 'ACTIVE')
      .where('u.is_active', '=', true)
      .where('uta.district_id', '=', districtId)
      .where((eb) =>
        eb.or([eb('uta.valid_to', 'is', null), eb('uta.valid_to', '>', new Date())]),
      )
      .select([
        'u.user_id',
        'u.full_name',
        'u.phone_number',
        'uta.district_id',
        'd.district_name',
        'uta.block_id',
        'uta.is_primary_territory',
      ]);

    if (blockId) {
      query = query.where((eb) =>
        eb.or([eb('uta.block_id', 'is', null), eb('uta.block_id', '=', blockId)]),
      );
    }

    const engineerRows = await query.execute();

    // Deduplicate by user_id
    const engineerMap = new Map<string, {
      userId: string;
      fullName: string;
      phoneNumber: string | null;
      districtId: string;
      districtName: string;
      blockIds: string[];
    }>();

    for (const row of engineerRows) {
      const existing = engineerMap.get(row.user_id);
      if (existing) {
        if (row.block_id && !existing.blockIds.includes(row.block_id)) {
          existing.blockIds.push(row.block_id);
        }
      } else {
        engineerMap.set(row.user_id, {
          userId: row.user_id,
          fullName: row.full_name,
          phoneNumber: row.phone_number,
          districtId: row.district_id,
          districtName: row.district_name,
          blockIds: row.block_id ? [row.block_id] : [],
        });
      }
    }

    const results: EngineerWorkloadSummary[] = [];

    // 2. Count active workload for each engineer
    const activeStatuses = [
      'ASSIGNED',
      'IN_TRANSIT',
      'VISIT_STARTED',
      'IN_PROGRESS',
      'PENDING_PARTS',
      'ESCALATED_OEM',
    ];

    for (const eng of engineerMap.values()) {
      const activeCasesCount = await this.casesRepo.countActiveCasesByEngineer(
        eng.userId,
        activeStatuses,
      );

      results.push({
        engineerId: eng.userId,
        fullName: eng.fullName,
        phoneNumber: eng.phoneNumber || null,
        districtId: eng.districtId,
        districtName: eng.districtName,
        blockIds: eng.blockIds,
        activeAssignedCasesCount: activeCasesCount,
        isAvailable: activeCasesCount < workloadCapacityThreshold,
        configuredCapacityThreshold: workloadCapacityThreshold,
      });
    }

    // Sort by lowest workload first
    results.sort((a, b) => a.activeAssignedCasesCount - b.activeAssignedCasesCount);

    return results;
  }
}

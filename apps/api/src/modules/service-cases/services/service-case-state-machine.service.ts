/**
 * ZENTRA — Service Case State Machine Service
 * apps/api/src/modules/service-cases/services/service-case-state-machine.service.ts
 *
 * Enforces the strict 10-state operational lifecycle state machine:
 * REGISTERED -> ASSIGNED -> IN_TRANSIT -> VISIT_STARTED -> IN_PROGRESS
 *  <-> PENDING_PARTS <-> ESCALATED_OEM -> RESOLVED -> VERIFIED -> CLOSED
 *
 * Prohibits invalid state jumps and enforces prerequisites.
 * Records transition in immutable service_case_status_history and audit_events.
 */

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { OperationalStatus } from '@zentra/types';
import { ServiceCasesRepository } from '../repositories/service-cases.repository';
import { StatusHistoryRepository } from '../repositories/status-history.repository';
import { CaseAuditEventsRepository } from '../repositories/audit-events.repository';
import { generateUuidV7 } from '@zentra/shared';
import { Kysely } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import { Inject } from '@nestjs/common';
import type { DatabaseSchema } from '../../../database/database.types';

export const VALID_TRANSITIONS: Record<OperationalStatus, OperationalStatus[]> = {
  REGISTERED: ['ASSIGNED'],
  ASSIGNED: ['IN_TRANSIT', 'REGISTERED'],
  IN_TRANSIT: ['VISIT_STARTED', 'ASSIGNED'],
  VISIT_STARTED: ['IN_PROGRESS'],
  IN_PROGRESS: ['PENDING_PARTS', 'ESCALATED_OEM', 'RESOLVED'],
  PENDING_PARTS: ['IN_PROGRESS', 'ESCALATED_OEM', 'RESOLVED'],
  ESCALATED_OEM: ['IN_PROGRESS', 'PENDING_PARTS', 'RESOLVED'],
  RESOLVED: ['VERIFIED', 'IN_PROGRESS'],
  VERIFIED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: ['IN_PROGRESS'], // Re-open by authorized personnel
};

export interface TransitionContext {
  serviceCaseId: string;
  targetStatus: OperationalStatus;
  actorUserId: string;
  reason?: string | null;
  notes?: string | null;
  actorIpAddress?: string | null;
  actorDeviceId?: string | null;
}

@Injectable()
export class ServiceCaseStateMachineService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
    @Inject(ServiceCasesRepository)
    private readonly casesRepo: ServiceCasesRepository,
    @Inject(StatusHistoryRepository)
    private readonly statusHistoryRepo: StatusHistoryRepository,
    @Inject(CaseAuditEventsRepository)
    private readonly auditRepo: CaseAuditEventsRepository,
  ) {}

  /**
   * Evaluates whether a transition from fromStatus to toStatus is valid
   */
  isValidTransition(fromStatus: OperationalStatus, toStatus: OperationalStatus): boolean {
    const allowed = VALID_TRANSITIONS[fromStatus];
    if (!allowed) return false;
    return allowed.includes(toStatus);
  }

  /**
   * Executes an atomic state machine transition
   */
  async transition(context: TransitionContext) {
    return await this.db.transaction().execute(async (trx) => {
      const currentCase = await this.casesRepo.findById(context.serviceCaseId, trx);
      if (!currentCase) {
        throw new NotFoundException(`Service case ${context.serviceCaseId} not found`);
      }

      const currentStatus = currentCase.operationalStatus as OperationalStatus;
      const targetStatus = context.targetStatus;

      // 1. Validate state machine transition graph
      if (!this.isValidTransition(currentStatus, targetStatus)) {
        throw new BadRequestException(
          `Invalid state transition: Cannot transition service case from '${currentStatus}' to '${targetStatus}'. Allowed transitions: [${(VALID_TRANSITIONS[currentStatus] || []).join(', ')}]`,
        );
      }

      // 2. Validate prerequisites
      if (targetStatus === 'ASSIGNED' && !currentCase.assignedPrimaryEngineerId) {
        throw new BadRequestException(
          `Cannot transition to ASSIGNED: Service case does not have a primary engineer designated. Please dispatch an engineer first.`,
        );
      }

      if (targetStatus === 'RESOLVED' && !context.notes && !context.reason) {
        throw new BadRequestException(
          `Transition to RESOLVED requires resolution notes or reason.`,
        );
      }

      // 3. Update service case record
      await this.casesRepo.updateStatus(
        context.serviceCaseId,
        targetStatus,
        trx,
      );

      // 4. Record append-only immutable status history
      const statusHistoryId = generateUuidV7();
      await this.statusHistoryRepo.record(
        {
          status_history_id: statusHistoryId,
          service_case_id: context.serviceCaseId,
          from_status: currentStatus,
          to_status: targetStatus,
          changed_by_user_id: context.actorUserId,
          transition_reason: context.reason || context.notes || null,
        },
        trx,
      );

      // 5. Record Administrative Audit Log
      await this.auditRepo.logEvent(
        {
          actorUserId: context.actorUserId,
          actorIpAddress: context.actorIpAddress,
          actorDeviceId: context.actorDeviceId,
          eventCategory: 'SERVICE_CASE',
          targetEntityType: 'SERVICE_CASE',
          targetEntityId: context.serviceCaseId,
          actionType: 'STATUS_TRANSITION',
          preMutationState: { operationalStatus: currentStatus },
          postMutationState: { operationalStatus: targetStatus, reason: context.reason },
        },
        trx,
      );

      // Return updated case
      const updatedCase = await this.casesRepo.findById(context.serviceCaseId, trx);
      return updatedCase;
    });
  }
}

/**
 * ZENTRA — Service Cases Orchestrator Service
 * apps/api/src/modules/service-cases/services/service-cases.service.ts
 *
 * Coordinates service case lifecycle:
 * - Creation from approved, committed source complaints
 * - Unique natural identity and business case code generation
 * - SLA calculation and breach tracking
 * - Delegation to State Machine and Dispatch Engine
 * - Administrative Audit Logging
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Kysely, type Transaction } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema } from '../../../database/database.types';
import { ServiceCasesRepository } from '../repositories/service-cases.repository';
import { StatusHistoryRepository } from '../repositories/status-history.repository';
import { AssignmentHistoryRepository } from '../repositories/assignment-history.repository';
import { CaseAuditEventsRepository } from '../repositories/audit-events.repository';
import { SlaPoliciesRepository } from '../repositories/sla-policies.repository';
import { SlaEngineService } from './sla-engine.service';
import { ServiceCaseStateMachineService } from './service-case-state-machine.service';
import { DispatchEngineService } from './dispatch-engine.service';
import { RlsService } from '../../auth/rls.service';
import { generateUuidV7 } from '@zentra/shared';
import type {
  ServiceCase,
  CasePriority,
  OperationalStatus,
  ServiceCaseQueryFilters,
  AssignmentRole,
  AccessTokenClaims,
  UserRole,
  AssignmentHistoryEntry,
} from '@zentra/types';

const RECOGNIZED_ROLES = new Set<string>([
  'MASTER_ADMIN',
  'REPORTING_HEAD',
  'DISTRICT_COORDINATOR',
  'FIELD_ENGINEER',
  'AI',
  'HM',
]);

function isRecognizedRole(role: unknown): role is UserRole {
  return typeof role === 'string' && RECOGNIZED_ROLES.has(role);
}

export interface CreateServiceCaseInput {
  sourceComplaintId: string;
  internalPriority?: CasePriority;
  initialEngineerId?: string;
  actorUserId: string;
  actorIpAddress?: string | null;
  actorDeviceId?: string | null;
}

export interface TransitionCaseInput {
  serviceCaseId: string;
  targetStatus: OperationalStatus;
  reason?: string | null;
  notes?: string | null;
  actorUserId: string;
  actorIpAddress?: string | null;
  actorDeviceId?: string | null;
}

export interface DispatchCaseInput {
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
export class ServiceCasesService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
    @Inject(ServiceCasesRepository)
    private readonly casesRepo: ServiceCasesRepository,
    @Inject(StatusHistoryRepository)
    private readonly statusHistoryRepo: StatusHistoryRepository,
    @Inject(AssignmentHistoryRepository)
    private readonly assignmentHistoryRepo: AssignmentHistoryRepository,
    @Inject(CaseAuditEventsRepository)
    private readonly auditRepo: CaseAuditEventsRepository,
    @Inject(SlaPoliciesRepository)
    private readonly slaPoliciesRepo: SlaPoliciesRepository,
    @Inject(SlaEngineService)
    private readonly slaEngine: SlaEngineService,
    @Inject(ServiceCaseStateMachineService)
    private readonly stateMachine: ServiceCaseStateMachineService,
    @Inject(DispatchEngineService)
    private readonly dispatchEngine: DispatchEngineService,
    @Inject(RlsService)
    private readonly rlsService: RlsService,
  ) {}

  /**
   * Generates formatted unique case code: ZNT-{YEAR}-{DISTRICT_CODE}-{6_DIGIT_SEQ}
   */
  async generateCaseCode(districtId: string): Promise<string> {
    const currentYear = new Date().getFullYear();
    const district = await this.db
      .selectFrom('districts')
      .select('district_code')
      .where('district_id', '=', districtId)
      .executeTakeFirst();

    const distCode = (district?.district_code || 'DST').toUpperCase();
    const prefix = `ZNT-${currentYear}-${distCode}-`;

    const countRow = await this.db
      .selectFrom('service_cases')
      .select((eb) => eb.fn.count<number>('service_case_id').as('cnt'))
      .where('zentra_case_code', 'like', `${prefix}%`)
      .executeTakeFirst();

    const nextNum = (Number(countRow?.cnt) || 0) + 1;
    const seqPadded = String(nextNum).padStart(6, '0');
    return `${prefix}${seqPadded}`;
  }

  /**
   * Creates a new service case from a committed source complaint.
   * Enforces 1:1 uniqueness and rejects unapproved/draft complaints.
   */
  async createFromSourceComplaint(input: CreateServiceCaseInput) {
    return await this.db.transaction().execute(async (trx) => {
      // 1. Fetch source complaint
      const sourceComplaint = await trx
        .selectFrom('source_complaints')
        .selectAll()
        .where('source_complaint_id', '=', input.sourceComplaintId)
        .executeTakeFirst();

      if (!sourceComplaint) {
        throw new NotFoundException(
          `Source complaint ${input.sourceComplaintId} not found`,
        );
      }

      // Check if complaint is in draft status
      if (sourceComplaint.source_status === 'DRAFT') {
        throw new BadRequestException(
          `Cannot create service case from DRAFT source complaint. Complaint must be verified or active.`,
        );
      }

      // 2. Enforce 1:1 uniqueness constraint
      const existingCase = await this.casesRepo.findBySourceComplaintId(
        input.sourceComplaintId,
        trx,
      );
      if (existingCase) {
        throw new ConflictException(
          `Service case already exists for source complaint ${input.sourceComplaintId} (Case Code: ${existingCase.zentra_case_code})`,
        );
      }

      // 3. Resolve lab ID for school
      let labId = sourceComplaint.lab_id;
      if (!labId) {
        const lab = await trx
          .selectFrom('hi_tech_labs')
          .select('lab_id')
          .where('school_id', '=', sourceComplaint.school_id)
          .where('is_active', '=', true)
          .limit(1)
          .executeTakeFirst();

        if (!lab) {
          throw new BadRequestException(
            `School ${sourceComplaint.school_id} does not have an active Hi-Tech Lab. Cannot create service case.`,
          );
        }
        labId = lab.lab_id;
      }

      // 4. Resolve district to generate case code
      const school = await trx
        .selectFrom('schools')
        .select(['school_id', 'district_id'])
        .where('school_id', '=', sourceComplaint.school_id)
        .executeTakeFirst();

      if (!school) {
        throw new NotFoundException(`School ${sourceComplaint.school_id} not found`);
      }

      const caseCode = await this.generateCaseCode(school.district_id);

      // 5. Resolve Priority and SLA
      const priority = (input.internalPriority ||
        sourceComplaint.source_priority ||
        'MEDIUM') as CasePriority;

      const slaPolicy = await this.slaPoliciesRepo.findByPriority(priority, trx);
      const slaTargetAt = slaPolicy
        ? this.slaEngine.calculateTargetDate(new Date(), slaPolicy.targetResolutionHours)
        : null;

      const serviceCaseId = generateUuidV7();

      // 6. Insert service case record
      await this.casesRepo.create(
        {
          service_case_id: serviceCaseId,
          source_complaint_id: input.sourceComplaintId,
          zentra_case_code: caseCode,
          school_id: sourceComplaint.school_id,
          lab_id: labId,
          lab_equipment_id: null,
          operational_status: 'REGISTERED',
          internal_priority: priority,
          assigned_primary_engineer_id: null,
          assigned_secondary_engineer_id: null,
          assigned_at: null,
          sla_policy_id: slaPolicy ? slaPolicy.slaPolicyId : null,
          sla_target_at: slaTargetAt,
          sla_breach_status: 'WITHIN_SLA',
        },
        trx,
      );

      // 7. Record initial status history
      const statusHistoryId = generateUuidV7();
      await this.statusHistoryRepo.record(
        {
          status_history_id: statusHistoryId,
          service_case_id: serviceCaseId,
          from_status: 'REGISTERED',
          to_status: 'REGISTERED',
          changed_by_user_id: input.actorUserId,
          transition_reason: `Initial case creation from complaint ticket ${sourceComplaint.external_ticket_id}`,
        },
        trx,
      );

      // 8. Record Administrative Audit Log
      await this.auditRepo.logEvent(
        {
          actorUserId: input.actorUserId,
          actorIpAddress: input.actorIpAddress,
          actorDeviceId: input.actorDeviceId,
          eventCategory: 'SERVICE_CASE',
          targetEntityType: 'SERVICE_CASE',
          targetEntityId: serviceCaseId,
          actionType: 'CREATE_FROM_SOURCE_COMPLAINT',
          preMutationState: null,
          postMutationState: {
            caseCode,
            sourceComplaintId: input.sourceComplaintId,
            schoolId: sourceComplaint.school_id,
            priority,
            operationalStatus: 'REGISTERED',
          },
        },
        trx,
      );

      // 9. If initial engineer specified, dispatch immediately
      if (input.initialEngineerId) {
        await this.dispatchEngine.assignEngineer({
          serviceCaseId,
          engineerId: input.initialEngineerId,
          assignmentRole: 'PRIMARY',
          actorUserId: input.actorUserId,
          actorIpAddress: input.actorIpAddress,
          actorDeviceId: input.actorDeviceId,
        });
      }

      return await this.casesRepo.findById(serviceCaseId, trx);
    });
  }

  private resolveSecurityRole(user: AccessTokenClaims): string {
    if (!user || !user.roles || !Array.isArray(user.roles) || user.roles.length === 0) {
      throw new ForbiddenException('Forbidden resource: principal has no assigned security roles');
    }

    if (user.activeRole) {
      if (!isRecognizedRole(user.activeRole)) {
        throw new ForbiddenException(`Forbidden resource: invalid active role '${user.activeRole}'`);
      }
      if (!user.roles.includes(user.activeRole)) {
        throw new ForbiddenException(`Forbidden resource: active role '${user.activeRole}' is not an authorized role`);
      }
      return user.activeRole;
    }

    const candidateRole = user.roles[0];
    if (!candidateRole || !isRecognizedRole(candidateRole)) {
      throw new ForbiddenException(`Forbidden resource: invalid role '${candidateRole}'`);
    }

    return candidateRole;
  }

  /**
   * Retrieves single service case with joined relations and histories
   */
  async getCaseById(serviceCaseId: string, user?: AccessTokenClaims) {
    const executeGet = async (trx?: Transaction<DatabaseSchema>) => {
      const serviceCase = await this.casesRepo.findById(serviceCaseId, trx);
      if (!serviceCase) {
        throw new NotFoundException(`Service case ${serviceCaseId} not found`);
      }

      const statusHistory = await this.statusHistoryRepo.findByCaseId(serviceCaseId, trx);
      const assignmentHistory = await this.assignmentHistoryRepo.findByCaseId(serviceCaseId, trx);

      return { serviceCase, statusHistory, assignmentHistory };
    };

    const { serviceCase, statusHistory, assignmentHistory } = user
      ? await this.rlsService.withSecurityContext(
          {
            userId: user.sub,
            role: this.resolveSecurityRole(user),
          },
          async (trx) => executeGet(trx),
        )
      : await executeGet();

    // Compute live SLA evaluation
    let slaEvaluation = null;
    if (serviceCase.slaTargetAt) {
      slaEvaluation = this.slaEngine.evaluateSlaStatus(
        new Date(serviceCase.createdAt),
        new Date(serviceCase.slaTargetAt),
        serviceCase.operationalStatus,
      );
    }

    return {
      ...serviceCase,
      slaEvaluation,
      statusHistory,
      assignmentHistory,
    };
  }

  /**
   * Query service cases with filters and pagination
   */
  async queryCases(filters: ServiceCaseQueryFilters, user?: AccessTokenClaims) {
    const executeQuery = (trx?: Transaction<DatabaseSchema>) => this.casesRepo.findCases(filters, trx);

    const result = user
      ? await this.rlsService.withSecurityContext(
          {
            userId: user.sub,
            role: this.resolveSecurityRole(user),
          },
          async (trx) => executeQuery(trx),
        )
      : await executeQuery();

    // Attach live SLA metrics to each item
    const itemsWithSla = result.items.map((item: ServiceCase) => {
      let slaEvaluation = null;
      if (item.slaTargetAt) {
        slaEvaluation = this.slaEngine.evaluateSlaStatus(
          new Date(item.createdAt),
          new Date(item.slaTargetAt),
          item.operationalStatus,
        );
      }
      return {
        ...item,
        slaEvaluation,
      };
    });

    return {
      ...result,
      items: itemsWithSla,
    };
  }

  /**
   * Transition case status via State Machine
   */
  async transitionStatus(input: TransitionCaseInput) {
    return await this.stateMachine.transition(input);
  }

  /**
   * Dispatch / assign engineer via Dispatch Engine
   */
  async assignEngineer(input: DispatchCaseInput) {
    return await this.dispatchEngine.assignEngineer(input);
  }

  /**
   * List eligible engineers with workloads and optional capacity threshold
   */
  async getEligibleEngineers(districtId: string, blockId?: string, capacityThreshold?: number) {
    return await this.dispatchEngine.getEligibleEngineers(districtId, blockId, capacityThreshold);
  }

  /**
   * Retrieve assignment history for a case with RLS context
   */
  async getAssignmentHistory(
    serviceCaseId: string,
    user?: AccessTokenClaims,
  ): Promise<AssignmentHistoryEntry[]> {
    const executeGet = (trx?: Transaction<DatabaseSchema>) =>
      this.assignmentHistoryRepo.findByCaseId(serviceCaseId, trx);

    if (user) {
      return await this.rlsService.withSecurityContext(
        {
          userId: user.sub,
          role: this.resolveSecurityRole(user),
        },
        async (trx) => executeGet(trx),
      );
    }

    return await executeGet();
  }

  /**
   * Retrieve active SLA policies
   */
  async getSlaPolicies() {
    return await this.slaPoliciesRepo.findActivePolicies();
  }
}

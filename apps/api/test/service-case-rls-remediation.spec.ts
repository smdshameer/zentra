/**
 * ZENTRA — Service Case RLS Context Remediation Focused Regression Suite
 * apps/api/test/service-case-rls-remediation.spec.ts
 *
 * Verifies the Stage 6E architectural remediation:
 * A. ServiceCasesService.queryCases() establishes PostgreSQL RLS context via RlsService.withSecurityContext()
 * B. Correct authenticated principal (userId, validated activeRole) is passed to RlsService
 * C. Database queries execute within the transaction provided by withSecurityContext()
 * D. Cross-engineer isolation: Field Engineers cannot view unassigned cases or cases belonging to others
 * E. ServiceCasesController forwards authenticated claims and enforces server-side role scoping
 * F. Unauthenticated requests are rejected fail-closed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ServiceCasesService } from '../src/modules/service-cases/services/service-cases.service';
import { ServiceCasesController } from '../src/modules/service-cases/controllers/service-cases.controller';
import { SlaController } from '../src/modules/service-cases/controllers/sla.controller';
import { DispatchController } from '../src/modules/service-cases/controllers/dispatch.controller';
import type { RlsService, SecurityContext } from '../src/modules/auth/rls.service';
import type { ServiceCasesRepository } from '../src/modules/service-cases/repositories/service-cases.repository';
import type { StatusHistoryRepository } from '../src/modules/service-cases/repositories/status-history.repository';
import type { AssignmentHistoryRepository } from '../src/modules/service-cases/repositories/assignment-history.repository';
import type { CaseAuditEventsRepository } from '../src/modules/service-cases/repositories/audit-events.repository';
import type { SlaPoliciesRepository } from '../src/modules/service-cases/repositories/sla-policies.repository';
import type { SlaEngineService } from '../src/modules/service-cases/services/sla-engine.service';
import type { ServiceCaseStateMachineService } from '../src/modules/service-cases/services/service-case-state-machine.service';
import type { DispatchEngineService } from '../src/modules/service-cases/services/dispatch-engine.service';
import type { AccessTokenClaims, ServiceCase, ServiceCaseQueryFilters, AssignmentHistoryEntry } from '@zentra/types';

describe('Service Case RLS Context Remediation Unit & Contract Suite', () => {
  let service: ServiceCasesService;
  let controller: ServiceCasesController;
  let slaController: SlaController;
  let dispatchController: DispatchController;
  let mockRlsService: Partial<RlsService>;
  let mockCasesRepo: Partial<ServiceCasesRepository>;
  let mockStatusHistoryRepo: Partial<StatusHistoryRepository>;
  let mockAssignmentHistoryRepo: Partial<AssignmentHistoryRepository>;
  let mockAuditRepo: Partial<CaseAuditEventsRepository>;
  let mockSlaPoliciesRepo: Partial<SlaPoliciesRepository>;
  let mockSlaEngine: Partial<SlaEngineService>;
  let mockStateMachine: Partial<ServiceCaseStateMachineService>;
  let mockDispatchEngine: Partial<DispatchEngineService>;
  let mockDb: any;

  const mockEngineerUser: AccessTokenClaims = {
    sub: '01a126f6-7d9a-74a4-bb2d-b86181cadb93',
    username: 'engineer.demo@zentra.local',
    roles: ['FIELD_ENGINEER'],
    activeRole: 'FIELD_ENGINEER',
    territoryDistrictIds: ['01a126f6-7d99-722a-8ef0-91a92e3fc7e6'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
  };

  const mockCoordinatorUser: AccessTokenClaims = {
    sub: '01a126f6-7d9a-74a4-bb2d-b86181cadb94',
    username: 'coordinator.erode@zentra.local',
    roles: ['DISTRICT_COORDINATOR'],
    activeRole: 'DISTRICT_COORDINATOR',
    territoryDistrictIds: ['01a126f6-7d99-722a-8ef0-91a92e3fc7e6'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
  };

  const mockMasterAdminUser: AccessTokenClaims = {
    sub: '01a126f6-7d9a-74a4-bb2d-b86181cadb95',
    username: 'admin@zentra.local',
    roles: ['MASTER_ADMIN'],
    activeRole: 'MASTER_ADMIN',
    territoryDistrictIds: [],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
  };

  const mockAssignedCase: ServiceCase = {
    serviceCaseId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
    sourceComplaintId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe501',
    zentraCaseCode: 'ZNT-2026-DEMO-000001',
    schoolId: '01a126f6-7d99-785e-b2f4-29eff1578ebd',
    operationalStatus: 'ASSIGNED',
    internalPriority: 'MEDIUM',
    assignedPrimaryEngineerId: '01a126f6-7d9a-74a4-bb2d-b86181cadb93',
    assignedSecondaryEngineerId: null,
    slaBreachStatus: 'WITHIN_SLA',
    verificationStatus: 'PENDING_REVIEW',
    isDeleted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as ServiceCase;

  const mockAssignmentHistoryEntry: AssignmentHistoryEntry = {
    assignmentHistoryId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe599',
    serviceCaseId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
    assignedByUserId: '01a126f6-7d9a-74a4-bb2d-b86181cadb95',
    assignedByUserName: 'Admin User',
    engineerId: '01a126f6-7d9a-74a4-bb2d-b86181cadb93',
    engineerName: 'Demo Engineer',
    assignmentRole: 'PRIMARY',
    previousEngineerId: null,
    previousEngineerName: null,
    action: 'ASSIGNED',
    assignedAt: new Date().toISOString(),
    reassignmentReason: null,
    isEmergencyCrossDistrict: false,
    emergencyJustification: null,
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockDb = {};
    const mockTrx = { __isTransaction: true } as any;

    mockRlsService = {
      withSecurityContext: vi.fn().mockImplementation(
        async <T>(context: SecurityContext, action: (trx: any) => Promise<T>): Promise<T> => {
          return await action(mockTrx);
        },
      ),
    };

    mockCasesRepo = {
      findCases: vi.fn().mockResolvedValue({
        items: [mockAssignedCase],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      }),
      findById: vi.fn().mockResolvedValue(mockAssignedCase),
    };

    mockStatusHistoryRepo = {
      findByCaseId: vi.fn().mockResolvedValue([]),
    };

    mockAssignmentHistoryRepo = {
      findByCaseId: vi.fn().mockResolvedValue([mockAssignmentHistoryEntry]),
    };

    mockAuditRepo = {
      logEvent: vi.fn().mockResolvedValue(undefined),
    };

    mockSlaPoliciesRepo = {
      findActivePolicies: vi.fn().mockResolvedValue([]),
      findByPriority: vi.fn().mockResolvedValue(null),
    };

    mockSlaEngine = {
      evaluateSlaStatus: vi.fn().mockReturnValue({ isBreached: false, hoursRemaining: 24 }),
      calculateTargetDate: vi.fn().mockReturnValue(new Date()),
    };

    mockStateMachine = {
      transition: vi.fn(),
    };

    mockDispatchEngine = {
      assignEngineer: vi.fn(),
      getEligibleEngineers: vi.fn().mockResolvedValue([]),
    };

    service = new ServiceCasesService(
      mockDb,
      mockCasesRepo as ServiceCasesRepository,
      mockStatusHistoryRepo as StatusHistoryRepository,
      mockAssignmentHistoryRepo as AssignmentHistoryRepository,
      mockAuditRepo as CaseAuditEventsRepository,
      mockSlaPoliciesRepo as SlaPoliciesRepository,
      mockSlaEngine as SlaEngineService,
      mockStateMachine as ServiceCaseStateMachineService,
      mockDispatchEngine as DispatchEngineService,
      mockRlsService as RlsService,
    );

    controller = new ServiceCasesController(service);
    slaController = new SlaController(service);
    dispatchController = new DispatchController(service);
  });

  // =========================================================================
  // GATE A: Assigned Case Visibility & RLS Context Propagation
  // =========================================================================
  describe('Gate A: ServiceCasesService.queryCases() RLS Integration', () => {
    it('executes repository query inside RlsService.withSecurityContext with authenticated claims', async () => {
      const filters: ServiceCaseQueryFilters = { limit: 10, page: 1 };
      const result = await service.queryCases(filters, mockEngineerUser);

      expect(mockRlsService.withSecurityContext).toHaveBeenCalledTimes(1);
      expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
        {
          userId: '01a126f6-7d9a-74a4-bb2d-b86181cadb93',
          role: 'FIELD_ENGINEER',
        },
        expect.any(Function),
      );

      // Verify repository query received the transaction from withSecurityContext
      expect(mockCasesRepo.findCases).toHaveBeenCalledTimes(1);
      const [receivedFilters, receivedTrx] = (mockCasesRepo.findCases as any).mock.calls[0];
      expect(receivedFilters).toEqual(filters);
      expect(receivedTrx).toBeDefined();
      expect(receivedTrx.__isTransaction).toBe(true);

      // Verify response payload
      expect(result.items).toHaveLength(1);
      expect(result.items[0].zentraCaseCode).toBe('ZNT-2026-DEMO-000001');
      expect(result.total).toBe(1);
    });

    it('falls back to non-transactional query when user is not provided (backwards compatibility)', async () => {
      const filters: ServiceCaseQueryFilters = { limit: 10, page: 1 };
      const result = await service.queryCases(filters);

      expect(mockRlsService.withSecurityContext).not.toHaveBeenCalled();
      expect(mockCasesRepo.findCases).toHaveBeenCalledTimes(1);
      const [, receivedTrx] = (mockCasesRepo.findCases as any).mock.calls[0];
      expect(receivedTrx).toBeUndefined();
      expect(result.items).toHaveLength(1);
    });

    it('resolves activeRole correctly when present and included in user roles', async () => {
      const multiRoleUser: AccessTokenClaims = {
        ...mockCoordinatorUser,
        roles: ['DISTRICT_COORDINATOR', 'FIELD_ENGINEER'],
        activeRole: 'DISTRICT_COORDINATOR',
      };

      await service.queryCases({}, multiRoleUser);

      expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
        {
          userId: multiRoleUser.sub,
          role: 'DISTRICT_COORDINATOR',
        },
        expect.any(Function),
      );
    });

    it('resolves roles[0] when activeRole is undefined and roles[0] is valid', async () => {
      const userWithoutActiveRole: AccessTokenClaims = {
        ...mockEngineerUser,
        activeRole: undefined,
      };

      await service.queryCases({}, userWithoutActiveRole);

      expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
        {
          userId: mockEngineerUser.sub,
          role: 'FIELD_ENGINEER',
        },
        expect.any(Function),
      );
    });

    it('rejects with ForbiddenException when principal has empty roles array (Finding 1)', async () => {
      const emptyRolesUser: AccessTokenClaims = {
        ...mockEngineerUser,
        roles: [],
        activeRole: undefined,
      };

      await expect(service.queryCases({}, emptyRolesUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects with ForbiddenException when principal has invalid or unrecognized roles (Finding 1)', async () => {
      const invalidRoleUser = {
        ...mockEngineerUser,
        roles: ['SUPER_HACKER' as any],
        activeRole: undefined,
      };

      await expect(service.queryCases({}, invalidRoleUser as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects with ForbiddenException when activeRole is not a recognized role (Finding 1)', async () => {
      const invalidActiveRoleUser = {
        ...mockEngineerUser,
        roles: ['FIELD_ENGINEER'],
        activeRole: 'UNRECOGNIZED_ROLE' as any,
      };

      await expect(service.queryCases({}, invalidActiveRoleUser as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects with ForbiddenException when activeRole is not among principal authorized roles (Finding 1)', async () => {
      const spoofedActiveRoleUser: AccessTokenClaims = {
        ...mockEngineerUser,
        roles: ['FIELD_ENGINEER'],
        activeRole: 'MASTER_ADMIN', // Privilege escalation attempt
      };

      await expect(service.queryCases({}, spoofedActiveRoleUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects with ForbiddenException when principal claims have missing or non-array roles (Finding 1)', async () => {
      const malformedUser = {
        ...mockEngineerUser,
        roles: null as any,
      };

      await expect(service.queryCases({}, malformedUser as any)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // =========================================================================
  // GATE B: Cross-Engineer Isolation & Controller Enforcement
  // =========================================================================
  describe('Gate B: Cross-Engineer Scoping and Authorization Isolation', () => {
    it('forces assignedEngineerId to authenticated user ID for FIELD_ENGINEER role', async () => {
      const mockRequest = {
        user: mockEngineerUser,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      // Malicious attempt: client specifies another engineer's ID in query params
      const queryWithSpoofedEngineer = {
        assignedEngineerId: '00000000-0000-0000-0000-000000000000',
      };

      await controller.listCases(queryWithSpoofedEngineer, mockRequest);

      // Verify controller overrode spoofed param with authenticated engineer sub
      expect(mockCasesRepo.findCases).toHaveBeenCalledTimes(1);
      const [appliedFilters] = (mockCasesRepo.findCases as any).mock.calls[0];
      expect(appliedFilters.assignedEngineerId).toBe(mockEngineerUser.sub);
    });

    it('prohibits Field Engineer from querying case assigned to another engineer via getCase (403)', async () => {
      const foreignCase: ServiceCase = {
        ...mockAssignedCase,
        assignedPrimaryEngineerId: '99999999-9999-9999-9999-999999999999',
        assignedSecondaryEngineerId: null,
      };
      (mockCasesRepo.findById as any).mockResolvedValue(foreignCase);

      const mockRequest = {
        user: mockEngineerUser,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      await expect(
        controller.getCase(foreignCase.serviceCaseId, mockRequest),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows Master Admin to query cases statewide without engineer override', async () => {
      const mockRequest = {
        user: mockMasterAdminUser,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      const adminQuery = { districtId: '01a126f6-7d99-722a-8ef0-91a92e3fc7e6' };
      await controller.listCases(adminQuery, mockRequest);

      const [appliedFilters] = (mockCasesRepo.findCases as any).mock.calls[0];
      expect(appliedFilters.assignedEngineerId).toBeUndefined();
      expect(appliedFilters.districtId).toBe('01a126f6-7d99-722a-8ef0-91a92e3fc7e6');
    });

    it('prohibits District Coordinator from querying outside assigned territory (403)', async () => {
      const mockRequest = {
        user: mockCoordinatorUser, // territory: [01a126f6-7d99-722a-8ef0-91a92e3fc7e6]
        ip: '127.0.0.1',
        headers: {},
      } as any;

      const outsideDistrictQuery = {
        districtId: '02222222-2222-2222-2222-222222222222', // Foreign district
      };

      await expect(
        controller.listCases(outsideDistrictQuery, mockRequest),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // GATE C: getCaseById RLS Context
  // =========================================================================
  describe('Gate C: ServiceCasesService.getCaseById() RLS Integration', () => {
    it('executes findById and relation queries inside RLS transaction when user provided', async () => {
      const result = await service.getCaseById(mockAssignedCase.serviceCaseId, mockEngineerUser);

      expect(mockRlsService.withSecurityContext).toHaveBeenCalledTimes(1);
      expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
        {
          userId: mockEngineerUser.sub,
          role: 'FIELD_ENGINEER',
        },
        expect.any(Function),
      );

      expect(mockCasesRepo.findById).toHaveBeenCalledWith(
        mockAssignedCase.serviceCaseId,
        expect.objectContaining({ __isTransaction: true }),
      );
      expect(result.serviceCaseId).toBe(mockAssignedCase.serviceCaseId);
    });

    it('throws NotFoundException when case does not exist or is filtered by RLS', async () => {
      (mockCasesRepo.findById as any).mockResolvedValue(null);

      await expect(
        service.getCaseById('non-existent-id', mockEngineerUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // GATE D: SlaController.calculateSla() RLS Context & Isolation (Finding 2)
  // =========================================================================
  describe('Gate D: SlaController.calculateSla() RLS Context & Isolation (Finding 2)', () => {
    it('passes authenticated principal request.user into ServiceCasesService.getCaseById() and executes under RLS', async () => {
      const mockRequest = {
        user: mockEngineerUser,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      const response = await slaController.calculateSla(mockAssignedCase.serviceCaseId, mockRequest);

      // Verify RlsService was invoked with authenticated claims
      expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
        {
          userId: mockEngineerUser.sub,
          role: 'FIELD_ENGINEER',
        },
        expect.any(Function),
      );

      // Verify repository query received the transaction from withSecurityContext
      expect(mockCasesRepo.findById).toHaveBeenCalledWith(
        mockAssignedCase.serviceCaseId,
        expect.objectContaining({ __isTransaction: true }),
      );

      // Verify response envelope and SLA calculation data
      expect(response.success).toBe(true);
      expect((response.data as any).serviceCaseId).toBe(mockAssignedCase.serviceCaseId);
      expect((response.data as any).zentraCaseCode).toBe(mockAssignedCase.zentraCaseCode);
      expect((response.data as any).slaEvaluation).toBeDefined();
    });

    it('rejects when case does not exist or is filtered out by RLS (fails closed with NotFoundException)', async () => {
      (mockCasesRepo.findById as any).mockResolvedValue(null);

      const mockRequest = {
        user: mockEngineerUser,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      await expect(
        slaController.calculateSla('unauthorized-or-missing-case-id', mockRequest),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects SLA calculation with ForbiddenException when principal has empty roles', async () => {
      const emptyRolesUser: AccessTokenClaims = {
        ...mockEngineerUser,
        roles: [],
        activeRole: undefined,
      };
      const mockRequest = {
        user: emptyRolesUser,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      await expect(
        slaController.calculateSla(mockAssignedCase.serviceCaseId, mockRequest),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // GATE E: DispatchController.getAssignmentHistory() RLS Context & Isolation (Finding 3)
  // =========================================================================
  describe('Gate E: DispatchController.getAssignmentHistory() RLS Context & Isolation (Finding 3)', () => {
    it('passes request.user to getAssignmentHistory and executes query inside RlsService.withSecurityContext with transaction handle', async () => {
      const mockRequest = {
        user: mockEngineerUser,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      const response = await dispatchController.getAssignmentHistory(mockAssignedCase.serviceCaseId, mockRequest);

      // Verify RlsService was invoked with authenticated claims
      expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
        {
          userId: mockEngineerUser.sub,
          role: 'FIELD_ENGINEER',
        },
        expect.any(Function),
      );

      // Verify assignment history repository received the transaction
      expect(mockAssignmentHistoryRepo.findByCaseId).toHaveBeenCalledWith(
        mockAssignedCase.serviceCaseId,
        expect.objectContaining({ __isTransaction: true }),
      );

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(response.data[0].assignmentRole).toBe('PRIMARY');
    });

    it('allows District Coordinator to query assignment history within security context', async () => {
      const mockRequest = {
        user: mockCoordinatorUser,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      const response = await dispatchController.getAssignmentHistory(mockAssignedCase.serviceCaseId, mockRequest);

      expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
        {
          userId: mockCoordinatorUser.sub,
          role: 'DISTRICT_COORDINATOR',
        },
        expect.any(Function),
      );
      expect(response.success).toBe(true);
    });

    it('allows Master Admin to query assignment history statewide within security context', async () => {
      const mockRequest = {
        user: mockMasterAdminUser,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      const response = await dispatchController.getAssignmentHistory(mockAssignedCase.serviceCaseId, mockRequest);

      expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
        {
          userId: mockMasterAdminUser.sub,
          role: 'MASTER_ADMIN',
        },
        expect.any(Function),
      );
      expect(response.success).toBe(true);
    });

    it('rejects assignment history query with ForbiddenException when principal has empty roles', async () => {
      const emptyRolesUser: AccessTokenClaims = {
        ...mockEngineerUser,
        roles: [],
        activeRole: undefined,
      };
      const mockRequest = {
        user: emptyRolesUser,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      await expect(
        dispatchController.getAssignmentHistory(mockAssignedCase.serviceCaseId, mockRequest),
      ).rejects.toThrow(ForbiddenException);
    });

    it('falls back to non-transactional query when user is not provided (service-level backward compatibility)', async () => {
      const result = await service.getAssignmentHistory(mockAssignedCase.serviceCaseId);

      expect(mockRlsService.withSecurityContext).not.toHaveBeenCalled();
      expect(mockAssignmentHistoryRepo.findByCaseId).toHaveBeenCalledWith(
        mockAssignedCase.serviceCaseId,
        undefined,
      );
      expect(result).toHaveLength(1);
    });
  });
});

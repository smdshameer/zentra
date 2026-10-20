/**
 * ZENTRA — Sync Backend RLS Context Remediation Focused Regression Suite
 * apps/api/test/sync-rls-remediation.spec.ts
 *
 * Verifies Stage 6G-B1 architectural remediation:
 * 1. SyncPushService wraps mutation execution in RlsService.withSecurityContext()
 * 2. SyncDeltaService queries execute under RlsService.withSecurityContext()
 * 3. Client cannot elevate privileges by supplying unauthorized activeRole (Anti-escalation)
 * 4. Database queries and territory verification execute on the scoped transaction (trx)
 * 5. Exceptions roll back correctly and security context is safely scoped
 * 6. Concurrent requests maintain strictly isolated security contexts
 * 7. SyncController correctly extracts and forwards authenticated claims
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { SyncPushService, ClientRequestContext } from '../src/modules/sync/services/sync-push.service';
import { SyncDeltaService } from '../src/modules/sync/services/sync-delta.service';
import { SyncController } from '../src/modules/sync/controllers/sync.controller';
import { resolveSecurityRole, RECOGNIZED_ROLES } from '../src/modules/sync/utils/sync-roles';
import type { RlsService, SecurityContext } from '../src/modules/auth/rls.service';
import type { IdempotencyRepository } from '../src/modules/sync/repositories/idempotency.repository';
import type { ConflictArbitratorService } from '../src/modules/sync/services/conflict-arbitrator.service';
import type { ConveyancePolicyService } from '../src/modules/conveyance/services/conveyance-policy.service';
import type {
  SyncPushRequest,
  SyncDeltaRequestQuery,
  AccessTokenClaims,
} from '@zentra/types';

describe('ZENTRA Stage 6G-B1 — Sync RLS Context Remediation Unit & Security Suite', () => {
  // Test principals
  const mockEngineerClaims: AccessTokenClaims = {
    sub: '01a126f6-7d9a-74a4-bb2d-b86181cadb93',
    username: 'engineer.demo@zentra.local',
    roles: ['FIELD_ENGINEER'],
    activeRole: 'FIELD_ENGINEER',
    territoryDistrictIds: ['01a126f6-7d99-722a-8ef0-91a92e3fc7e6'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
  };

  const mockCoordinatorClaims: AccessTokenClaims = {
    sub: '01a126f6-7d9a-74a4-bb2d-b86181cadb94',
    username: 'coordinator.erode@zentra.local',
    roles: ['DISTRICT_COORDINATOR'],
    activeRole: 'DISTRICT_COORDINATOR',
    territoryDistrictIds: ['01a126f6-7d99-722a-8ef0-91a92e3fc7e6'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
  };

  const mockMasterAdminClaims: AccessTokenClaims = {
    sub: '01a126f6-7d9a-74a4-bb2d-b86181cadb95',
    username: 'admin@zentra.local',
    roles: ['MASTER_ADMIN'],
    activeRole: 'MASTER_ADMIN',
    territoryDistrictIds: [],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
  };

  const clientContext: ClientRequestContext = {
    ipAddress: '127.0.0.1',
    userAgent: 'ZentraFieldMobile/1.0.0',
  };

  // Mock services
  let mockRlsService: Partial<RlsService>;
  let mockIdempotencyRepo: Partial<IdempotencyRepository>;
  let mockConflictArbitrator: Partial<ConflictArbitratorService>;
  let mockConveyancePolicyService: Partial<ConveyancePolicyService>;
  let mockTrx: any;

  // Query mock helper to build chainable Kysely query mocks
  function createChainableQueryMock(result: any = []) {
    const query: any = {
      where: vi.fn().mockImplementation(() => query),
      innerJoin: vi.fn().mockImplementation(() => query),
      select: vi.fn().mockImplementation(() => query),
      selectAll: vi.fn().mockImplementation(() => query),
      orderBy: vi.fn().mockImplementation(() => query),
      limit: vi.fn().mockImplementation(() => query),
      forUpdate: vi.fn().mockImplementation(() => query),
      set: vi.fn().mockImplementation(() => query),
      values: vi.fn().mockImplementation(() => query),
      execute: vi.fn().mockResolvedValue(Array.isArray(result) ? result : [result]),
      executeTakeFirst: vi.fn().mockResolvedValue(Array.isArray(result) ? result[0] : result),
    };
    return query;
  }

  beforeEach(() => {
    mockTrx = {
      __isTransaction: true,
      selectFrom: vi.fn().mockImplementation((table: string) => {
        if (table === 'service_cases') {
          return createChainableQueryMock([
            {
              service_case_id: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
              zentra_case_code: 'ZNT-2026-DEMO-000001',
              school_id: '01a126f6-7d99-785e-b2f4-29eff1578ebd',
              lab_id: '01a126f6-7d99-785e-b2f4-29eff1578ebc',
              lab_equipment_id: '01a126f6-7d99-785e-b2f4-29eff1578ebb',
              source_complaint_id: null,
              assigned_primary_engineer_id: mockEngineerClaims.sub,
              assigned_secondary_engineer_id: null,
              operational_status: 'ASSIGNED',
              internal_priority: 'MEDIUM',
              sla_target_at: null,
              actual_diagnosis_summary: null,
              actual_action_taken_summary: null,
              verification_status: 'PENDING_REVIEW',
              created_at: new Date(),
              updated_at: new Date(),
              version: 1,
            },
          ]);
        }
        if (table === 'schools') {
          return createChainableQueryMock([
            {
              district_id: '01a126f6-7d99-722a-8ef0-91a92e3fc7e6',
            },
          ]);
        }
        if (table === 'user_territory_assignments') {
          return createChainableQueryMock([
            { district_id: '01a126f6-7d99-722a-8ef0-91a92e3fc7e6' },
          ]);
        }
        if (table === 'field_visits' || table === 'field_visits as fv') {
          return createChainableQueryMock([
            {
              visit_id: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe502',
              service_case_id: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
              engineer_id: mockEngineerClaims.sub,
              visit_sequence_number: 1,
              visit_date: '2026-10-15',
              status: 'PLANNED',
              check_in_timestamp: null,
              check_in_at_device: null,
              check_in_at_server: null,
              check_in_latitude: null,
              check_in_longitude: null,
              check_in_accuracy_meters: null,
              check_in_distance_meters: null,
              check_in_within_geofence: null,
              equipment_condition_observed: null,
              on_site_diagnosis: null,
              work_performed: null,
              visit_outcome: null,
              pending_reason_text: null,
              target_next_visit_date: null,
              check_out_timestamp: null,
              check_out_at_device: null,
              check_out_at_server: null,
              check_out_latitude: null,
              check_out_longitude: null,
              check_out_accuracy_meters: null,
              notes: null,
              version: 1,
              client_operation_id: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe002',
              created_at: new Date(),
              updated_at: new Date(),
              district_id: '01a126f6-7d99-722a-8ef0-91a92e3fc7e6',
            },
          ]);
        }
        if (table === 'evidence_files') {
          return createChainableQueryMock([]);
        }
        if (table === 'conveyance_claims') {
          return createChainableQueryMock([]);
        }
        if (table === 'tombstones') {
          return createChainableQueryMock([]);
        }
        return createChainableQueryMock([]);
      }),
      updateTable: vi.fn().mockImplementation(() => createChainableQueryMock()),
      insertInto: vi.fn().mockImplementation(() => createChainableQueryMock()),
    };

    mockRlsService = {
      withSecurityContext: vi.fn().mockImplementation(
        async <T>(context: SecurityContext, action: (trx: any) => Promise<T>): Promise<T> => {
          return await action(mockTrx);
        },
      ),
    };

    mockIdempotencyRepo = {
      findKey: vi.fn().mockResolvedValue(null),
      saveKey: vi.fn().mockResolvedValue(undefined),
    };

    mockConflictArbitrator = {
      arbitrateMutation: vi.fn().mockResolvedValue({ isConflict: false }),
    };

    mockConveyancePolicyService = {
      resolveRatePolicy: vi.fn().mockResolvedValue({
        policyId: 'policy-001',
        ratePerKm: 5.0,
        policyVersion: 1,
        isProvisional: false,
      }),
    };
  });

  // =========================================================================
  // GATE 1: Role Resolution & Privilege Escalation Prevention
  // =========================================================================
  describe('Gate 1: resolveSecurityRole Authority & Anti-Privilege Escalation', () => {
    it('recognizes all valid ZENTRA roles', () => {
      expect(RECOGNIZED_ROLES.has('MASTER_ADMIN')).toBe(true);
      expect(RECOGNIZED_ROLES.has('REPORTING_HEAD')).toBe(true);
      expect(RECOGNIZED_ROLES.has('DISTRICT_COORDINATOR')).toBe(true);
      expect(RECOGNIZED_ROLES.has('FIELD_ENGINEER')).toBe(true);
      expect(RECOGNIZED_ROLES.has('AI')).toBe(true);
      expect(RECOGNIZED_ROLES.has('HM')).toBe(true);
    });

    it('resolves activeRole when user possesses the role', () => {
      const role = resolveSecurityRole(
        ['DISTRICT_COORDINATOR', 'FIELD_ENGINEER'],
        'FIELD_ENGINEER',
      );
      expect(role).toBe('FIELD_ENGINEER');
    });

    it('PREVENTS PRIVILEGE ESCALATION: rejects activeRole not held by user', () => {
      expect(() =>
        resolveSecurityRole(['FIELD_ENGINEER'], 'MASTER_ADMIN'),
      ).toThrow(ForbiddenException);

      expect(() =>
        resolveSecurityRole(['FIELD_ENGINEER'], 'DISTRICT_COORDINATOR'),
      ).toThrow(ForbiddenException);
    });

    it('rejects unrecognized activeRole even if passed by client', () => {
      expect(() =>
        resolveSecurityRole(['FIELD_ENGINEER'], 'SUPER_ADMIN_ROOT'),
      ).toThrow(ForbiddenException);
    });

    it('resolves deterministic role precedence when activeRole is omitted', () => {
      const role = resolveSecurityRole(['FIELD_ENGINEER', 'DISTRICT_COORDINATOR']);
      expect(role).toBe('DISTRICT_COORDINATOR');
    });

    it('rejects empty or missing userRoles fail-closed', () => {
      expect(() => resolveSecurityRole([])).toThrow(ForbiddenException);
      expect(() => resolveSecurityRole(null as any)).toThrow(ForbiddenException);
    });

    it('rejects unauthenticated/unrecognized role set fail-closed', () => {
      expect(() => resolveSecurityRole(['UNKNOWN_ROLE', 'GUEST'])).toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // GATE 2: SyncPushService RLS Context Integration
  // =========================================================================
  describe('Gate 2: SyncPushService RLS Execution & Context Scoping', () => {
    let service: SyncPushService;

    beforeEach(() => {
      service = new SyncPushService(
        mockIdempotencyRepo as IdempotencyRepository,
        mockConflictArbitrator as ConflictArbitratorService,
        mockConveyancePolicyService as ConveyancePolicyService,
        mockRlsService as RlsService,
      );
    });

    it('wraps push mutation execution in RlsService.withSecurityContext with authenticated claims', async () => {
      const pushRequest: SyncPushRequest = {
        clientBatchId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe001',
        mutations: [
          {
            clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe002',
            entityType: 'service_cases',
            entityId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
            operationType: 'STATUS_TRANSITION',
            version: 1,
            clientTimestamp: new Date().toISOString(),
            payload: {
              toStatus: 'IN_PROGRESS',
              reason: 'Started diagnostics on site',
            },
          },
        ],
      };

      const result = await service.processPushBatch(
        mockEngineerClaims.sub,
        mockEngineerClaims.roles,
        pushRequest,
        clientContext,
        mockEngineerClaims.activeRole,
      );

      // Verify withSecurityContext was called with the authenticated userId and role
      expect(mockRlsService.withSecurityContext).toHaveBeenCalledTimes(1);
      expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
        {
          userId: mockEngineerClaims.sub,
          role: 'FIELD_ENGINEER',
        },
        expect.any(Function),
      );

      // Verify database operations occurred on mockTrx
      expect(mockTrx.selectFrom).toHaveBeenCalledWith('service_cases');
      expect(mockTrx.selectFrom).toHaveBeenCalledWith('schools');
      expect(mockTrx.updateTable).toHaveBeenCalledWith('service_cases');
      expect(mockTrx.insertInto).toHaveBeenCalledWith('service_case_status_history');
      expect(mockTrx.insertInto).toHaveBeenCalledWith('audit_events');

      // Verify mutation result
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.status).toBe('ACCEPTED');
    });

    it('rejects execution when client requests unauthorized activeRole without opening transaction', async () => {
      const pushRequest: SyncPushRequest = {
        clientBatchId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe001',
        mutations: [
          {
            clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe002',
            entityType: 'service_cases',
            entityId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
            operationType: 'STATUS_TRANSITION',
            version: 1,
            clientTimestamp: new Date().toISOString(),
            payload: { toStatus: 'IN_PROGRESS' },
          },
        ],
      };

      // Engineer requests MASTER_ADMIN activeRole
      await expect(
        service.processPushBatch(
          mockEngineerClaims.sub,
          mockEngineerClaims.roles,
          pushRequest,
          clientContext,
          'MASTER_ADMIN',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(mockRlsService.withSecurityContext).not.toHaveBeenCalled();
    });

    it('returns cached idempotency response without opening RLS transaction for duplicate clientOperationId', async () => {
      const cachedResult = {
        clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe002',
        status: 'ACCEPTED',
        serverVersion: '2',
        serverTimestamp: new Date().toISOString(),
      };

      mockIdempotencyRepo.findKey = vi.fn().mockResolvedValue({
        client_operation_id: cachedResult.clientOperationId,
        user_id: mockEngineerClaims.sub,
        response_body: cachedResult,
      });

      const pushRequest: SyncPushRequest = {
        clientBatchId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe001',
        mutations: [
          {
            clientOperationId: cachedResult.clientOperationId,
            entityType: 'service_cases',
            entityId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
            operationType: 'STATUS_TRANSITION',
            version: 1,
            clientTimestamp: new Date().toISOString(),
            payload: { toStatus: 'IN_PROGRESS' },
          },
        ],
      };

      const response = await service.processPushBatch(
        mockEngineerClaims.sub,
        mockEngineerClaims.roles,
        pushRequest,
        clientContext,
      );

      expect(response.results[0]).toEqual(cachedResult);
      expect(mockRlsService.withSecurityContext).not.toHaveBeenCalled();
    });

    it('propagates transaction failure without caching a false REJECTED idempotency entry on rollback', async () => {
      // Mock withSecurityContext throwing error (e.g. RLS violation or transient DB error)
      mockRlsService.withSecurityContext = vi.fn().mockRejectedValue(
        new Error('PostgreSQL RLS violation: row access denied'),
      );

      const pushRequest: SyncPushRequest = {
        clientBatchId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe001',
        mutations: [
          {
            clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe003',
            entityType: 'service_cases',
            entityId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
            operationType: 'STATUS_TRANSITION',
            version: 1,
            clientTimestamp: new Date().toISOString(),
            payload: { toStatus: 'IN_PROGRESS' },
          },
        ],
      };

      await expect(
        service.processPushBatch(
          mockEngineerClaims.sub,
          mockEngineerClaims.roles,
          pushRequest,
          clientContext,
        ),
      ).rejects.toThrow('PostgreSQL RLS violation: row access denied');

      // Crucial: Must NOT cache a rolled-back transaction into idempotency_keys
      expect(mockIdempotencyRepo.saveKey).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // GATE 3: SyncDeltaService RLS Context Integration
  // =========================================================================
  describe('Gate 3: SyncDeltaService Downstream Query RLS Scoping', () => {
    let service: SyncDeltaService;

    beforeEach(() => {
      service = new SyncDeltaService(mockRlsService as RlsService);
    });

    it('executes delta query within RlsService.withSecurityContext using authenticated context', async () => {
      const query: SyncDeltaRequestQuery = {
        cursor: 'eyJsYXN0U3luY1RpbWVzdGFtcCI6IjIwMjYtMTAtMDFUMDA6MDA6MDAuMDAwWiIsInRvbWJzdG9uZVNlcSI6MH0=',
        limit: 50,
      };

      const result = await service.fetchDelta(
        mockEngineerClaims.sub,
        mockEngineerClaims.roles,
        query,
        mockEngineerClaims.activeRole,
      );

      expect(mockRlsService.withSecurityContext).toHaveBeenCalledTimes(1);
      expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
        {
          userId: mockEngineerClaims.sub,
          role: 'FIELD_ENGINEER',
        },
        expect.any(Function),
      );

      // Verify downstream queries ran on mockTrx
      expect(mockTrx.selectFrom).toHaveBeenCalledWith('user_territory_assignments');
      expect(mockTrx.selectFrom).toHaveBeenCalledWith('service_cases');
      expect(mockTrx.selectFrom).toHaveBeenCalledWith('field_visits');
      expect(mockTrx.selectFrom).toHaveBeenCalledWith('evidence_files');
      expect(mockTrx.selectFrom).toHaveBeenCalledWith('conveyance_claims');
      expect(mockTrx.selectFrom).toHaveBeenCalledWith('tombstones');

      expect(result).toBeDefined();
      expect(result.nextCursor).toBeDefined();
      expect(result.serverTimestamp).toBeDefined();
    });

    it('scopes delta queries to coordinator territory when role is DISTRICT_COORDINATOR', async () => {
      const query: SyncDeltaRequestQuery = {
        cursor: 'eyJsYXN0U3luY1RpbWVzdGFtcCI6IjIwMjYtMTAtMDFUMDA6MDA6MDAuMDAwWiIsInRvbWJzdG9uZVNlcSI6MH0=',
        limit: 50,
      };

      await service.fetchDelta(
        mockCoordinatorClaims.sub,
        mockCoordinatorClaims.roles,
        query,
        mockCoordinatorClaims.activeRole,
      );

      expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
        {
          userId: mockCoordinatorClaims.sub,
          role: 'DISTRICT_COORDINATOR',
        },
        expect.any(Function),
      );

      expect(mockTrx.selectFrom).toHaveBeenCalledWith('user_territory_assignments');
    });

    it('bypasses territory assignment query for MASTER_ADMIN while retaining RLS context', async () => {
      const query: SyncDeltaRequestQuery = {
        cursor: 'eyJsYXN0U3luY1RpbWVzdGFtcCI6IjIwMjYtMTAtMDFUMDA6MDA6MDAuMDAwWiIsInRvbWJzdG9uZVNlcSI6MH0=',
        limit: 50,
      };

      await service.fetchDelta(
        mockMasterAdminClaims.sub,
        mockMasterAdminClaims.roles,
        query,
        mockMasterAdminClaims.activeRole,
      );

      expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
        {
          userId: mockMasterAdminClaims.sub,
          role: 'MASTER_ADMIN',
        },
        expect.any(Function),
      );

      // MASTER_ADMIN should not query user_territory_assignments
      expect(mockTrx.selectFrom).not.toHaveBeenCalledWith('user_territory_assignments');
    });
  });

  // =========================================================================
  // GATE 4: SyncController Integration & Request Claims Forwarding
  // =========================================================================
  describe('Gate 4: SyncController Claims Forwarding & Contract Compliance', () => {
    let controller: SyncController;
    let pushServiceMock: Partial<SyncPushService>;
    let deltaServiceMock: Partial<SyncDeltaService>;

    beforeEach(() => {
      pushServiceMock = {
        processPushBatch: vi.fn().mockResolvedValue({
          batchId: 'batch-001',
          results: [],
          serverTimestamp: new Date().toISOString(),
        }),
      };

      deltaServiceMock = {
        fetchDelta: vi.fn().mockResolvedValue({
          changes: [],
          tombstones: [],
          nextCursor: 'opaque-cursor',
          hasMore: false,
          serverTimestamp: new Date().toISOString(),
        }),
      };

      controller = new SyncController(
        pushServiceMock as SyncPushService,
        deltaServiceMock as SyncDeltaService,
      );
    });

    it('extracts and forwards sub, roles, and activeRole on pushMutations()', async () => {
      const mockRequest: any = {
        user: mockEngineerClaims,
        ip: '192.168.1.100',
        headers: {
          'user-agent': 'OnePlus Nord AC2001 Android 12',
        },
      };

      const pushPayload = {
        clientBatchId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe001',
        mutations: [
          {
            clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe002',
            entityType: 'service_cases',
            entityId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
            operationType: 'STATUS_TRANSITION',
            version: 1,
            clientCreatedAt: new Date().toISOString(),
            payload: { toStatus: 'IN_PROGRESS' },
          },
        ],
      };

      const response = await controller.pushMutations(pushPayload, mockRequest);

      expect(pushServiceMock.processPushBatch).toHaveBeenCalledTimes(1);
      expect(pushServiceMock.processPushBatch).toHaveBeenCalledWith(
        mockEngineerClaims.sub,
        mockEngineerClaims.roles,
        expect.objectContaining({ clientBatchId: pushPayload.clientBatchId }),
        expect.objectContaining({ ipAddress: '192.168.1.100' }),
        mockEngineerClaims.activeRole,
      );

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
    });

    it('extracts and forwards sub, roles, and activeRole on getDelta()', async () => {
      const mockRequest: any = {
        user: mockCoordinatorClaims,
        ip: '192.168.1.101',
        headers: { 'user-agent': 'ZentraWeb/1.0.0' },
      };

      const queryPayload = {
        cursor: 'eyJsYXN0U3luY1RpbWVzdGFtcCI6IjIwMjYtMTAtMDFUMDA6MDA6MDAuMDAwWiIsInRvbWJzdG9uZVNlcSI6MH0=',
        limit: 25,
      };

      const response = await controller.getDelta(queryPayload, mockRequest);

      expect(deltaServiceMock.fetchDelta).toHaveBeenCalledTimes(1);
      expect(deltaServiceMock.fetchDelta).toHaveBeenCalledWith(
        mockCoordinatorClaims.sub,
        mockCoordinatorClaims.roles,
        expect.objectContaining({ limit: 25 }),
        mockCoordinatorClaims.activeRole,
      );

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
    });
  });

  // =========================================================================
  // GATE 5: Concurrency & Isolation (Zero Pool Context Leakage)
  // =========================================================================
  describe('Gate 5: Concurrent Execution Isolation & Pool Leakage Prevention', () => {
    it('executes concurrent requests with isolated, non-overlapping security contexts', async () => {
      const recordedContexts: SecurityContext[] = [];

      mockRlsService.withSecurityContext = vi.fn().mockImplementation(
        async <T>(context: SecurityContext, action: (trx: any) => Promise<T>): Promise<T> => {
          recordedContexts.push(context);
          // Simulate async delay
          await new Promise((r) => setTimeout(r, 10));
          return await action(mockTrx);
        },
      );

      const pushService = new SyncPushService(
        mockIdempotencyRepo as IdempotencyRepository,
        mockConflictArbitrator as ConflictArbitratorService,
        mockConveyancePolicyService as ConveyancePolicyService,
        mockRlsService as RlsService,
      );

      const deltaService = new SyncDeltaService(mockRlsService as RlsService);

      const request1 = pushService.processPushBatch(
        mockEngineerClaims.sub,
        mockEngineerClaims.roles,
        {
          clientBatchId: 'batch-eng',
          mutations: [
            {
              clientOperationId: 'op-eng-1',
              entityType: 'service_cases',
              entityId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
              operationType: 'STATUS_TRANSITION',
              version: 1,
              clientTimestamp: new Date().toISOString(),
              payload: { toStatus: 'IN_PROGRESS' },
            },
          ],
        },
        clientContext,
        mockEngineerClaims.activeRole,
      );

      const request2 = deltaService.fetchDelta(
        mockCoordinatorClaims.sub,
        mockCoordinatorClaims.roles,
        {
          cursor: 'eyJsYXN0U3luY1RpbWVzdGFtcCI6IjIwMjYtMTAtMDFUMDA6MDA6MDAuMDAwWiIsInRvbWJzdG9uZVNlcSI6MH0=',
        },
        mockCoordinatorClaims.activeRole,
      );

      const [res1, res2] = await Promise.all([request1, request2]);

      expect(res1).toBeDefined();
      expect(res2).toBeDefined();

      expect(recordedContexts).toHaveLength(2);
      expect(recordedContexts).toContainEqual({
        userId: mockEngineerClaims.sub,
        role: 'FIELD_ENGINEER',
      });
      expect(recordedContexts).toContainEqual({
        userId: mockCoordinatorClaims.sub,
        role: 'DISTRICT_COORDINATOR',
      });
    });
  });
});

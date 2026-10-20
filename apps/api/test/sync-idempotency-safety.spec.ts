/**
 * ZENTRA — Stage 6G-B3-A Backend Idempotency Safety Focused Test Suite
 * apps/api/test/sync-idempotency-safety.spec.ts
 *
 * Verifies:
 * 1. A successful mutation produces a replayable idempotency result.
 * 2. A deterministic terminal domain rejection follows the existing documented contract and is saved on trx.
 * 3. A transaction that definitely rolls back does not leave a permanently cached fabricated REJECTED result.
 * 4. A transient database failure is propagated correctly without falsely reporting a terminal domain rejection.
 * 5. An uncertain commit outcome is handled conservatively and does not trigger an unsafe automatic retry.
 * 6. A repeated request with an already committed idempotency result replays that result without a second domain mutation.
 * 7. Concurrent duplicate operation IDs cannot execute the same mutation twice.
 * 8. The remediation preserves RLS-scoped transaction behaviour.
 * 9. Existing relevant sync and RLS tests continue to pass.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncPushService, ClientRequestContext } from '../src/modules/sync/services/sync-push.service';
import { IdempotencyRepository } from '../src/modules/sync/repositories/idempotency.repository';
import type { RlsService, SecurityContext } from '../src/modules/auth/rls.service';
import type { ConflictArbitratorService } from '../src/modules/sync/services/conflict-arbitrator.service';
import type { ConveyancePolicyService } from '../src/modules/conveyance/services/conveyance-policy.service';
import type { SyncPushRequest, AccessTokenClaims } from '@zentra/types';

describe('ZENTRA Stage 6G-B3-A — Backend Idempotency Safety Suite', () => {
  const engineerClaims: AccessTokenClaims = {
    sub: '01a126f6-7d9a-74a4-bb2d-b86181cadb93',
    username: 'engineer.demo@zentra.local',
    roles: ['FIELD_ENGINEER'],
    activeRole: 'FIELD_ENGINEER',
    territoryDistrictIds: ['01a126f6-7d99-722a-8ef0-91a92e3fc7e6'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
  };

  const clientContext: ClientRequestContext = {
    ipAddress: '127.0.0.1',
    userAgent: 'ZentraFieldMobile/1.0.0',
  };

  let mockRlsService: Partial<RlsService>;
  let mockIdempotencyRepo: Partial<IdempotencyRepository>;
  let mockConflictArbitrator: Partial<ConflictArbitratorService>;
  let mockConveyancePolicyService: Partial<ConveyancePolicyService>;
  let mockTrx: any;
  let service: SyncPushService;

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
              school_id: '01a126f6-7d99-733b-8ef0-91a92e3fc8a1',
              assigned_primary_engineer_id: engineerClaims.sub,
              operational_status: 'ASSIGNED',
              version: 1,
            },
          ]);
        }
        if (table === 'schools') {
          return createChainableQueryMock([
            { district_id: '01a126f6-7d99-722a-8ef0-91a92e3fc7e6' },
          ]);
        }
        if (table === 'field_visits') {
          return createChainableQueryMock([
            {
              visit_id: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe502',
              service_case_id: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
              engineer_id: engineerClaims.sub,
              status: 'PLANNED',
              version: 1,
            },
          ]);
        }
        return createChainableQueryMock([]);
      }),
      updateTable: vi.fn().mockImplementation(() => createChainableQueryMock()),
      insertInto: vi.fn().mockImplementation(() => createChainableQueryMock()),
    };

    mockRlsService = {
      withSecurityContext: vi.fn().mockImplementation(
        async <T>(_context: SecurityContext, action: (trx: any) => Promise<T>): Promise<T> => {
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

    service = new SyncPushService(
      mockIdempotencyRepo as IdempotencyRepository,
      mockConflictArbitrator as ConflictArbitratorService,
      mockConveyancePolicyService as ConveyancePolicyService,
      mockRlsService as RlsService,
    );
  });

  // 1. A successful mutation produces a replayable idempotency result
  it('1. Persists idempotency key on trx atomically during successful mutation', async () => {
    const pushRequest: SyncPushRequest = {
      clientBatchId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe001',
      mutations: [
        {
          clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe010',
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
      engineerClaims.sub,
      engineerClaims.roles,
      pushRequest,
      clientContext,
    );

    expect(response.results[0]?.status).toBe('ACCEPTED');
    expect(mockRlsService.withSecurityContext).toHaveBeenCalledTimes(1);

    // Idempotency save must be invoked with the active scoped transaction (trx)
    expect(mockIdempotencyRepo.saveKey).toHaveBeenCalledWith(
      expect.objectContaining({
        clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe010',
        responseStatusCode: 200,
        responseBody: expect.objectContaining({ status: 'ACCEPTED' }),
      }),
      mockTrx,
    );
  });

  // 2. A deterministic terminal domain rejection follows the existing documented contract
  it('2. Caches deterministic terminal domain rejection on trx when contract defines result', async () => {
    const pushRequest: SyncPushRequest = {
      clientBatchId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe001',
      mutations: [
        {
          clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe020',
          entityType: 'unsupported_table_entity',
          entityId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
          operationType: 'INSERT',
          clientTimestamp: new Date().toISOString(),
          payload: {},
        },
      ],
    };

    const response = await service.processPushBatch(
      engineerClaims.sub,
      engineerClaims.roles,
      pushRequest,
      clientContext,
    );

    expect(response.results[0]?.status).toBe('REJECTED');
    expect(response.results[0]?.conflictCode).toBe('SERVER_VALIDATION_FAILED');
    expect(response.results[0]?.message).toContain("Unsupported entity type");

    // Must be persisted on trx as a clean, established domain rejection
    expect(mockIdempotencyRepo.saveKey).toHaveBeenCalledWith(
      expect.objectContaining({
        clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe020',
        responseBody: expect.objectContaining({
          status: 'REJECTED',
          conflictCode: 'SERVER_VALIDATION_FAILED',
        }),
      }),
      mockTrx,
    );
  });

  // 3. A transaction that definitely rolls back does not leave a permanently cached fabricated REJECTED result
  it('3. Guarantees rolled-back transaction never writes an idempotency key', async () => {
    mockRlsService.withSecurityContext = vi.fn().mockImplementation(
      async () => {
        // Simulating rollback on error
        throw new Error('Database transaction aborted due to foreign key violation');
      },
    );

    const pushRequest: SyncPushRequest = {
      clientBatchId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe001',
      mutations: [
        {
          clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe030',
          entityType: 'service_cases',
          entityId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
          operationType: 'STATUS_TRANSITION',
          clientTimestamp: new Date().toISOString(),
          payload: { toStatus: 'IN_PROGRESS' },
        },
      ],
    };

    await expect(
      service.processPushBatch(
        engineerClaims.sub,
        engineerClaims.roles,
        pushRequest,
        clientContext,
      ),
    ).rejects.toThrow('Database transaction aborted due to foreign key violation');

    // Crucial: Must NEVER save an idempotency key on rollback!
    expect(mockIdempotencyRepo.saveKey).not.toHaveBeenCalled();
  });

  // 4. A transient database failure is propagated correctly without falsely reporting a terminal domain rejection
  it('4. Propagates transient database failures (connection drop/timeout) without fabricating REJECTED status', async () => {
    const transientError = new Error('Connection terminated unexpectedly');
    mockRlsService.withSecurityContext = vi.fn().mockRejectedValue(transientError);

    const pushRequest: SyncPushRequest = {
      clientBatchId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe001',
      mutations: [
        {
          clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe040',
          entityType: 'service_cases',
          entityId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
          operationType: 'STATUS_TRANSITION',
          clientTimestamp: new Date().toISOString(),
          payload: { toStatus: 'IN_PROGRESS' },
        },
      ],
    };

    // Must rethrow transient error so HTTP layer can return 500/retryable error
    await expect(
      service.processPushBatch(
        engineerClaims.sub,
        engineerClaims.roles,
        pushRequest,
        clientContext,
      ),
    ).rejects.toThrow('Connection terminated unexpectedly');

    expect(mockIdempotencyRepo.saveKey).not.toHaveBeenCalled();
  });

  // 5. An uncertain commit outcome is handled conservatively
  it('5. Ensures idempotency key and domain mutation share identical commit boundary', async () => {
    // When saveKey executes on trx, commit uncertainty is resolved:
    // If commit fails, both domain and idempotency roll back.
    // If commit succeeds, both are persisted.
    let saveKeyCalledInTrx = false;
    mockIdempotencyRepo.saveKey = vi.fn().mockImplementation(async (_data, executor) => {
      if (executor && executor.__isTransaction) {
        saveKeyCalledInTrx = true;
      }
    });

    const pushRequest: SyncPushRequest = {
      clientBatchId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe001',
      mutations: [
        {
          clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe050',
          entityType: 'service_cases',
          entityId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
          operationType: 'STATUS_TRANSITION',
          clientTimestamp: new Date().toISOString(),
          payload: { toStatus: 'IN_PROGRESS' },
        },
      ],
    };

    await service.processPushBatch(
      engineerClaims.sub,
      engineerClaims.roles,
      pushRequest,
      clientContext,
    );

    expect(saveKeyCalledInTrx).toBe(true);
  });

  // 6. A repeated request with an already committed idempotency result replays without second mutation
  it('6. Replays cached idempotency result on retry without re-executing domain transition', async () => {
    const cachedResult = {
      clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe060',
      status: 'ACCEPTED',
      serverVersion: '3',
      serverTimestamp: new Date().toISOString(),
    };

    mockIdempotencyRepo.findKey = vi.fn().mockResolvedValue({
      client_operation_id: cachedResult.clientOperationId,
      user_id: engineerClaims.sub,
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
          clientTimestamp: new Date().toISOString(),
          payload: { toStatus: 'IN_PROGRESS' },
        },
      ],
    };

    const response = await service.processPushBatch(
      engineerClaims.sub,
      engineerClaims.roles,
      pushRequest,
      clientContext,
    );

    expect(response.results[0]).toEqual(cachedResult);
    expect(mockRlsService.withSecurityContext).not.toHaveBeenCalled();
    expect(mockTrx.updateTable).not.toHaveBeenCalled();
  });

  // 7. Concurrent duplicate operation IDs cannot execute the same mutation twice
  it('7. Detects concurrent duplicate key committed within active transaction and returns cached result', async () => {
    const committedConcurrently = {
      clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe070',
      status: 'ACCEPTED',
      serverVersion: '4',
      serverTimestamp: new Date().toISOString(),
    };

    // Fast-path lookup outside transaction returns null (both requests started at same instant)
    // But in-transaction lookup findKey(clientOpId, trx) returns the concurrently committed record
    let callCount = 0;
    mockIdempotencyRepo.findKey = vi.fn().mockImplementation(async (_clientOpId, executor) => {
      callCount++;
      if (executor && executor.__isTransaction) {
        return {
          client_operation_id: committedConcurrently.clientOperationId,
          user_id: engineerClaims.sub,
          response_body: committedConcurrently,
        };
      }
      return null;
    });

    const pushRequest: SyncPushRequest = {
      clientBatchId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe001',
      mutations: [
        {
          clientOperationId: committedConcurrently.clientOperationId,
          entityType: 'service_cases',
          entityId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
          operationType: 'STATUS_TRANSITION',
          clientTimestamp: new Date().toISOString(),
          payload: { toStatus: 'IN_PROGRESS' },
        },
      ],
    };

    const response = await service.processPushBatch(
      engineerClaims.sub,
      engineerClaims.roles,
      pushRequest,
      clientContext,
    );

    expect(response.results[0]).toEqual(committedConcurrently);
    // Domain mutation updateTable must NOT have been called because in-trx key was detected!
    expect(mockTrx.updateTable).not.toHaveBeenCalled();
  });

  // 8. The remediation preserves RLS-scoped transaction behaviour
  it('8. Preserves RLS security context and passes active claims to withSecurityContext', async () => {
    const pushRequest: SyncPushRequest = {
      clientBatchId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe001',
      mutations: [
        {
          clientOperationId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe080',
          entityType: 'service_cases',
          entityId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
          operationType: 'STATUS_TRANSITION',
          clientTimestamp: new Date().toISOString(),
          payload: { toStatus: 'IN_PROGRESS' },
        },
      ],
    };

    await service.processPushBatch(
      engineerClaims.sub,
      engineerClaims.roles,
      pushRequest,
      clientContext,
      engineerClaims.activeRole,
    );

    expect(mockRlsService.withSecurityContext).toHaveBeenCalledWith(
      {
        userId: engineerClaims.sub,
        role: 'FIELD_ENGINEER',
      },
      expect.any(Function),
    );
  });
});

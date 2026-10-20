/**
 * ZENTRA Field — Stage 6G-B3-C1-S Final Network Error & Retry Safety Audit Test Suite
 * apps/field/test/stage-6g-network-error-safety.spec.ts
 *
 * Verifies the 14 mandatory network error classification and retry safety scenarios:
 *
 * 1. Explicit server rejection follows verified rejection policy.
 * 2. Generic "Network request failed" is not blindly requeued.
 * 3. Connection reset after dispatch begins results in an uncertain state.
 * 4. Timeout and AbortError result in an uncertain state.
 * 5. HTTP 5xx after possible mutation application does not cause automatic replay.
 * 6. Malformed or incomplete response after dispatch is handled conservatively.
 * 7. A proven pre-dispatch failure is retried only when transport provides sufficient evidence.
 * 8. lastAttemptAt attempt marker is durably persisted before dispatch.
 * 9. Reinitialization does not silently reset ambiguous operations to QUEUED.
 * 10. Repeated sync cycles do not automatically replay ambiguous operations.
 * 11. Original clientOperationId, entity IDs, and payload remain 100% unchanged.
 * 12. No uncertain operation is falsely acknowledged.
 * 13. Existing safe handling for clearly rejected mutations remains intact.
 * 14. Existing queue and sync tests continue to pass.
 */

import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createAppDatabase } from '../src/database/database';
import { OperationQueue } from '../src/domain/queue/operation-queue';
import { ServiceCaseRepository } from '../src/domain/repositories/service-case.repository';
import { SyncMetadataRepository } from '../src/sync/sync-metadata.repository';
import { DeltaApplier } from '../src/sync/delta-applier';
import { SyncEngine } from '../src/sync/sync-engine';
import { ApiClientError } from '../src/api/types';
import type { SyncApiService } from '../src/sync/sync-api.service';
import type { Database } from '@nozbe/watermelondb';

describe('Stage 6G-B3-C1-S — Final Network Error & Retry Safety Audit Suite', () => {
  let db: Database;
  let queue: OperationQueue;
  let caseRepo: ServiceCaseRepository;
  let mockApiService: SyncApiService;
  let syncEngine: SyncEngine;

  const testTmpDir = path.join(os.tmpdir(), 'zentra_stage6g_error_safety_' + process.pid);
  if (!fs.existsSync(testTmpDir)) {
    fs.mkdirSync(testTmpDir, { recursive: true });
  }

  afterAll(() => {
    try {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  const testServerCaseId = '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540';
  const testEngineerId = '01a126f6-7d9a-7dfa-96bb-000000000001';

  beforeEach(async () => {
    db = createAppDatabase({ inMemory: true, dbName: 'test_error_safety_' + Date.now() });
    queue = new OperationQueue(db);
    caseRepo = new ServiceCaseRepository(db);

    mockApiService = {
      pushMutations: vi.fn(),
      pullDelta: vi.fn().mockResolvedValue({
        changes: [],
        tombstones: [],
        nextCursor: null,
        hasMore: false,
        serverTimestamp: new Date().toISOString(),
      }),
    } as unknown as SyncApiService;

    syncEngine = new SyncEngine(
      db,
      mockApiService,
      queue,
      new SyncMetadataRepository(db),
      new DeltaApplier(db),
    );
  });

  // =========================================================================
  // SCENARIO 1: Explicit server rejection follows verified rejection policy
  // =========================================================================
  it('Scenario 1: Explicit server rejection follows the verified rejection policy', async () => {
    const op = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-000000000001',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-01',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'CLOSED' },
    });

    (mockApiService.pushMutations as any).mockResolvedValueOnce({
      batchId: 'batch-rej-01',
      serverTimestamp: new Date().toISOString(),
      results: [
        {
          clientOperationId: op.clientOperationId,
          status: 'REJECTED',
          message: 'Transition from ASSIGNED to CLOSED is forbidden without field visit',
          serverTimestamp: new Date().toISOString(),
        },
      ],
    });

    const summary = await syncEngine.sync();
    expect(summary.isSuccess).toBe(true);
    expect(summary.failedCount).toBe(1);
    expect(summary.acknowledgedCount).toBe(0);

    const raw = await db.get('local_operations').find(op.id);
    expect((raw as any).status).toBe('FAILED');
    expect((raw as any).errorMessage).toContain('Transition from ASSIGNED to CLOSED is forbidden');
    expect((raw as any).retryCount).toBe(1);
  });

  // =========================================================================
  // SCENARIO 2: Generic "Network request failed" is not blindly requeued
  // =========================================================================
  it('Scenario 2: Generic "Network request failed" is not blindly requeued and transitions to CONFLICT', async () => {
    const op = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-000000000002',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-02',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });

    // Standard React Native fetch network exception
    (mockApiService.pushMutations as any).mockRejectedValueOnce(
      new Error('TypeError: Network request failed'),
    );

    const summary = await syncEngine.sync();
    expect(summary.isSuccess).toBe(false);
    expect(summary.conflictCount).toBe(1);

    const raw = await db.get('local_operations').find(op.id);
    expect((raw as any).status).toBe('CONFLICT');
    expect((raw as any).conflictCode).toBe('UNCERTAIN_OUTCOME');
    expect((raw as any).errorMessage).toContain('server outcome uncertain');

    // Crucial: Must NOT be present in pending operations
    const pending = await queue.getPendingOperations();
    expect(pending.length).toBe(0);
  });

  // =========================================================================
  // SCENARIO 3: Connection reset after dispatch begins results in uncertain state
  // =========================================================================
  it('Scenario 3: Connection reset after dispatch begins results in an uncertain CONFLICT state', async () => {
    const op = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-000000000003',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-03',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });

    // Node / socket connection reset error
    (mockApiService.pushMutations as any).mockRejectedValueOnce(
      new Error('read ECONNRESET: socket hang up by peer'),
    );

    const summary = await syncEngine.sync();
    expect(summary.isSuccess).toBe(false);

    const raw = await db.get('local_operations').find(op.id);
    expect((raw as any).status).toBe('CONFLICT');
    expect((raw as any).conflictCode).toBe('UNCERTAIN_OUTCOME');
    expect((raw as any).errorMessage).toContain('Connection reset during push: server outcome uncertain');

    const pending = await queue.getPendingOperations();
    expect(pending.length).toBe(0);
  });

  // =========================================================================
  // SCENARIO 4: Timeout and AbortError result in an uncertain state
  // =========================================================================
  it('Scenario 4: Timeout and AbortError result in an uncertain CONFLICT state', async () => {
    const op = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-000000000004',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-04',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });

    // AbortController timeout error from ApiClient
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    (mockApiService.pushMutations as any).mockRejectedValueOnce(abortErr);

    const summary = await syncEngine.sync();
    expect(summary.isSuccess).toBe(false);

    const raw = await db.get('local_operations').find(op.id);
    expect((raw as any).status).toBe('CONFLICT');
    expect((raw as any).conflictCode).toBe('UNCERTAIN_OUTCOME');
    expect((raw as any).errorMessage).toContain('Network timeout during push: server outcome uncertain');

    const pending = await queue.getPendingOperations();
    expect(pending.length).toBe(0);
  });

  // =========================================================================
  // SCENARIO 5: HTTP 5xx after possible mutation application does not cause replay
  // =========================================================================
  it('Scenario 5: HTTP 5xx (500/502/503/504) does not cause automatic replay', async () => {
    const op = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-000000000005',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-05',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });

    // HTTP 500 / 502 / 503 error from ApiClient
    const serverErr = new ApiClientError(
      'HTTP 502 Bad Gateway: worker terminated after receiving request',
      'SERVER_ERROR',
      502,
    );
    (mockApiService.pushMutations as any).mockRejectedValueOnce(serverErr);

    const summary = await syncEngine.sync();
    expect(summary.isSuccess).toBe(false);

    const raw = await db.get('local_operations').find(op.id);
    expect((raw as any).status).toBe('CONFLICT');
    expect((raw as any).conflictCode).toBe('UNCERTAIN_OUTCOME');
    expect((raw as any).errorMessage).toContain('Server error (502) during push: server outcome uncertain');

    // Must not be pending
    const pending = await queue.getPendingOperations();
    expect(pending.length).toBe(0);
  });

  // =========================================================================
  // SCENARIO 6: Malformed or incomplete response is handled conservatively
  // =========================================================================
  it('Scenario 6: Malformed response or omitted mutation in response is handled fail-closed', async () => {
    const opA = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-00000000006A',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-06a',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });
    const opB = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-00000000006B',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-06b',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });

    // Server returns response with results for opA, but completely OMITS opB
    (mockApiService.pushMutations as any).mockResolvedValueOnce({
      batchId: 'batch-partial-06',
      serverTimestamp: new Date().toISOString(),
      results: [
        {
          clientOperationId: opA.clientOperationId,
          status: 'ACCEPTED',
          serverVersion: '2',
          serverTimestamp: new Date().toISOString(),
        },
      ],
    });

    const summary = await syncEngine.sync();
    expect(summary.isSuccess).toBe(true);
    expect(summary.acknowledgedCount).toBe(1);
    expect(summary.conflictCount).toBe(1);

    // opA is acknowledged
    const rawA = await db.get('local_operations').find(opA.id);
    expect((rawA as any).status).toBe('ACKNOWLEDGED');

    // opB was omitted, so it must fail-closed into CONFLICT with UNCERTAIN_OUTCOME
    const rawB = await db.get('local_operations').find(opB.id);
    expect((rawB as any).status).toBe('CONFLICT');
    expect((rawB as any).conflictCode).toBe('UNCERTAIN_OUTCOME');
    expect((rawB as any).errorMessage).toContain('Omitted from server push response batch');
  });

  // =========================================================================
  // SCENARIO 7: Proven pre-dispatch failure is retried only with sufficient evidence
  // =========================================================================
  it('Scenario 7: Proven pre-dispatch failure is retried only when transport provides sufficient evidence', async () => {
    const op = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-000000000007',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-07',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });

    // Transport error with explicit proof that dispatch was never initiated
    const preDispatchErr = Object.assign(
      new Error('Pre-dispatch check failed: offline guard prevented network invocation'),
      { isPreDispatch: true },
    );
    (mockApiService.pushMutations as any).mockRejectedValueOnce(preDispatchErr);

    const summary = await syncEngine.sync();
    expect(summary.isSuccess).toBe(false);
    expect(summary.conflictCount).toBe(0); // Not a conflict!

    // Safely kept in QUEUED for next attempt
    const raw = await db.get('local_operations').find(op.id);
    expect((raw as any).status).toBe('QUEUED');
    expect((raw as any).retryCount).toBe(1);
    expect((raw as any).errorMessage).toContain('Pre-dispatch failure');

    const pending = await queue.getPendingOperations();
    expect(pending.length).toBe(1);
  });

  // =========================================================================
  // SCENARIO 8: lastAttemptAt attempt marker is durably persisted before dispatch
  // =========================================================================
  it('Scenario 8: lastAttemptAt attempt marker is durably persisted in SQLite before dispatch', async () => {
    const op = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-000000000008',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-08',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });

    // Hook into mockApiService to inspect DB state mid-dispatch
    let dbStatusDuringPush: string | null = null;
    let dbLastAttemptAtDuringPush: any = null;

    (mockApiService.pushMutations as any).mockImplementationOnce(async () => {
      const liveRecord = await db.get('local_operations').find(op.id);
      dbStatusDuringPush = (liveRecord as any).status;
      dbLastAttemptAtDuringPush = (liveRecord as any).lastAttemptAt;

      return {
        batchId: 'batch-08',
        serverTimestamp: new Date().toISOString(),
        results: [
          {
            clientOperationId: op.clientOperationId,
            status: 'ACCEPTED',
            serverVersion: '3',
            serverTimestamp: new Date().toISOString(),
          },
        ],
      };
    });

    await syncEngine.sync();

    // Verify that BEFORE dispatch resolved, the record was already committed as IN_FLIGHT with lastAttemptAt set
    expect(dbStatusDuringPush).toBe('IN_FLIGHT');
    expect(dbLastAttemptAtDuringPush).not.toBeNull();
    expect(dbLastAttemptAtDuringPush instanceof Date).toBe(true);
  });

  // =========================================================================
  // SCENARIO 9: Reinitialization does not silently reset ambiguous operations to QUEUED
  // =========================================================================
  it('Scenario 9: Reinitialization does not silently reset ambiguous operations to QUEUED', async () => {
    const op = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-000000000009',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-09',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });

    // Fail sync with ambiguous network failure
    (mockApiService.pushMutations as any).mockRejectedValueOnce(
      new Error('fetch failed: connection terminated prematurely'),
    );
    await syncEngine.sync();

    const raw = await db.get('local_operations').find(op.id);
    expect((raw as any).status).toBe('CONFLICT');

    // Simulate multiple app restarts and engine initializations
    await syncEngine.initialize();
    await syncEngine.initialize();

    const rawAfterInits = await db.get('local_operations').find(op.id);
    expect((rawAfterInits as any).status).toBe('CONFLICT');
    expect((rawAfterInits as any).conflictCode).toBe('UNCERTAIN_OUTCOME');
  });

  // =========================================================================
  // SCENARIO 10: Repeated sync cycles do not automatically replay ambiguous operations
  // =========================================================================
  it('Scenario 10: Repeated sync cycles do not automatically replay ambiguous operations', async () => {
    const op = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-000000000010',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-10',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });

    (mockApiService.pushMutations as any).mockRejectedValueOnce(
      new Error('TypeError: Network request failed'),
    );
    await syncEngine.sync();

    vi.clearAllMocks();

    // Trigger subsequent sync cycles — must NOT call pushMutations
    const cycle1 = await syncEngine.sync();
    expect(cycle1.pushedCount).toBe(0);
    expect(mockApiService.pushMutations).not.toHaveBeenCalled();

    const cycle2 = await syncEngine.sync();
    expect(cycle2.pushedCount).toBe(0);
    expect(mockApiService.pushMutations).not.toHaveBeenCalled();

    const raw = await db.get('local_operations').find(op.id);
    expect((raw as any).status).toBe('CONFLICT');
  });

  // =========================================================================
  // SCENARIO 11: Original clientOperationId, entity IDs, and payload remain unchanged
  // =========================================================================
  it('Scenario 11: Original clientOperationId, entity IDs, and payload remain 100% unchanged', async () => {
    const originalOpId = '01a15000-0000-7000-8000-000000000011';
    const originalServerEntityId = '01a15000-0000-7000-8000-999999999999';
    const originalPayload = {
      notes: 'Testing byte preservation',
      subObject: { active: true, code: 12345 },
      targetNextVisitDate: '2026-10-25',
    };

    const op = await queue.enqueueStandalone({
      clientOperationId: originalOpId,
      entityType: 'field_visits',
      localEntityId: 'loc-vis-11',
      serverEntityId: originalServerEntityId,
      operationType: 'UPDATE',
      payload: originalPayload,
    });

    (mockApiService.pushMutations as any).mockRejectedValueOnce(
      new Error('Network request failed'),
    );
    await syncEngine.sync();

    const raw = await db.get('local_operations').find(op.id);
    expect((raw as any).clientOperationId).toBe(originalOpId);
    expect((raw as any).serverEntityId).toBe(originalServerEntityId);
    expect((raw as any).localEntityId).toBe('loc-vis-11');
    expect(JSON.parse((raw as any).payloadJson)).toEqual(originalPayload);
  });

  // =========================================================================
  // SCENARIO 12: No uncertain operation is falsely acknowledged
  // =========================================================================
  it('Scenario 12: No uncertain operation is falsely acknowledged', async () => {
    const op = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-000000000012',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-12',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });

    (mockApiService.pushMutations as any).mockRejectedValueOnce(
      new Error('HTTP 500 Internal Server Error'),
    );

    const summary = await syncEngine.sync();
    expect(summary.acknowledgedCount).toBe(0);

    const raw = await db.get('local_operations').find(op.id);
    expect((raw as any).status).not.toBe('ACKNOWLEDGED');
    expect((raw as any).status).toBe('CONFLICT');
  });

  // =========================================================================
  // SCENARIO 13: Existing safe handling for clearly rejected mutations remains intact
  // =========================================================================
  it('Scenario 13: Existing safe handling for clearly rejected mutations remains intact', async () => {
    const op = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-000000000013',
      entityType: 'evidence_files',
      localEntityId: 'loc-ev-13',
      serverEntityId: '01a15000-0000-7000-8000-000000000013',
      operationType: 'INSERT',
      payload: { evidenceSlot: 'SLOT_1_SIGNED_VISIT_REPORT' },
    });

    (mockApiService.pushMutations as any).mockResolvedValueOnce({
      batchId: 'batch-rej-13',
      serverTimestamp: new Date().toISOString(),
      results: [
        {
          clientOperationId: op.clientOperationId,
          status: 'REJECTED',
          message: 'Evidence slot already occupied and locked by admin',
          serverTimestamp: new Date().toISOString(),
        },
      ],
    });

    const summary = await syncEngine.sync();
    expect(summary.isSuccess).toBe(true);
    expect(summary.failedCount).toBe(1);
    expect(summary.conflictCount).toBe(0);

    const raw = await db.get('local_operations').find(op.id);
    expect((raw as any).status).toBe('FAILED');
    expect((raw as any).errorMessage).toContain('Evidence slot already occupied');
  });

  // =========================================================================
  // SCENARIO 14: Existing queue and sync tests continue to pass
  // =========================================================================
  it('Scenario 14: Standard successful push mutation transitions operation to ACKNOWLEDGED', async () => {
    // Seed service case in local db first
    await caseRepo.upsertCasesFromServer([
      {
        serviceCaseId: testServerCaseId,
        sourceComplaintId: 'src-sc-14',
        zentraCaseCode: 'ZNT-2026-CH-00014',
        schoolId: 'sch-01',
        labId: 'lab-01',
        operationalStatus: 'ASSIGNED',
        internalPriority: 'NORMAL',
        assignedPrimaryEngineerId: testEngineerId,
        slaBreachStatus: 'WITHIN_SLA',
        actualDiagnosisSummary: 'Diagnosis 14',
        verificationStatus: 'PENDING_REVIEW',
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const op = await queue.enqueueStandalone({
      clientOperationId: '01a15000-0000-7000-8000-000000000014',
      entityType: 'service_cases',
      localEntityId: 'loc-sc-14',
      serverEntityId: testServerCaseId,
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'VISIT_STARTED' },
    });

    (mockApiService.pushMutations as any).mockResolvedValueOnce({
      batchId: 'batch-ok-14',
      serverTimestamp: new Date().toISOString(),
      results: [
        {
          clientOperationId: op.clientOperationId,
          status: 'ACCEPTED',
          serverVersion: '4',
          serverTimestamp: new Date().toISOString(),
        },
      ],
    });

    const summary = await syncEngine.sync();
    expect(summary.isSuccess).toBe(true);
    expect(summary.pushedCount).toBe(1);
    expect(summary.acknowledgedCount).toBe(1);

    const raw = await db.get('local_operations').find(op.id);
    expect((raw as any).status).toBe('ACKNOWLEDGED');

    const pending = await queue.getPendingOperations();
    expect(pending.length).toBe(0);
  });
});

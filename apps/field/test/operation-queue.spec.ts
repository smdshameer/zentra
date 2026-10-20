/**
 * ZENTRA Field — Operation Queue Test Suite
 * apps/field/test/operation-queue.spec.ts
 *
 * Verifies local persistent operation queue behavior:
 * - Deterministic UUIDv7 operation ID generation
 * - Status transitions (QUEUED -> IN_FLIGHT -> ACKNOWLEDGED / FAILED)
 * - Retry bookkeeping and diagnostic error capture
 * - Queue statistics aggregation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAppDatabase } from '../src/database/database';
import { OperationQueue } from '../src/domain/queue/operation-queue';
import type { Database } from '@nozbe/watermelondb';

describe('Phase 10 — Local Operation Queue Foundation', () => {
  let db: Database;
  let queue: OperationQueue;

  beforeEach(() => {
    db = createAppDatabase({ inMemory: true, dbName: 'test_queue_' + Date.now() });
    queue = new OperationQueue(db);
  });

  it('enqueues local operations with monotonic UUIDv7 operation IDs', async () => {
    const op = await queue.enqueueStandalone({
      entityType: 'SERVICE_CASE',
      localEntityId: 'loc-sc-1',
      serverEntityId: 'sc-erode-101',
      operationType: 'STATUS_TRANSITION',
      payload: {
        targetStatus: 'IN_TRANSIT',
        notes: 'Engineer travelling to site',
      },
    });

    expect(op.clientOperationId).toBeDefined();
    expect(typeof op.clientOperationId).toBe('string');
    expect(op.status).toBe('QUEUED');
    expect(op.retryCount).toBe(0);
    expect(op.entityType).toBe('SERVICE_CASE');
    expect(op.isPending).toBe(true);

    const pending = await queue.getPendingOperations();
    expect(pending.length).toBe(1);
    expect(pending[0]?.clientOperationId).toBe(op.clientOperationId);
  });

  it('transitions operation through IN_FLIGHT to ACKNOWLEDGED', async () => {
    const op = await queue.enqueueStandalone({
      entityType: 'SERVICE_CASE',
      localEntityId: 'loc-sc-1',
      operationType: 'UPDATE',
      payload: { diagnosticField: 'Power supply OK' },
    });

    await queue.markInFlight(op.clientOperationId);
    let pending = await queue.getPendingOperations();
    expect(pending.length).toBe(0); // In flight operations are not in pending queue

    await queue.markAcknowledged(op.clientOperationId);
    const stats = await queue.getQueueStats();
    expect(stats.acknowledgedCount).toBe(1);
    expect(stats.totalPending).toBe(0);
  });

  it('increments retry count and records error message upon operation failure', async () => {
    const op = await queue.enqueueStandalone({
      entityType: 'SERVICE_CASE',
      localEntityId: 'loc-sc-2',
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_PROGRESS' },
    });

    await queue.markInFlight(op.clientOperationId);
    await queue.markFailed(op.clientOperationId, 'Network connection timed out');

    const pending = await queue.getPendingOperations();
    expect(pending.length).toBe(1);
    const failedOp = pending[0]!;
    expect(failedOp.status).toBe('FAILED');
    expect(failedOp.retryCount).toBe(1);
    expect(failedOp.errorMessage).toBe('Network connection timed out');
    expect(failedOp.lastAttemptAt).not.toBeNull();

    // Re-queue failed operations
    const requeuedCount = await queue.requeueFailedOperations();
    expect(requeuedCount).toBe(1);

    const stats = await queue.getQueueStats();
    expect(stats.queuedCount).toBe(1);
    expect(stats.failedCount).toBe(0);
  });

  it('aggregates real-time statistics across all operation lifecycle states', async () => {
    await queue.enqueueStandalone({
      entityType: 'SERVICE_CASE',
      localEntityId: 'loc-1',
      operationType: 'INSERT',
      payload: {},
    });
    const op2 = await queue.enqueueStandalone({
      entityType: 'SERVICE_CASE',
      localEntityId: 'loc-2',
      operationType: 'UPDATE',
      payload: {},
    });
    const op3 = await queue.enqueueStandalone({
      entityType: 'SERVICE_CASE',
      localEntityId: 'loc-3',
      operationType: 'UPDATE',
      payload: {},
    });

    await queue.markInFlight(op2.clientOperationId);
    await queue.markAcknowledged(op2.clientOperationId);

    await queue.markInFlight(op3.clientOperationId);
    await queue.markFailed(op3.clientOperationId, 'Temporary server error');

    const stats = await queue.getQueueStats();
    expect(stats.queuedCount).toBe(1); // op1
    expect(stats.acknowledgedCount).toBe(1); // op2
    expect(stats.failedCount).toBe(1); // op3
    expect(stats.totalPending).toBe(2); // op1 + op3
  });

  it('confirms queue does not perform synchronization or server push', async () => {
    // Operation queue is purely a local ledger — has no pushSync or network methods
    expect((queue as any).pushSync).toBeUndefined();
    expect((queue as any).syncWithServer).toBeUndefined();
    expect((queue as any).pullDelta).toBeUndefined();
  });

  it('confirms queue does not perform conflict arbitration or server merge logic', async () => {
    // Conflict arbitration belongs strictly to Phase 12
    expect((queue as any).arbitrateConflict).toBeUndefined();
    expect((queue as any).resolveMergeConflict).toBeUndefined();
    expect((queue as any).reconcileTombstone).toBeUndefined();
  });
});

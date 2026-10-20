/**
 * ZENTRA Field — Local Operation Queue Engine
 * apps/field/src/domain/queue/operation-queue.ts
 *
 * Implements a durable, database-backed local mutation queue.
 *
 * GUARANTEES:
 * 1. Survives application termination, crashes, and device reboots.
 * 2. Deterministic UUIDv7 operation ordering.
 * 3. Atomic pairing with local domain mutations.
 * 4. Tracking of retries and diagnostic errors.
 *
 * ARCHITECTURAL BOUNDARY:
 * This queue records local pending work strictly within the mobile SQLite database.
 * It is NOT the Phase 12 synchronization engine.
 * It does NOT perform:
 * - server push
 * - server acknowledgement
 * - delta synchronization
 * - conflict arbitration
 * - tombstone synchronization
 * - server/client merge logic
 * All server synchronization and conflict settlement are deferred to Phase 12.
 */

import { Database, Q } from '@nozbe/watermelondb';
import { LocalOperationModel } from '../../database/models/LocalOperationModel';
import { IdentityMap } from '../identity/identity-map';
import type {
  EnqueueOperationInput,
  OperationQueueStats,
  InFlightRecoveryResult,
} from './operation-types';

export class OperationQueue {
  constructor(private readonly database: Database) {}

  /**
   * Enqueues a local operation into the persistent database table.
   * NOTE: When executed within an ongoing database.write() transaction, caller must
   * ensure atomicity across the domain record write and this queue record write.
   */
  async enqueue(input: EnqueueOperationInput): Promise<LocalOperationModel> {
    const operationId = input.clientOperationId || IdentityMap.generateOperationId();
    const payloadStr = JSON.stringify(input.payload);

    return await this.database.get<LocalOperationModel>('local_operations').create((op) => {
      op.clientOperationId = operationId;
      op.entityType = input.entityType;
      op.localEntityId = input.localEntityId;
      op.serverEntityId = input.serverEntityId || null;
      op.operationType = input.operationType;
      op.payloadJson = payloadStr;
      op.baseVersion = input.baseVersion || null;
      op.status = 'QUEUED';
      op.retryCount = 0;
      op.lastAttemptAt = null;
      op.errorMessage = null;
    });
  }

  /**
   * Enqueues operation wrapped in its own database.write transaction
   */
  async enqueueStandalone(input: EnqueueOperationInput): Promise<LocalOperationModel> {
    return await this.database.write(async () => {
      return await this.enqueue(input);
    });
  }

  /**
   * Retrieves all pending operations (QUEUED or FAILED) ordered chronologically
   */
  async getPendingOperations(): Promise<LocalOperationModel[]> {
    return await this.database
      .get<LocalOperationModel>('local_operations')
      .query(
        Q.or(Q.where('status', 'QUEUED'), Q.where('status', 'FAILED')),
        Q.sortBy('created_at', Q.asc),
      )
      .fetch();
  }

  /**
   * Marks an operation as IN_FLIGHT
   */
  async markInFlight(operationId: string): Promise<void> {
    await this.database.write(async () => {
      const records = await this.database
        .get<LocalOperationModel>('local_operations')
        .query(Q.where('client_operation_id', operationId))
        .fetch();

      if (records.length > 0) {
        await records[0]!.update((op) => {
          op.status = 'IN_FLIGHT';
          op.lastAttemptAt = new Date();
        });
      }
    });
  }

  /**
   * Marks an operation as FAILED and increments retry count
   */
  async markFailed(operationId: string, errorMessage: string): Promise<void> {
    await this.database.write(async () => {
      const records = await this.database
        .get<LocalOperationModel>('local_operations')
        .query(Q.where('client_operation_id', operationId))
        .fetch();

      if (records.length > 0) {
        await records[0]!.update((op) => {
          op.status = 'FAILED';
          op.retryCount = op.retryCount + 1;
          op.errorMessage = errorMessage;
          op.lastAttemptAt = new Date();
        });
      }
    });
  }

  /**
   * Marks an operation as ACKNOWLEDGED upon successful server commit
   */
  async markAcknowledged(operationId: string): Promise<void> {
    await this.database.write(async () => {
      const records = await this.database
        .get<LocalOperationModel>('local_operations')
        .query(Q.where('client_operation_id', operationId))
        .fetch();

      if (records.length > 0) {
        await records[0]!.update((op) => {
          op.status = 'ACKNOWLEDGED';
          op.errorMessage = null;
          op.conflictCode = null;
        });
      }
    });
  }

  /**
   * Marks an operation as CONFLICT with structured conflict category code and diagnostic reason
   */
  async markConflict(
    operationId: string,
    conflictCode: string,
    errorMessage?: string,
  ): Promise<void> {
    await this.database.write(async () => {
      const records = await this.database
        .get<LocalOperationModel>('local_operations')
        .query(Q.where('client_operation_id', operationId))
        .fetch();

      if (records.length > 0) {
        await records[0]!.update((op) => {
          op.status = 'CONFLICT';
          op.conflictCode = conflictCode;
          op.errorMessage = errorMessage || `Conflict: ${conflictCode}`;
          op.lastAttemptAt = new Date();
        });
      }
    });
  }

  /**
   * Evaluates operations left IN_FLIGHT upon application restart or recovery.
   *
   * SAFE RECOVERY RULES (Stage 6G-B3-C1-R):
   * 1. Provably Unsubmitted: If status === 'IN_FLIGHT' and lastAttemptAt is null/undefined,
   *    no network transmission was ever dispatched. Safely reset to QUEUED with original
   *    clientOperationId and payload preserved.
   * 2. Uncertain Server Outcome: If status === 'IN_FLIGHT' and lastAttemptAt is set,
   *    network transmission was initiated before process interruption. The server outcome is
   *    ambiguous (mutation may have committed on server or rolled back). In fail-closed mode,
   *    this operation is marked CONFLICT with conflictCode = 'UNCERTAIN_OUTCOME' and
   *    descriptive errorMessage. It is NOT automatically replayed, preserving original
   *    clientOperationId and payload for manual reconciliation or verified recovery.
   */
  async recoverInFlightOperations(): Promise<InFlightRecoveryResult> {
    const inFlight = await this.database
      .get<LocalOperationModel>('local_operations')
      .query(Q.where('status', 'IN_FLIGHT'))
      .fetch();

    if (inFlight.length === 0) {
      return { recoveredCount: 0, ambiguousCount: 0 };
    }

    return await this.database.write(async () => {
      let recoveredCount = 0;
      let ambiguousCount = 0;

      for (const op of inFlight) {
        if (!op.lastAttemptAt) {
          // Provably unsubmitted: no transmission timestamp recorded
          await op.update((rec) => {
            rec.status = 'QUEUED';
          });
          recoveredCount++;
        } else {
          // Uncertain server outcome: transmission was initiated
          await op.update((rec) => {
            rec.status = 'CONFLICT';
            rec.conflictCode = 'UNCERTAIN_OUTCOME';
            rec.errorMessage =
              'Ambiguous in-flight operation: server outcome uncertain following process interruption. Preserved for reconciliation.';
          });
          ambiguousCount++;
        }
      }

      return { recoveredCount, ambiguousCount };
    });
  }

  /**
   * Resets all FAILED operations back to QUEUED for retry
   */
  async requeueFailedOperations(): Promise<number> {
    return await this.database.write(async () => {
      const failed = await this.database
        .get<LocalOperationModel>('local_operations')
        .query(Q.where('status', 'FAILED'))
        .fetch();

      for (const op of failed) {
        await op.update((rec) => {
          rec.status = 'QUEUED';
        });
      }

      return failed.length;
    });
  }

  /**
   * Aggregates real-time statistics for the local operation queue
   */
  async getQueueStats(): Promise<OperationQueueStats> {
    const all = await this.database
      .get<LocalOperationModel>('local_operations')
      .query()
      .fetch();

    let queuedCount = 0;
    let inFlightCount = 0;
    let failedCount = 0;
    let acknowledgedCount = 0;
    let conflictCount = 0;

    for (const op of all) {
      if (op.status === 'QUEUED') queuedCount++;
      else if (op.status === 'IN_FLIGHT') inFlightCount++;
      else if (op.status === 'FAILED') failedCount++;
      else if (op.status === 'ACKNOWLEDGED') acknowledgedCount++;
      else if (op.status === 'CONFLICT') conflictCount++;
    }

    return {
      totalPending: queuedCount + failedCount,
      queuedCount,
      inFlightCount,
      failedCount,
      acknowledgedCount,
      conflictCount,
    };
  }
}

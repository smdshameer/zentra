/**
 * ZENTRA Field — Delta Synchronization Engine
 * apps/field/src/sync/sync-engine.ts
 *
 * Primary coordinator for mobile delta synchronization and conflict arbitration:
 * - App restart recovery: Safely recovers IN_FLIGHT operations back to QUEUED
 * - Outbound Push: Sends batches of local mutations with UUIDv7 idempotency
 * - Conflict Settlement: Reconciles ACCEPTED, CONFLICT, and REJECTED server decisions
 * - Downstream Pull: Fetches row-level deltas and tombstones using opaque cursors
 * - Atomic Application: Commits deltas and advances cursor in all-or-nothing transactions
 */

import { Database, Q } from '@nozbe/watermelondb';
import { OperationQueue } from '../domain/queue/operation-queue';
import type { InFlightRecoveryResult } from '../domain/queue/operation-types';
import { SyncMetadataRepository } from './sync-metadata.repository';
import { DeltaApplier } from './delta-applier';
import { SyncApiService } from './sync-api.service';
import { IdentityMap } from '../domain/identity/identity-map';
import { ServiceCaseModel } from '../database/models/ServiceCaseModel';
import { LocalOperationModel } from '../database/models/LocalOperationModel';
import { FieldVisitModel } from '../database/models/FieldVisitModel';
import { EvidenceModel } from '../database/models/EvidenceModel';
import {
  type SyncConfig,
  type SyncEngineState,
  type SyncSummary,
  DEFAULT_SYNC_CONFIG,
} from './sync.types';
import type { SyncMutationItem, SyncPushRequest } from '@zentra/types';

export class SyncEngine {
  private state: SyncEngineState = 'IDLE';
  private readonly config: SyncConfig;
  private readonly metadataRepo: SyncMetadataRepository;
  private readonly deltaApplier: DeltaApplier;

  constructor(
    private readonly database: Database,
    private readonly apiService: SyncApiService,
    private readonly queue: OperationQueue,
    metadataRepo?: SyncMetadataRepository,
    deltaApplier?: DeltaApplier,
    config?: Partial<SyncConfig>,
  ) {
    this.metadataRepo = metadataRepo || new SyncMetadataRepository(database);
    this.deltaApplier = deltaApplier || new DeltaApplier(database);
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  /**
   * Initializes the sync engine on application launch.
   * Evaluates operations that were left in-flight when the app was previously terminated or crashed.
   */
  async initialize(): Promise<{ recoveredOperations: number; ambiguousOperations: number }> {
    const res = await this.recoverInFlightOperations();
    return {
      recoveredOperations: res.recoveredCount,
      ambiguousOperations: res.ambiguousCount,
    };
  }

  /**
   * Evaluates operations left in-flight: resets provably unsubmitted operations to QUEUED
   * and transitions uncertain operations to CONFLICT in fail-closed mode.
   */
  async recoverInFlightOperations(): Promise<InFlightRecoveryResult> {
    return await this.queue.recoverInFlightOperations();
  }

  /**
   * Executes a complete, deterministic synchronization cycle:
   * 1. Push pending local mutations to server
   * 2. Reconcile server responses, conflicts, and acknowledgments
   * 3. Pull downstream deltas and purge tombstones
   * 4. Advance local sync cursor only after successful commit
   */
  async sync(): Promise<SyncSummary> {
    if (this.state === 'SYNCING') {
      throw new Error('Sync is already in progress');
    }

    this.state = 'SYNCING';
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    let pushedCount = 0;
    let acknowledgedCount = 0;
    let conflictCount = 0;
    let failedCount = 0;
    let totalDeltasApplied = 0;
    let totalTombstonesPurged = 0;
    let finalCursor: string | null = null;

    try {
      // ==========================================
      // PHASE 1: OUTBOUND PUSH (LOCAL MUTATIONS)
      // ==========================================
      await this.queue.recoverInFlightOperations();
      const pendingOps = await this.queue.getPendingOperations();

      if (pendingOps.length > 0) {
        // Take up to pushBatchSize operations
        const batchToPush = pendingOps.slice(0, this.config.pushBatchSize);
        pushedCount = batchToPush.length;

        // Mark operations IN_FLIGHT
        for (const op of batchToPush) {
          await this.queue.markInFlight(op.clientOperationId);
        }

        const mutations: SyncMutationItem[] = [];

        for (const op of batchToPush) {
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(op.payloadJson);
          } catch {
            payload = {};
          }

          mutations.push({
            clientOperationId: op.clientOperationId,
            entityType: op.entityType,
            entityId: op.serverEntityId || op.localEntityId,
            operationType: op.operationType as any,
            payload,
            clientCreatedAt: op.createdAt.toISOString(),
            clientBaseVersion: op.baseVersion || '1',
            clientVersion: op.baseVersion || '1',
          });
        }

        const pushRequest: SyncPushRequest = {
          clientBatchId: IdentityMap.generateOperationId(),
          mutations,
        };

        let pushResponse;
        try {
          pushResponse = await this.apiService.pushMutations(pushRequest);

          if (!pushResponse || !Array.isArray(pushResponse.results)) {
            throw new Error(
              `Malformed server push response: expected results array, received ${typeof pushResponse}`,
            );
          }
        } catch (pushErr: any) {
          const isPreDispatch = pushErr?.isPreDispatch === true;

          for (const op of batchToPush) {
            await this.database.write(async () => {
              const recs = await this.database
                .get<LocalOperationModel>('local_operations')
                .query(Q.where('client_operation_id', op.clientOperationId))
                .fetch();
              if (recs.length > 0) {
                await recs[0]!.update((o: LocalOperationModel) => {
                  o.retryCount = o.retryCount + 1;
                  o.lastAttemptAt = new Date();

                  if (isPreDispatch) {
                    // Safe retry path: Only when transport lifecycle provides definitive proof request was never dispatched
                    o.status = o.retryCount >= this.config.maxRetries ? 'FAILED' : 'QUEUED';
                    o.errorMessage = `Pre-dispatch failure: ${pushErr.message || 'Dispatch cancelled before network transmission'}`;
                  } else {
                    // Fail-closed path: All ambiguous outcomes (timeout, socket reset, network failure, HTTP 5xx, or malformed response)
                    // Mark as CONFLICT with UNCERTAIN_OUTCOME to prevent unsafe automatic replay
                    o.status = 'CONFLICT';
                    o.conflictCode = 'UNCERTAIN_OUTCOME';
                    o.errorMessage = formatAmbiguousErrorMessage(pushErr);
                  }
                });
              }
            });
          }
          conflictCount += isPreDispatch ? 0 : batchToPush.length;
          throw pushErr;
        }

        // Process mutation outcomes
        const processedOpIds = new Set<string>();

        for (const res of pushResponse.results) {
          processedOpIds.add(res.clientOperationId);

          if (res.status === 'ACCEPTED') {
            await this.queue.markAcknowledged(res.clientOperationId);
            acknowledgedCount++;

            // If this was a service case mutation, update local syncState to SYNCED and advance serverVersion
            const op = batchToPush.find((o) => o.clientOperationId === res.clientOperationId);
            const isCase =
              op &&
              (op.entityType === 'service_cases' ||
                op.entityType === 'SERVICE_CASE');

            if (isCase) {
              await this.database.write(async () => {
                const cases = await this.database
                  .get<ServiceCaseModel>('service_cases')
                  .query(
                    Q.or(
                      Q.where('id', op.localEntityId),
                      Q.where('server_id', op.serverEntityId || op.localEntityId),
                    ),
                  )
                  .fetch();

                if (cases.length > 0) {
                  await cases[0]!.update((rec) => {
                    rec.syncState = 'SYNCED';
                    if (res.serverVersion) {
                      rec.serverVersion = res.serverVersion;
                    }
                  });
                }
              });
            }

            const isVisit =
              op &&
              (op.entityType === 'field_visits' ||
                op.entityType === 'FIELD_VISIT');

            if (isVisit) {
              await this.database.write(async () => {
                const visits = await this.database
                  .get<FieldVisitModel>('field_visits')
                  .query(
                    Q.or(
                      Q.where('id', op.localEntityId),
                      Q.where('server_id', op.serverEntityId || op.localEntityId),
                    ),
                  )
                  .fetch();

                if (visits.length > 0) {
                  await visits[0]!.update((rec) => {
                    rec.syncState = 'SYNCED';
                    if (res.serverVersion) {
                      rec.serverVersion = res.serverVersion;
                    }
                    if (res.data?.visitSequenceNumber) {
                      rec.visitSequenceNumber = Number(res.data.visitSequenceNumber);
                    }
                  });
                }
              });
            }

            const isEvidence =
              op &&
              (op.entityType === 'evidence_files' ||
                op.entityType === 'EVIDENCE_FILE');

            if (isEvidence) {
              await this.database.write(async () => {
                const records = await this.database
                  .get<EvidenceModel>('evidence')
                  .query(
                    Q.or(
                      Q.where('id', op.localEntityId),
                      Q.where('server_id', op.serverEntityId || op.localEntityId),
                    ),
                  )
                  .fetch();

                if (records.length > 0) {
                  await records[0]!.update((rec) => {
                    rec.syncState = 'SYNCED';
                    if (op.serverEntityId && !rec.serverId) {
                      rec.serverId = op.serverEntityId;
                    }
                    if (res.serverVersion) {
                      rec.serverVersion = res.serverVersion;
                    }
                    if (res.data?.storagePath && !rec.storagePath) {
                      rec.storagePath = String(res.data.storagePath);
                    }
                  });
                }
              });
            }
          } else if (res.status === 'CONFLICT') {
            await this.queue.markConflict(
              res.clientOperationId,
              res.conflictCode || 'VERSION_CONFLICT',
              res.message || 'Server reported conflict',
            );
            conflictCount++;
          } else if (res.status === 'REJECTED') {
            await this.queue.markFailed(
              res.clientOperationId,
              res.message || 'Operation permanently rejected by server',
            );
            failedCount++;
          } else {
            // Unrecognized outcome from server: fail-closed as CONFLICT
            await this.queue.markConflict(
              res.clientOperationId,
              'UNCERTAIN_OUTCOME',
              `Unrecognized mutation outcome '${(res as any).status}' from server. Preserved for reconciliation.`,
            );
            conflictCount++;
          }
        }

        // Fail-closed: If server response omitted any mutation from the batch, transition to CONFLICT
        for (const op of batchToPush) {
          if (!processedOpIds.has(op.clientOperationId)) {
            await this.queue.markConflict(
              op.clientOperationId,
              'UNCERTAIN_OUTCOME',
              'Omitted from server push response batch: outcome uncertain. Preserved for reconciliation.',
            );
            conflictCount++;
          }
        }
      }

      // ==========================================
      // PHASE 2: DOWNSTREAM PULL (SERVER DELTAS)
      // ==========================================
      let hasMore = true;
      let pages = 0;
      const MAX_PAGES = 10;

      while (hasMore && pages < MAX_PAGES) {
        pages++;
        const currentCursor = await this.metadataRepo.getCursor();

        const deltaResponse = await this.apiService.pullDelta({
          cursor: currentCursor || undefined,
          limit: this.config.deltaPageSize,
        });

        // Apply delta batch atomically (persists cursor inside transaction)
        const applyResult = await this.deltaApplier.applyDeltaBatch(deltaResponse);
        totalDeltasApplied += applyResult.appliedCount;
        totalTombstonesPurged += applyResult.purgedCount;
        finalCursor = applyResult.advancedCursor || currentCursor;

        hasMore = deltaResponse.hasMore;
      }

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;
      this.state = 'IDLE';

      return {
        startedAt,
        completedAt,
        durationMs,
        pushedCount,
        acknowledgedCount,
        conflictCount,
        failedCount,
        deltasAppliedCount: totalDeltasApplied,
        tombstonesPurgedCount: totalTombstonesPurged,
        newCursor: finalCursor,
        isSuccess: true,
      };
    } catch (err: any) {
      this.state = 'ERROR';
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      // Reset any in-flight operations that were interrupted
      await this.queue.recoverInFlightOperations();

      return {
        startedAt,
        completedAt,
        durationMs,
        pushedCount,
        acknowledgedCount,
        conflictCount,
        failedCount,
        deltasAppliedCount: totalDeltasApplied,
        tombstonesPurgedCount: totalTombstonesPurged,
        newCursor: finalCursor,
        isSuccess: false,
        error: err.message || 'Sync execution failed',
      };
    } finally {
      if (this.state === 'SYNCING') {
        this.state = 'IDLE';
      }
    }
  }

  getState(): SyncEngineState {
    return this.state;
  }

  getConfig(): Readonly<SyncConfig> {
    return this.config;
  }
}

/**
 * Formats a clear, diagnostic error message for fail-closed ambiguous dispatch outcomes.
 */
function formatAmbiguousErrorMessage(err: any): string {
  const msg = err?.message || 'Unknown network error';
  if (err?.name === 'AbortError' || /timed?\s*out|timeout/i.test(msg) || err?.kind === 'TIMEOUT') {
    return `Network timeout during push: server outcome uncertain (${msg}). Preserved for reconciliation.`;
  }
  if (err?.kind === 'SERVER_ERROR' || (typeof err?.statusCode === 'number' && err.statusCode >= 500)) {
    return `Server error (${err.statusCode || 500}) during push: server outcome uncertain (${msg}). Preserved for reconciliation.`;
  }
  if (/econnreset|socket hang up|connection reset/i.test(msg)) {
    return `Connection reset during push: server outcome uncertain (${msg}). Preserved for reconciliation.`;
  }
  if (/malformed|syntaxerror|unexpected token/i.test(msg)) {
    return `Malformed response during push: server outcome uncertain (${msg}). Preserved for reconciliation.`;
  }
  return `Ambiguous network failure during push: server outcome uncertain (${msg}). Preserved for reconciliation.`;
}



/**
 * ZENTRA Field — Delta Synchronization Types
 * apps/field/src/sync/sync.types.ts
 *
 * Strongly-typed definitions for mobile sync lifecycle, results,
 * summaries, and error diagnostics.
 */

import type { SyncConflictCode } from '@zentra/types';

export type SyncEngineState = 'IDLE' | 'SYNCING' | 'ERROR';

export interface SyncConfig {
  /** Batch limit for push operations (default: 50) */
  pushBatchSize: number;
  /** Page limit for delta stream pulls (default: 50) */
  deltaPageSize: number;
  /** Max retries for transient failures */
  maxRetries: number;
  /** Base backoff delay in milliseconds */
  baseBackoffMs: number;
}

export const DEFAULT_SYNC_CONFIG: Readonly<SyncConfig> = Object.freeze({
  pushBatchSize: 50,
  deltaPageSize: 50,
  maxRetries: 3,
  baseBackoffMs: 1000,
});

export interface SyncSummary {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  pushedCount: number;
  acknowledgedCount: number;
  conflictCount: number;
  failedCount: number;
  deltasAppliedCount: number;
  tombstonesPurgedCount: number;
  newCursor: string | null;
  isSuccess: boolean;
  error?: string;
}

export interface SyncConflictItem {
  clientOperationId: string;
  entityType: string;
  entityId: string;
  conflictCode: SyncConflictCode;
  reason?: string;
  serverVersion?: string;
}

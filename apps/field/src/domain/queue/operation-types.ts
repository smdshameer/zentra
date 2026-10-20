/**
 * ZENTRA Field — Local Operation Queue Types
 * apps/field/src/domain/queue/operation-types.ts
 */

export type LocalOperationType = 'INSERT' | 'UPDATE' | 'STATUS_TRANSITION';
export type LocalOperationStatus = 'QUEUED' | 'IN_FLIGHT' | 'FAILED' | 'ACKNOWLEDGED' | 'CONFLICT';

export interface EnqueueOperationInput {
  clientOperationId?: string; // Optional; auto-generated if omitted
  entityType: string;
  localEntityId: string;
  serverEntityId?: string | null;
  operationType: LocalOperationType;
  baseVersion?: string | null;
  payload: Record<string, unknown>;
}

export interface OperationQueueStats {
  totalPending: number;
  queuedCount: number;
  inFlightCount: number;
  failedCount: number;
  acknowledgedCount: number;
  conflictCount: number;
}

export interface InFlightRecoveryResult {
  recoveredCount: number;
  ambiguousCount: number;
}

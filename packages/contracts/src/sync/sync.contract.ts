/**
 * ZENTRA — Delta Synchronization & Conflict Arbitration Contracts
 * packages/contracts/src/sync/sync.contract.ts
 *
 * Authoritative Zod schemas and TypeScript types for:
 * - POST /api/v1/sync/push (Upstream batch mutations with idempotency)
 * - GET /api/v1/sync/delta (Downstream row-level delta stream with opaque cursors)
 * - Domain conflict codes and typed results
 */

import { z } from 'zod';
import { uuidv7Schema, isoDateTimeSchema } from '@zentra/validation';

/** Typed Conflict Categories */
export const syncConflictCodeSchema = z.enum([
  'VERSION_CONFLICT',
  'RECORD_NOT_FOUND',
  'RECORD_INACTIVE',
  'AUTHORIZATION_CHANGED',
  'TERRITORY_ACCESS_CHANGED',
  'INVALID_STATE_TRANSITION',
  'DUPLICATE_OPERATION',
  'SERVER_VALIDATION_FAILED',
  'ENTITY_TOMBSTONED',
]);
export type SyncConflictCode = z.infer<typeof syncConflictCodeSchema>;

/** Mutation Operation Types */
export const syncMutationOperationTypeSchema = z.enum([
  'INSERT',
  'UPDATE',
  'STATUS_TRANSITION',
  'SOFT_DELETE',
]);
export type SyncMutationOperationType = z.infer<typeof syncMutationOperationTypeSchema>;

/** Single Outbound Mutation Item in Push Batch */
export const syncMutationItemSchema = z.object({
  clientOperationId: uuidv7Schema,
  entityType: z.string().min(1).max(64),
  entityId: z.string().min(1),
  operationType: syncMutationOperationTypeSchema,
  clientBaseVersion: z.string().optional(),
  clientVersion: z.string().optional(),
  payload: z.record(z.unknown()),
  clientCreatedAt: isoDateTimeSchema,
});
export type SyncMutationItem = z.infer<typeof syncMutationItemSchema>;

/** Push Request Envelope */
export const syncPushRequestSchema = z.object({
  clientBatchId: uuidv7Schema,
  mutations: z.array(syncMutationItemSchema).min(1).max(100),
});
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

/** Single Mutation Result Status */
export const syncMutationResultStatusSchema = z.enum([
  'ACCEPTED',
  'REJECTED',
  'CONFLICT',
]);
export type SyncMutationResultStatus = z.infer<typeof syncMutationResultStatusSchema>;

/** Result for a single mutation */
export const syncMutationResultSchema = z.object({
  clientOperationId: z.string(),
  status: syncMutationResultStatusSchema,
  serverVersion: z.string().optional(),
  conflictCode: syncConflictCodeSchema.optional(),
  message: z.string().optional(),
  serverTimestamp: isoDateTimeSchema,
  data: z.record(z.unknown()).optional(),
});
export type SyncMutationResult = z.infer<typeof syncMutationResultSchema>;

/** Push Response Data Body */
export const syncPushResponseDataSchema = z.object({
  batchId: z.string(),
  results: z.array(syncMutationResultSchema),
  serverTimestamp: isoDateTimeSchema,
});
export type SyncPushResponseData = z.infer<typeof syncPushResponseDataSchema>;

/** Delta Stream Request Query Parameters */
export const syncDeltaRequestQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type SyncDeltaRequestQuery = z.infer<typeof syncDeltaRequestQuerySchema>;

/** Single Row-Level Change in Delta Stream */
export const syncDeltaChangeItemSchema = z.object({
  entityType: z.string().min(1).max(64),
  entityId: z.string(),
  action: z.enum(['UPSERT', 'TOMBSTONE']),
  version: z.string(),
  updatedAt: isoDateTimeSchema,
  data: z.record(z.unknown()).nullable(),
});
export type SyncDeltaChangeItem = z.infer<typeof syncDeltaChangeItemSchema>;

/** Tombstone Item in Delta Stream */
export const syncTombstoneItemSchema = z.object({
  entityType: z.string().min(1).max(64),
  entityId: z.string(),
  deletedAt: isoDateTimeSchema,
  reason: z.string().nullable().optional(),
});
export type SyncTombstoneItem = z.infer<typeof syncTombstoneItemSchema>;

/** Delta Stream Response Data Body */
export const syncDeltaResponseDataSchema = z.object({
  changes: z.array(syncDeltaChangeItemSchema),
  tombstones: z.array(syncTombstoneItemSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  serverTimestamp: isoDateTimeSchema,
});
export type SyncDeltaResponseData = z.infer<typeof syncDeltaResponseDataSchema>;

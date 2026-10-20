/**
 * ZENTRA — Sync Contract Structural Placeholders
 * packages/contracts/src/sync/sync.placeholder.ts
 *
 * NOTE: Structural foundation only. Domain-specific entities
 * will be defined in Phase 12 (Delta Synchronization).
 */

import { z } from 'zod';
import { uuidv7Schema, isoDateTimeSchema } from '@zentra/validation';

/** Sync Operation Type */
export const syncOperationTypeSchema = z.enum(['UPSERT', 'DELETE']);
export type SyncOperationType = z.infer<typeof syncOperationTypeSchema>;

/** Generic Sync Mutation Envelope (Structural Placeholder) */
export const syncMutationEnvelopeSchema = z.object({
  operationId: uuidv7Schema,
  entityName: z.string().min(1),
  recordId: uuidv7Schema,
  operation: syncOperationTypeSchema,
  clientTimestamp: isoDateTimeSchema,
  data: z.record(z.unknown()),
});
export type SyncMutationEnvelope = z.infer<typeof syncMutationEnvelopeSchema>;

/** Generic Sync Pull Request (Structural Placeholder) */
export const syncPullRequestSchema = z.object({
  lastSequence: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type SyncPullRequest = z.infer<typeof syncPullRequestSchema>;

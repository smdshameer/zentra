/**
 * ZENTRA — Staged Ingestion Contract Structural Placeholders
 * packages/contracts/src/imports/import.placeholder.ts
 *
 * NOTE: Structural foundation only. Real 5-tier duplicate rules
 * will be implemented in Phase 8 (Staged Ingestion).
 */

import { z } from 'zod';
import { uuidv7Schema } from '@zentra/validation';

/** Staging Batch Status */
export const stagingBatchStatusSchema = z.enum([
  'UPLOADED',
  'PARSING',
  'DIFF_READY',
  'APPROVED',
  'REJECTED',
]);
export type StagingBatchStatus = z.infer<typeof stagingBatchStatusSchema>;

/** Generic Staging Batch Summary (Placeholder) */
export const stagingBatchSummarySchema = z.object({
  batchId: uuidv7Schema,
  status: stagingBatchStatusSchema,
  fileName: z.string().min(1),
  totalRows: z.number().int().min(0),
  newCases: z.number().int().min(0),
  duplicateCases: z.number().int().min(0),
  errorRows: z.number().int().min(0),
});
export type StagingBatchSummaryDto = z.infer<typeof stagingBatchSummarySchema>;

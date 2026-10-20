/**
 * ZENTRA — Staged Ingestion & Deduplication API Contracts (Zod DTOs)
 * packages/contracts/src/imports/imports.contract.ts
 */

import { z } from 'zod';
import { uuidv7Schema } from '@zentra/validation';

/** Supported File Types */
export const importFileTypeSchema = z.enum(['XLSX', 'XLS', 'CSV']);
export type ImportFileTypeDto = z.infer<typeof importFileTypeSchema>;

/** Import Job Lifecycle Statuses */
export const importJobStatusSchema = z.enum([
  'RECEIVED',
  'PARSING',
  'STAGED',
  'VALIDATED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'COMMITTED',
  'FAILED',
  'REJECTED',
  'UPLOADED',
  'DIFF_PREVIEWED',
  'ABORTED',
]);
export type ImportJobStatusDto = z.infer<typeof importJobStatusSchema>;

/** Canonical 5-Tier Duplicate Classification Tiers */
export const duplicateClassificationTierSchema = z.enum([
  'EXACT_SOURCE_DUPLICATE',
  'NEW_UNIQUE',
  'NEW_ISSUE_DIFFERENT_EQUIPMENT',
  'ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT',
  'REOPENED_POST_SERVICE_FAILURE',
  'DUPLICATE_IN_FILE',
]);
export type DuplicateClassificationTierDto = z.infer<typeof duplicateClassificationTierSchema>;

/** Column Mapping Configuration Schema */
export const columnMappingConfigSchema = z.record(z.string()).optional();
export type ColumnMappingConfigDto = z.infer<typeof columnMappingConfigSchema>;

/** Create / Ingest Import Job Payload Schema */
export const createImportJobSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileType: importFileTypeSchema.optional(),
  fileContentBase64: z.string().optional(),
  csvContent: z.string().optional(),
  rows: z.array(z.record(z.unknown())).optional(),
  sourceSystemCode: z.string().max(50).optional().default('HELPLINE'),
  columnMapping: columnMappingConfigSchema,
}).refine(
  (data) => !!(data.fileContentBase64 || data.csvContent || (data.rows && data.rows.length > 0)),
  {
    message: 'Either fileContentBase64, csvContent, or rows must be provided',
    path: ['fileContentBase64'],
  },
);
export type CreateImportJobDto = z.infer<typeof createImportJobSchema>;

/** Query Import Jobs Schema */
export const queryImportJobsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: importJobStatusSchema.optional(),
  search: z.string().optional(),
});
export type QueryImportJobsDto = z.infer<typeof queryImportJobsSchema>;

/** Query Staging Records Schema */
export const queryStagingRecordsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  duplicateClassification: z.string().optional(),
  isValid: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
  isApproved: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
});
export type QueryStagingRecordsDto = z.infer<typeof queryStagingRecordsSchema>;

/** Approve Staging Records Schema */
export const approveStagingRecordsSchema = z.object({
  recordIds: z.array(uuidv7Schema).optional(),
  isApproved: z.boolean().default(true),
  notes: z.string().max(1000).optional(),
});
export type ApproveStagingRecordsDto = z.infer<typeof approveStagingRecordsSchema>;

/** Commit Import Job Schema */
export const commitImportJobSchema = z.object({
  notes: z.string().max(1000).optional(),
});
export type CommitImportJobDto = z.infer<typeof commitImportJobSchema>;

/** Reject Import Job Schema */
export const rejectImportJobSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type RejectImportJobDto = z.infer<typeof rejectImportJobSchema>;

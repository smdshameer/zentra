/**
 * ZENTRA — Evidence Domain API Contracts and Validation Schemas (Phase 14)
 * packages/contracts/src/evidence/evidence.contract.ts
 */

import { z } from 'zod';
import { uuidv7Schema } from '@zentra/validation';

/** Controlled Evidence Slots */
export const evidenceSlotSchema = z.enum([
  'SLOT_1_HM_SIGNED_REPORT',
  'SLOT_2_EQUIPMENT_WORKING_PHOTO',
  'SLOT_AUX_FAULT_PRE_SERVICE',
  'SLOT_AUX_SERIAL_PLATE',
  'SLOT_AUX_REPLACED_PARTS',
  'BEFORE_SERVICE_PHOTO',
  'SERIAL_NUMBER_PHOTO',
  'PARTS_SPARES_PHOTO',
  'DIAGNOSTIC_PHOTO',
  'OTHER_ATTACHMENT',
  // Backward-compatibility aliases
  'SLOT_1_DEFECT',
  'SLOT_2_COMPLETION',
]);
export type EvidenceSlot = z.infer<typeof evidenceSlotSchema>;

/** Restricted Mandatory Slots (Single active file per visit) */
export const RESTRICTED_EVIDENCE_SLOTS: EvidenceSlot[] = [
  'SLOT_1_HM_SIGNED_REPORT',
  'SLOT_2_EQUIPMENT_WORKING_PHOTO',
  'SLOT_1_DEFECT',
  'SLOT_2_COMPLETION',
];

/** Evidence Media Types */
export const evidenceTypeSchema = z.enum(['PHOTO', 'DOCUMENT', 'SIGNATURE']);
export type EvidenceType = z.infer<typeof evidenceTypeSchema>;

/** Evidence Upload Lifecycle Statuses */
export const evidenceUploadStatusSchema = z.enum([
  'LOCAL_CAPTURED',
  'QUEUED',
  'UPLOAD_SESSION_CREATED',
  'UPLOADING',
  'UPLOADED',
  'FINALIZED',
  'VERIFIED',
  'UPLOAD_FAILED',
  'LEGACY_UNVERIFIED',
  'LEGACY_MIGRATED',
]);
export type EvidenceUploadStatus = z.infer<typeof evidenceUploadStatusSchema>;

/** Allowed MIME Types */
export const allowedEvidenceMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const evidenceMimeTypeSchema = z.enum(allowedEvidenceMimeTypes);
export type EvidenceMimeType = z.infer<typeof evidenceMimeTypeSchema>;

/** Configurable Maximum File Size (Default: 15MB) */
export const DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES = 15 * 1024 * 1024;

/** Presigned URL Expiration Duration (Default: 15 minutes / 900 seconds) */
export const DEFAULT_PRESIGNED_EXPIRATION_SECONDS = 900;

/** Request Upload Session Contract (Client -> Server) */
export const createEvidenceUploadSessionSchema = z.object({
  clientEvidenceId: uuidv7Schema.optional(),
  visitId: uuidv7Schema,
  serviceCaseId: uuidv7Schema,
  evidenceSlot: evidenceSlotSchema,
  evidenceType: evidenceTypeSchema.default('PHOTO'),
  localMediaId: z.string().max(100).optional(),
  mimeType: evidenceMimeTypeSchema,
  fileSizeBytes: z
    .number()
    .int()
    .positive()
    .max(DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES, 'File size must not exceed 15MB'),
  fileChecksumSha256: z
    .string()
    .length(64, 'Must be a 64-character SHA-256 hexadecimal string')
    .regex(/^[a-fA-F0-9]{64}$/, 'Must be a valid hex string'),
  capturedAt: z.string().datetime().optional().default(() => new Date().toISOString()),
  gpsLatitude: z.number().min(-90).max(90).optional().nullable(),
  gpsLongitude: z.number().min(-180).max(180).optional().nullable(),
  gpsAccuracyMeters: z.number().positive().optional().nullable(),
  clientOperationId: uuidv7Schema.optional(),
});
export type CreateEvidenceUploadSessionDto = z.infer<typeof createEvidenceUploadSessionSchema>;

/** Upload Session Response Contract (Server -> Client) */
export const createEvidenceUploadSessionResponseSchema = z.object({
  evidenceId: uuidv7Schema,
  uploadSessionId: uuidv7Schema,
  presignedUploadUrl: z.string().url(),
  storagePath: z.string().min(1),
  expiresAt: z.string().datetime(),
  maxFileSizeBytes: z.number().int().positive(),
  expectedChecksumSha256: z.string().length(64),
});
export type CreateEvidenceUploadSessionResponseDto = z.infer<
  typeof createEvidenceUploadSessionResponseSchema
>;

/** Finalize Evidence Upload Contract (Client -> Server) */
export const finalizeEvidenceUploadSchema = z.object({
  actualChecksumSha256: z
    .string()
    .length(64)
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  actualFileSizeBytes: z.number().int().positive().optional(),
  verificationNotes: z.string().max(1000).optional(),
});
export type FinalizeEvidenceUploadDto = z.infer<typeof finalizeEvidenceUploadSchema>;

/** Download / Signed View URL Response Contract */
export const evidenceDownloadUrlResponseSchema = z.object({
  evidenceId: uuidv7Schema,
  downloadUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});
export type EvidenceDownloadUrlResponseDto = z.infer<typeof evidenceDownloadUrlResponseSchema>;

/** Full Evidence Entity Response Contract */
export const evidenceFileResponseSchema = z.object({
  evidenceId: uuidv7Schema,
  visitId: uuidv7Schema,
  serviceCaseId: uuidv7Schema,
  evidenceSlot: evidenceSlotSchema,
  evidenceType: evidenceTypeSchema,
  localMediaId: z.string().nullable().optional(),
  storagePath: z.string(),
  objectStorageProvider: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number(),
  fileChecksumSha256: z.string(),
  capturedAt: z.string().datetime(),
  uploadedAt: z.string().datetime().nullable().optional(),
  uploadStatus: evidenceUploadStatusSchema,
  gpsLatitude: z.number().nullable().optional(),
  gpsLongitude: z.number().nullable().optional(),
  gpsAccuracyMeters: z.number().nullable().optional(),
  isVerified: z.boolean(),
  verificationNotes: z.string().nullable().optional(),
  createdByUserId: uuidv7Schema.nullable().optional(),
  version: z.number(),
  isTombstoned: z.boolean(),
  isDeleted: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EvidenceFileResponseDto = z.infer<typeof evidenceFileResponseSchema>;

/** Evidence Query Filters Contract */
export const evidenceQueryFiltersSchema = z.object({
  visitId: uuidv7Schema.optional(),
  serviceCaseId: uuidv7Schema.optional(),
  evidenceSlot: evidenceSlotSchema.optional(),
  uploadStatus: evidenceUploadStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type EvidenceQueryFiltersDto = z.infer<typeof evidenceQueryFiltersSchema>;

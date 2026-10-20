/**
 * ZENTRA — Evidence Contract Structural Placeholders
 * packages/contracts/src/evidence/evidence.placeholder.ts
 *
 * NOTE: Structural foundation only. Slot-specific evidence policies
 * will be implemented in Phase 14 (Evidence Pipeline).
 */

import { z } from 'zod';
import { uuidv7Schema } from '@zentra/validation';

/** Evidence Slot Identifier (Slot 1 vs Slot 2) */
export const evidenceSlotSchema = z.enum(['SLOT_1_DEFECT', 'SLOT_2_COMPLETION']);
export type EvidenceSlot = z.infer<typeof evidenceSlotSchema>;

/** Request Presigned Upload URL Contract */
export const requestPresignedUploadSchema = z.object({
  fileSize: z
    .number()
    .int()
    .positive()
    .max(15 * 1024 * 1024, 'File size must not exceed 15MB'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  checksumSha256: z.string().length(64, 'Must be valid SHA-256 hex string'),
  slot: evidenceSlotSchema,
});
export type RequestPresignedUploadDto = z.infer<typeof requestPresignedUploadSchema>;

/** Presigned Upload Response Contract */
export const presignedUploadResponseSchema = z.object({
  uploadId: uuidv7Schema,
  presignedUrl: z.string().url(),
  s3Key: z.string().min(1),
  expiresAt: z.string().datetime(),
});
export type PresignedUploadResponseDto = z.infer<typeof presignedUploadResponseSchema>;

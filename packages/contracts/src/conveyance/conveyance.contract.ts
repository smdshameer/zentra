/**
 * ZENTRA — Conveyance Claims API Contracts & Validation Schemas (Phase 15)
 * packages/contracts/src/conveyance/conveyance.contract.ts
 */

import { z } from 'zod';
import { uuidv7Schema } from '@zentra/validation';

/** Supported Travel Modes */
export const travelModeSchema = z.enum(['BIKE', 'BUS', 'TRAIN', 'AUTO', 'OTHER']);
export type TravelMode = z.infer<typeof travelModeSchema>;

/** Deterministic Conveyance Claim Lifecycle Statuses */
export const conveyanceClaimStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'RETURNED_FOR_CORRECTION',
  'PAID',
]);
export type ConveyanceClaimStatus = z.infer<typeof conveyanceClaimStatusSchema>;

/**
 * Provisional / Configurable Default Conveyance Rates
 * NOTE: Phase 0 established conveyance rate variations as unresolved.
 * These rates are strictly:
 * PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY
 */
export const PROVISIONAL_DEFAULT_CONVEYANCE_RATES: Record<TravelMode, number> = {
  BIKE: 5.0, // Default candidate ₹5.00/km for two-wheeler field travel
  BUS: 2.5, // Standard public bus transit rate
  TRAIN: 2.0, // Regional suburban / passenger rail rate
  AUTO: 8.0, // Three-wheeler / shared auto local rate
  OTHER: 5.0, // General fallback travel rate
};

/** Schema for Creating / Logging a Conveyance Claim */
export const createConveyanceClaimSchema = z
  .object({
    visitId: uuidv7Schema,
    serviceCaseId: uuidv7Schema,
    engineerId: uuidv7Schema.optional(),
    travelDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'travelDate must be formatted as YYYY-MM-DD'),
    fromLocation: z.string().min(1, 'fromLocation is required').max(255),
    toLocation: z.string().min(1, 'toLocation is required').max(255),
    travelMode: travelModeSchema,
    startingOdometerKm: z.number().nonnegative('Starting odometer cannot be negative').optional().nullable(),
    endingOdometerKm: z.number().nonnegative('Ending odometer cannot be negative').optional().nullable(),
    capturedDistanceKm: z.number().nonnegative('Captured distance cannot be negative').optional().nullable(),
    claimedDistanceKm: z.number().positive('Claimed distance must be greater than zero'),
    gpsDistanceKm: z.number().nonnegative().optional().nullable(),
    supportingEvidenceFileId: uuidv7Schema.optional().nullable(),
    remarks: z.string().max(1000).optional().nullable(),
    clientOperationId: uuidv7Schema.optional().nullable(),
    submitDirectly: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      if (data.startingOdometerKm != null && data.endingOdometerKm != null) {
        return data.endingOdometerKm >= data.startingOdometerKm;
      }
      return true;
    },
    {
      message: 'Ending odometer reading must be greater than or equal to starting reading',
      path: ['endingOdometerKm'],
    },
  );
export type CreateConveyanceClaimDto = z.infer<typeof createConveyanceClaimSchema>;

/** Schema for Submitting a Draft or Returned Claim */
export const submitConveyanceClaimSchema = z.object({
  remarks: z.string().max(1000).optional().nullable(),
});
export type SubmitConveyanceClaimDto = z.infer<typeof submitConveyanceClaimSchema>;

/** Schema for Reviewing a Claim (Moves to UNDER_REVIEW) */
export const reviewConveyanceClaimSchema = z.object({
  reviewNotes: z.string().max(1000).optional().nullable(),
});
export type ReviewConveyanceClaimDto = z.infer<typeof reviewConveyanceClaimSchema>;

/** Schema for Approving a Conveyance Claim */
export const approveConveyanceClaimSchema = z.object({
  approvedDistanceKm: z.number().positive('Approved distance must be positive').optional().nullable(),
  approvedAmount: z.number().positive('Approved amount must be positive').optional().nullable(),
  approvalNotes: z.string().max(1000).optional().nullable(),
});
export type ApproveConveyanceClaimDto = z.infer<typeof approveConveyanceClaimSchema>;

/** Schema for Rejecting a Conveyance Claim */
export const rejectConveyanceClaimSchema = z.object({
  rejectionReason: z
    .string()
    .min(3, 'Rejection reason must be at least 3 characters')
    .max(1000),
});
export type RejectConveyanceClaimDto = z.infer<typeof rejectConveyanceClaimSchema>;

/** Schema for Returning a Claim for Correction */
export const returnConveyanceClaimSchema = z.object({
  correctionNotes: z
    .string()
    .min(3, 'Correction notes must be at least 3 characters')
    .max(1000),
});
export type ReturnConveyanceClaimDto = z.infer<typeof returnConveyanceClaimSchema>;

/** Schema for Marking a Claim as Paid */
export const payConveyanceClaimSchema = z.object({
  paymentReference: z.string().max(100).optional().nullable(),
  paidAmount: z.number().positive('Paid amount must be positive').optional().nullable(),
});
export type PayConveyanceClaimDto = z.infer<typeof payConveyanceClaimSchema>;

/** Schema for Querying Conveyance Claims with Search and Pagination */
export const conveyanceQueryFiltersSchema = z.object({
  status: conveyanceClaimStatusSchema.optional(),
  travelMode: travelModeSchema.optional(),
  engineerId: uuidv7Schema.optional(),
  districtId: uuidv7Schema.optional(),
  serviceCaseId: uuidv7Schema.optional(),
  visitId: uuidv7Schema.optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
export type ConveyanceQueryFiltersDto = z.infer<typeof conveyanceQueryFiltersSchema>;

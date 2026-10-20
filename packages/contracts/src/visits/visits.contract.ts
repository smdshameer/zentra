/**
 * ZENTRA — Field Visit Execution & Multi-Visit Flow Contracts
 * packages/contracts/src/visits/visits.contract.ts
 *
 * Defines canonical schemas for:
 * - Visit creation and sequencing
 * - GPS proximity check-in (<=50m accuracy, configurable geofence)
 * - On-site work lifecycle (PLANNED -> EN_ROUTE -> CHECKED_IN -> IN_PROGRESS -> COMPLETED)
 * - Structured outcomes (RESOLVED_ON_SITE, PENDING_PARTS, etc.)
 * - Check-out with device/server timestamps and append-only audit
 */

import { z } from 'zod';

export const visitStatusEnum = z.enum([
  'PLANNED',
  'EN_ROUTE',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'ABORTED',
  'PENDING_RETURN',
]);

export const visitOutcomeEnum = z.enum([
  'RESOLVED_ON_SITE',
  'PENDING_PARTS',
  'PENDING_OEM_ESCALATION',
  'ABORTED_SCHOOL_CLOSED',
  'UNABLE_TO_REPRODUCE',
  'RETURN_VISIT_REQUIRED',
]);

/** Schema for creating a field visit against an active service case */
export const createFieldVisitSchema = z.object({
  serviceCaseId: z.string().uuid({ message: 'serviceCaseId must be a valid UUIDv7' }),
  engineerId: z.string().uuid({ message: 'engineerId must be a valid UUIDv7' }).optional(),
  visitDate: z.string().optional(),
  targetNextVisitDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  clientOperationId: z.string().uuid().optional(),
  clientBaseVersion: z.string().optional(),
});

export type CreateFieldVisitDto = z.infer<typeof createFieldVisitSchema>;

/** Schema for GPS Check-In */
export const checkInFieldVisitSchema = z.object({
  latitude: z
    .number()
    .min(-90, 'Latitude must be >= -90')
    .max(90, 'Latitude must be <= 90'),
  longitude: z
    .number()
    .min(-180, 'Longitude must be >= -180')
    .max(180, 'Longitude must be <= 180'),
  accuracyMeters: z
    .number()
    .positive('Accuracy must be a positive number')
    .max(50, 'GPS accuracy must be <= 50m to qualify as physical on-site evidence'),
  capturedAt: z.string().datetime({ message: 'capturedAt must be a valid ISO-8601 timestamp' }),
  distanceMeters: z.number().nonnegative().optional(),
  withinGeofence: z.boolean().optional(),
  equipmentConditionObserved: z.string().max(255).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  clientOperationId: z.string().uuid().optional(),
  clientBaseVersion: z.string().optional(),
});

export type CheckInFieldVisitDto = z.infer<typeof checkInFieldVisitSchema>;

/** Schema for Transitioning to IN_PROGRESS */
export const startWorkFieldVisitSchema = z.object({
  onSiteDiagnosis: z.string().max(4000).optional().nullable(),
  equipmentConditionObserved: z.string().max(255).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  clientOperationId: z.string().uuid().optional(),
  clientBaseVersion: z.string().optional(),
});

export type StartWorkFieldVisitDto = z.infer<typeof startWorkFieldVisitSchema>;

/** Schema for GPS Check-Out with Structured Outcome */
export const checkOutFieldVisitSchema = z
  .object({
    visitOutcome: visitOutcomeEnum,
    workPerformed: z.string().max(4000).optional().nullable(),
    onSiteDiagnosis: z.string().max(4000).optional().nullable(),
    equipmentConditionObserved: z.string().max(255).optional().nullable(),
    pendingReasonText: z.string().max(2000).optional().nullable(),
    targetNextVisitDate: z.string().optional().nullable(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    accuracyMeters: z.number().positive().optional().nullable(),
    capturedAt: z.string().datetime().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    clientOperationId: z.string().uuid().optional(),
    clientBaseVersion: z.string().optional(),
  })
  .refine(
    (data) => {
      const requiresPendingReason =
        data.visitOutcome === 'PENDING_PARTS' ||
        data.visitOutcome === 'PENDING_OEM_ESCALATION' ||
        data.visitOutcome === 'RETURN_VISIT_REQUIRED';
      if (requiresPendingReason && (!data.pendingReasonText || data.pendingReasonText.trim().length === 0)) {
        return false;
      }
      return true;
    },
    {
      message: 'pendingReasonText is required when visitOutcome indicates pending follow-up or escalation',
      path: ['pendingReasonText'],
    },
  );

export type CheckOutFieldVisitDto = z.infer<typeof checkOutFieldVisitSchema>;

/** Schema for Querying Visits */
export const queryFieldVisitsSchema = z.object({
  serviceCaseId: z.string().uuid().optional(),
  engineerId: z.string().uuid().optional(),
  status: visitStatusEnum.optional(),
  outcome: visitOutcomeEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type QueryFieldVisitsDto = z.infer<typeof queryFieldVisitsSchema>;

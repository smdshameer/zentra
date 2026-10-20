/**
 * ZENTRA — Service Cases, Dispatch, and SLA API Contracts
 * packages/contracts/src/service-cases/service-cases.contract.ts
 */

import { z } from 'zod';

export const operationalStatusEnum = z.enum([
  'REGISTERED',
  'ASSIGNED',
  'IN_TRANSIT',
  'VISIT_STARTED',
  'IN_PROGRESS',
  'PENDING_PARTS',
  'ESCALATED_OEM',
  'RESOLVED',
  'VERIFIED',
  'CLOSED',
]);

export const verificationStatusEnum = z.enum([
  'PENDING_REVIEW',
  'VERIFIED_BY_COORDINATOR',
  'REJECTED_NEEDS_REVISIT',
]);

export const slaBreachStatusEnum = z.enum([
  'WITHIN_SLA',
  'APPROACHING_BREACH',
  'BREACHED',
  'MET',
]);

export const casePriorityEnum = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

export const assignmentRoleEnum = z.enum(['PRIMARY', 'SECONDARY']);

/** Schema for creating a service case from an approved source complaint */
export const createServiceCaseSchema = z.object({
  sourceComplaintId: z.string().uuid({ message: 'sourceComplaintId must be a valid UUIDv7' }),
  labId: z.string().uuid({ message: 'labId must be a valid UUIDv7' }).optional(),
  labEquipmentId: z.string().uuid({ message: 'labEquipmentId must be a valid UUIDv7' }).optional().nullable(),
  internalPriority: casePriorityEnum.optional(),
  initialEngineerId: z.string().uuid({ message: 'initialEngineerId must be a valid UUIDv7' }).optional(),
});

export type CreateServiceCaseDto = z.infer<typeof createServiceCaseSchema>;

/** Schema for engineer dispatch / assignment */
export const assignEngineerSchema = z
  .object({
    engineerId: z.string().uuid({ message: 'engineerId must be a valid UUIDv7' }),
    assignmentRole: assignmentRoleEnum.default('PRIMARY'),
    reassignmentReason: z.string().max(1000).optional().nullable(),
    isEmergencyCrossDistrict: z.boolean().default(false),
    emergencyJustification: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.isEmergencyCrossDistrict) {
        return (
          typeof data.emergencyJustification === 'string' &&
          data.emergencyJustification.trim().length >= 10
        );
      }
      return true;
    },
    {
      message: 'emergencyJustification is required (minimum 10 characters for technical safety; policy threshold REQUIRES CLARIFICATION) when isEmergencyCrossDistrict is true',
      path: ['emergencyJustification'],
    },
  );

export type AssignEngineerDto = z.infer<typeof assignEngineerSchema>;

/** Schema for querying eligible field engineers */
export const eligibleEngineersQuerySchema = z.object({
  districtId: z.string().uuid({ message: 'districtId must be a valid UUID' }),
  blockId: z.string().uuid({ message: 'blockId must be a valid UUID' }).optional(),
  capacityThreshold: z.coerce.number().int().min(1).max(100).optional(),
});

export type EligibleEngineersQueryDto = z.infer<typeof eligibleEngineersQuerySchema>;

/** Schema for state machine transitions */
export const transitionServiceCaseSchema = z.object({
  targetStatus: operationalStatusEnum,
  reason: z.string().max(1000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  actualDiagnosisSummary: z.string().max(2000).optional().nullable(),
  actualActionTakenSummary: z.string().max(2000).optional().nullable(),
  rejectionReason: z.string().max(1000).optional().nullable(),
});

export type TransitionServiceCaseDto = z.infer<typeof transitionServiceCaseSchema>;

/** Schema for querying and filtering service cases */
export const serviceCaseQuerySchema = z.object({
  districtId: z.string().uuid().optional(),
  blockId: z.string().uuid().optional(),
  schoolId: z.string().uuid().optional(),
  labId: z.string().uuid().optional(),
  operationalStatus: z.string().optional(),
  internalPriority: z.string().optional(),
  assignedEngineerId: z.string().uuid().optional(),
  slaBreachStatus: z.string().optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ServiceCaseQueryDto = z.infer<typeof serviceCaseQuerySchema>;

/** Schema for creating an SLA policy */
export const createSlaPolicySchema = z.object({
  policyName: z.string().min(3).max(100),
  priorityLevel: casePriorityEnum,
  targetResolutionHours: z.number().int().min(1).max(720),
  warningThresholdPercentage: z.number().int().min(1).max(99).default(75),
});

export type CreateSlaPolicyDto = z.infer<typeof createSlaPolicySchema>;

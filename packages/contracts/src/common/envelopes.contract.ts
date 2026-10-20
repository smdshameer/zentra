/**
 * ZENTRA — Standard Request/Response API Envelopes
 * packages/contracts/src/common/envelopes.contract.ts
 */

import { z } from 'zod';
import { errorCategorySchema } from '@zentra/validation';
import type {
  PaginationMeta,
  PaginationQuery,
  ApiErrorDetail,
  ApiErrorEnvelope,
  ServiceHealthResponse,
} from '@zentra/types';

/** Standard Pagination Metadata Schema */
export const paginationMetaSchema: z.ZodType<PaginationMeta> = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
  cursor: z.string().optional(),
});

/** Standard Pagination Query Schema */
export const paginationQuerySchema: z.ZodType<PaginationQuery> = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

/** Error Detail Schema */
export const apiErrorDetailSchema: z.ZodType<ApiErrorDetail> = z.object({
  field: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
});

/** Canonical API Error Envelope Schema */
export const apiErrorEnvelopeSchema: z.ZodType<ApiErrorEnvelope> = z.object({
  success: z.literal(false),
  error: z.object({
    category: errorCategorySchema,
    code: z.string(),
    message: z.string(),
    details: z.array(apiErrorDetailSchema).optional(),
    isRetryable: z.boolean(),
  }),
  correlationId: z.string(),
  timestamp: z.string(),
});

/** Factory function to create typed success envelopes */
export function createSuccessEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: paginationMetaSchema.optional(),
    correlationId: z.string(),
    timestamp: z.string(),
  });
}

/** Health Response Schema */
export const serviceHealthResponseSchema: z.ZodType<ServiceHealthResponse> = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  uptime: z.number(),
  timestamp: z.string(),
  version: z.string(),
  environment: z.enum(['local', 'test', 'development', 'staging', 'production']),
  services: z
    .record(
      z.object({
        status: z.enum(['ok', 'degraded', 'down']),
        message: z.string().optional(),
      }),
    )
    .optional(),
});

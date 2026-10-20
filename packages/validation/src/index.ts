/**
 * ZENTRA — Base Validation Primitives and Schemas
 * packages/validation
 */

import { z } from 'zod';
import type { ErrorCategory } from '@zentra/types';

/** Standard UUIDv7 Regex (version 7 marker in 3rd segment) */
export const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** General UUID Regex fallback */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** ISO 8601 UTC String Regex */
export const ISO_DATE_TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** 11-Digit Indian UDISE School Code Regex */
export const UDISE_CODE_REGEX = /^\d{11}$/;

/** Standard Indian 10-Digit Mobile Number Regex */
export const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

/** UUIDv7 Validation Schema */
export const uuidv7Schema = z
  .string()
  .regex(UUID_REGEX, { message: 'Must be a valid UUID string' });

/** ISO 8601 UTC Date-Time Schema */
export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: false, message: 'Must be an ISO 8601 UTC date-time string ending with Z' });

/** Standard Pagination Query Schema */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

/** Standard Error Category Schema */
export const errorCategorySchema = z.enum([
  'VALIDATION_ERROR',
  'AUTHENTICATION_ERROR',
  'AUTHORIZATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'DEPENDENCY_FAILURE',
  'OFFLINE_SYNC_REJECTED',
]) as z.ZodType<ErrorCategory>;

/**
 * Sanitizes an input string: trims and strips control/null characters
 */
export function sanitizeString(input: string): string {
  return input.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Masks a 10-digit phone number for safe logging (e.g., 989****355)
 */
export function maskPhoneNumber(phone?: string | null): string {
  if (!phone || phone.length < 6) return '***';
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}

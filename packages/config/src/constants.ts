/**
 * ZENTRA — Immutable System Architecture Constants
 * packages/config/src/constants.ts
 *
 * NOTE: These are technical constants only. Business domain rules
 * (SLA hours, conveyance rates, geofence radius) belong to future
 * database configuration tables, NEVER hardcoded here.
 */

export const SYSTEM_CONSTANTS = {
  APP_NAME: 'ZENTRA',
  DEFAULT_API_PORT: 4000,
  DEFAULT_API_HOST: '0.0.0.0',
  DEFAULT_API_PREFIX: '/api/v1',
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  TIME_STANDARD: 'UTC',
  DISPLAY_TIMEZONE: 'Asia/Kolkata', // IST (+05:30) for UI display
  SUPPORTED_EVIDENCE_MIME_TYPES: ['image/jpeg', 'image/png', 'application/pdf'] as const,
  MAX_EVIDENCE_FILE_SIZE_BYTES: 15 * 1024 * 1024, // 15MB ceiling
  PRESIGNED_URL_EXPIRATION_SECONDS: 300, // 5 minutes
} as const;

/**
 * ZENTRA — Validated Environment Variable Schema
 * packages/config/src/env.schema.ts
 */

import { z } from 'zod';
import type { AppEnvironment } from '@zentra/types';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z
      .enum(['local', 'test', 'development', 'staging', 'production'])
      .default('local') as z.ZodType<AppEnvironment>,

    // Server
    API_PORT: z.coerce.number().int().positive().default(4000),
    API_HOST: z.string().default('0.0.0.0'),
    API_PREFIX: z.string().default('/api/v1'),
    CORS_ORIGIN: z.string().default('*'),

    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL cannot be empty')
      .default('postgresql://zentra_dev:zentra_dev_pass@localhost:5432/zentra_local'),
    DATABASE_POOL_MIN: z.coerce.number().int().min(1).default(2),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

    // Test Database (Optional in non-test envs)
    TEST_DATABASE_URL: z.string().optional(),

    // Object Storage (MinIO / S3)
    S3_ENDPOINT: z.string().default('http://localhost:9000'),
    S3_REGION: z.string().default('ap-south-1'),
    S3_BUCKET_NAME: z.string().default('zentra-local-evidence'),
    S3_ACCESS_KEY: z.string().default('minioadmin'),
    S3_SECRET_KEY: z.string().default('minioadmin'),
    S3_FORCE_PATH_STYLE: z
      .string()
      .transform((val) => val === 'true')
      .default('true'),

    // Background Queue
    PG_BOSS_WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),

    // API Rate Limiting (Provisional & Configurable)
    RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().min(1).default(1000),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(15),
    RATE_LIMIT_TIME_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),

    // Authentication Secrets
    JWT_ACCESS_SECRET: z
      .string()
      .min(16, 'JWT_ACCESS_SECRET must be at least 16 chars long')
      .default('dev_mock_jwt_access_secret_16chars_min!'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(16, 'JWT_REFRESH_SECRET must be at least 16 chars long')
      .default('dev_mock_jwt_refresh_secret_16chars_min!'),
    OFFLINE_PERMIT_SIGNING_KEY: z.string().default('dev_mock_offline_permit_key_16chars!'),

    // Observability
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    PRETTY_LOGGING: z
      .string()
      .transform((val) => val === 'true')
      .default('false'),
  })
  .superRefine((data, ctx) => {
    // FAIL-CLOSED STAGING & PRODUCTION GATE
    if (data.APP_ENV === 'production' || data.APP_ENV === 'staging') {
      if (
        data.JWT_ACCESS_SECRET.includes('mock') ||
        data.JWT_ACCESS_SECRET.includes('dev') ||
        data.JWT_ACCESS_SECRET.length < 32
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: `CRITICAL: ${data.APP_ENV} JWT_ACCESS_SECRET must be at least 32 characters and cannot use default/dev strings.`,
        });
      }

      if (
        data.JWT_REFRESH_SECRET.includes('mock') ||
        data.JWT_REFRESH_SECRET.includes('dev') ||
        data.JWT_REFRESH_SECRET.length < 32
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: `CRITICAL: ${data.APP_ENV} JWT_REFRESH_SECRET must be at least 32 characters and cannot use default/dev strings.`,
        });
      }

      if (
        data.OFFLINE_PERMIT_SIGNING_KEY.includes('mock') ||
        data.OFFLINE_PERMIT_SIGNING_KEY.includes('dev') ||
        data.OFFLINE_PERMIT_SIGNING_KEY.length < 32
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OFFLINE_PERMIT_SIGNING_KEY'],
          message: `CRITICAL: ${data.APP_ENV} OFFLINE_PERMIT_SIGNING_KEY must be at least 32 characters and cannot use default/dev strings.`,
        });
      }

      if (data.DATABASE_URL.includes('localhost') || data.DATABASE_URL.includes('zentra_dev')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: `CRITICAL: ${data.APP_ENV} DATABASE_URL cannot point to localhost or dev databases.`,
        });
      }

      if (
        data.S3_BUCKET_NAME === 'zentra-local-evidence' ||
        data.S3_BUCKET_NAME.includes('dev') ||
        data.S3_BUCKET_NAME.includes('local')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['S3_BUCKET_NAME'],
          message: `CRITICAL: ${data.APP_ENV} S3_BUCKET_NAME cannot use default local or dev bucket names.`,
        });
      }
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

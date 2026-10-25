/**
 * ZENTRA — Step 2B Pre-Deployment Application Security Hardening Test Suite
 * apps/api/test/security-hardening-step2b.spec.ts
 *
 * Verifies the 4 production hardening objectives:
 * 1. Fastify Helmet: protective HTTP headers emitted
 * 2. Fastify Rate Limiting: auth brute-force protection, configurable limits, headers, and non-blocking general traffic
 * 3. Database Readiness Probe: real SELECT 1 ping, HTTP 503 on failure, DB-independent liveness, safe error response
 * 4. S3 Fail-Closed Behavior: 7 configuration/adapter-level tests proving fail-closed in staging/production
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { HealthService } from '../src/modules/health/health.service';
import { ObjectStorageService } from '../src/modules/evidence/services/object-storage.service';
import {
  assertTestEnvironmentIsSafe,
  assertDisposableTestDatabaseUrl,
  DISPOSABLE_INTEGRATION_TEST_DATABASE,
} from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  `postgresql://postgres:postgres@localhost:5432/${DISPOSABLE_INTEGRATION_TEST_DATABASE}`;

describe('ZENTRA Step 2B: Application Security Hardening Verification Suite', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    assertTestEnvironmentIsSafe();
    assertDisposableTestDatabaseUrl(TEST_DB_URL);
  });

  afterEach(() => {
    // Restore environment variables
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
  });

  // =========================================================================
  // HARDENING 1: FASTIFY HELMET SECURITY HEADERS
  // =========================================================================
  describe('Hardening 1: Fastify Helmet Security Headers', () => {
    it('emits standard protective security headers on HTTP responses', async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await configureApp(app);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health/liveness',
      });

      expect(response.statusCode).toBe(200);

      // Verify essential Helmet protective headers
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-dns-prefetch-control']).toBe('off');
      expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');

      await app.close();
    });
  });

  // =========================================================================
  // HARDENING 2: API RATE LIMITING
  // =========================================================================
  describe('Hardening 2: Fastify API Rate Limiting', () => {
    it('allows requests below the threshold and includes standard rate-limit headers', async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await configureApp(app, {
        RATE_LIMIT_GLOBAL_MAX: 100,
        RATE_LIMIT_AUTH_MAX: 10,
        RATE_LIMIT_TIME_WINDOW_MS: 60000,
      });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'test.user@zentra.test',
          password: 'TestPassword123!',
        },
      });

      // Status should be 401 or 400 (auth failure or validation), NOT 429
      expect(response.statusCode).not.toBe(429);
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();

      await app.close();
    });

    it('throttles requests that exceed the auth rate-limit threshold with HTTP 429', async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      // Set low threshold of 2 for rapid testing
      await configureApp(app, {
        RATE_LIMIT_AUTH_MAX: 2,
        RATE_LIMIT_GLOBAL_MAX: 100,
        RATE_LIMIT_TIME_WINDOW_MS: 60000,
      });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      // Request 1
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'test1@zentra.test', password: 'wrong' },
      });
      expect(res1.statusCode).not.toBe(429);

      // Request 2
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'test2@zentra.test', password: 'wrong' },
      });
      expect(res2.statusCode).not.toBe(429);

      // Request 3: Exceeds auth limit of 2 -> 429 Too Many Requests
      const res3 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'test3@zentra.test', password: 'wrong' },
      });

      expect(res3.statusCode).toBe(429);
      const body = JSON.parse(res3.payload);
      expect(body.success).toBe(false);
      expect(body.error.category).toBe('RATE_LIMITED');
      expect(body.error.code).toBe('ERR_RATE_LIMIT_EXCEEDED');
      expect(body.error.isRetryable).toBe(true);
      expect(res3.headers['retry-after']).toBeDefined();

      await app.close();
    });

    it('does not unintentionally throttle general API endpoints while auth is throttled', async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await configureApp(app, {
        RATE_LIMIT_AUTH_MAX: 2,
        RATE_LIMIT_GLOBAL_MAX: 100,
        RATE_LIMIT_TIME_WINDOW_MS: 60000,
      });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      // Exhaust auth quota
      await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} });
      await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} });
      const authThrottled = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {},
      });
      expect(authThrottled.statusCode).toBe(429);

      // General endpoint (health liveness) should continue succeeding under higher global limit
      const livenessRes = await app.inject({
        method: 'GET',
        url: '/api/v1/health/liveness',
      });
      expect(livenessRes.statusCode).toBe(200);

      await app.close();
    });
  });

  // =========================================================================
  // HARDENING 3: DATABASE READINESS PROBE
  // =========================================================================
  describe('Hardening 3: Database Readiness Probe', () => {
    it('returns HTTP 200 with database: ok when database pool is healthy', async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      const response = await app.inject({
        method: 'GET',
        url: '/health/readiness',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('ok');
      expect(body.data.services.database.status).toBe('ok');
      expect(body.data.services.api_event_loop.status).toBe('ok');

      await app.close();
    });

    it('returns HTTP 503 Service Unavailable when database connection fails', async () => {
      // Mock HealthService to simulate database failure
      const mockHealthService = {
        checkDatabaseHealth: async () => ({ isHealthy: false }),
      };

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(HealthService)
        .useValue(mockHealthService)
        .compile();

      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      const response = await app.inject({
        method: 'GET',
        url: '/health/readiness',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.category).toBe('DEPENDENCY_FAILURE');
      expect(body.error.code).toBe('ERR_DATABASE_UNAVAILABLE');
      expect(body.error.isRetryable).toBe(true);

      // Verify no sensitive database credentials or SQL connection strings leaked
      expect(response.payload).not.toContain('password');
      expect(response.payload).not.toContain('localhost:5432');
      expect(response.payload).not.toContain('postgres');

      await app.close();
    });

    it('maintains DB-independent liveness HTTP 200 even when database is unavailable', async () => {
      const mockHealthService = {
        checkDatabaseHealth: async () => ({ isHealthy: false }),
      };

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(HealthService)
        .useValue(mockHealthService)
        .compile();

      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      // Readiness fails (503)
      const readinessRes = await app.inject({ method: 'GET', url: '/health/readiness' });
      expect(readinessRes.statusCode).toBe(503);

      // Liveness succeeds (200)
      const livenessRes = await app.inject({ method: 'GET', url: '/health/liveness' });
      expect(livenessRes.statusCode).toBe(200);
      const body = JSON.parse(livenessRes.payload);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('ok');

      await app.close();
    });
  });

  // =========================================================================
  // HARDENING 4: S3 FAIL-CLOSED BEHAVIOR
  // =========================================================================
  describe('Hardening 4: S3 Fail-Closed Behavior (7 Required Tests)', () => {
    it('TEST 1: APP_ENV=staging + valid real S3 configuration -> S3 adapter initializes without testStorage', () => {
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      process.env.S3_BUCKET_NAME = 'zentra-staging-evidence';
      process.env.S3_REGION = 'ap-south-1';
      process.env.S3_ACCESS_KEY = 'AKIA_VALID_STAGING_KEY';
      process.env.S3_SECRET_KEY = 'SEC_VALID_STAGING_KEY_HEX_32CHARS';

      const storage = new ObjectStorageService();
      expect(storage).toBeDefined();
      expect(storage.getBucketName()).toBe('zentra-staging-evidence');
      expect(storage.hasTestStorage()).toBe(false);
    });

    it('TEST 2: APP_ENV=staging + missing S3 configuration -> initialization fails closed', () => {
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      delete process.env.S3_BUCKET_NAME;
      delete process.env.AWS_S3_BUCKET;
      delete process.env.S3_ACCESS_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.S3_SECRET_KEY;
      delete process.env.AWS_SECRET_ACCESS_KEY;

      expect(() => new ObjectStorageService()).toThrow(/S3_FAIL_CLOSED_ERROR/);
    });

    it('TEST 3: APP_ENV=production + missing S3 configuration -> initialization fails closed', () => {
      process.env.APP_ENV = 'production';
      process.env.NODE_ENV = 'production';
      delete process.env.S3_BUCKET_NAME;
      delete process.env.AWS_S3_BUCKET;
      delete process.env.S3_ACCESS_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.S3_SECRET_KEY;
      delete process.env.AWS_SECRET_ACCESS_KEY;

      expect(() => new ObjectStorageService()).toThrow(/S3_FAIL_CLOSED_ERROR/);
    });

    it('TEST 4: APP_ENV=test + test storage enabled -> existing tests continue working deterministically', async () => {
      process.env.APP_ENV = 'test';
      process.env.NODE_ENV = 'test';

      const storage = new ObjectStorageService();
      expect(storage.hasTestStorage()).toBe(true);

      const buffer = Buffer.from('test binary content');
      const metadata = await storage.putObject('evidence/test/sample.jpg', buffer, 'image/jpeg');
      expect(metadata.objectKey).toBe('evidence/test/sample.jpg');
      expect(metadata.contentLength).toBe(buffer.length);

      const readBack = await storage.headObject('evidence/test/sample.jpg');
      expect(readBack).not.toBeNull();
      expect(readBack?.checksumSha256).toBe(metadata.checksumSha256);
    });

    it('TEST 5: staging/production cannot instantiate or use testStorage Map', async () => {
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      process.env.S3_BUCKET_NAME = 'zentra-staging-evidence';
      process.env.S3_REGION = 'ap-south-1';
      process.env.S3_ACCESS_KEY = 'AKIA_VALID_STAGING_KEY';
      process.env.S3_SECRET_KEY = 'SEC_VALID_STAGING_KEY_HEX_32CHARS';

      const storage = new ObjectStorageService();
      expect(storage.hasTestStorage()).toBe(false);

      // putObject must strictly reject in staging
      await expect(
        storage.putObject('evidence/staging/test.jpg', Buffer.from('data')),
      ).rejects.toThrow(
        /S3_FAIL_CLOSED_ERROR: Direct in-memory putObject\/testStorage is strictly prohibited/,
      );
    });

    it('TEST 6: staging/production cannot use mock HMAC signing (must use SigV4 query auth)', async () => {
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      process.env.S3_BUCKET_NAME = 'zentra-staging-evidence';
      process.env.S3_REGION = 'ap-south-1';
      process.env.S3_ACCESS_KEY = 'AKIA_VALID_STAGING_KEY';
      process.env.S3_SECRET_KEY = 'SEC_VALID_STAGING_KEY_HEX_32CHARS';

      const storage = new ObjectStorageService();
      const presigned = await storage.generatePresignedUploadUrl({
        environment: 'staging',
        serviceCaseId: '01912345-0000-7000-8000-000000000001',
        visitId: '01912345-0000-7000-8000-000000000002',
        evidenceId: '01912345-0000-7000-8000-000000000003',
        filename: 'inspection.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1024,
        expectedChecksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      });

      // Must generate standard AWS SigV4 query parameters
      expect(presigned.presignedUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(presigned.presignedUrl).toContain('X-Amz-Credential=');
      expect(presigned.presignedUrl).toContain('X-Amz-Signature=');
      expect(presigned.presignedUrl).toContain('X-Amz-SignedHeaders=host');
      // Must not contain mock session identifier
      expect(presigned.presignedUrl).not.toContain('uploadSessionId=');
    });

    it('TEST 7: No fake presigned URL is generated when real S3 is unavailable in staging', () => {
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      delete process.env.S3_ACCESS_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.S3_SECRET_KEY;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      process.env.S3_BUCKET_NAME = 'zentra-staging-evidence';

      // ObjectStorageService fails on initialization; cannot generate fake URLs
      expect(() => new ObjectStorageService()).toThrow(/S3_FAIL_CLOSED_ERROR/);
    });
  });
});

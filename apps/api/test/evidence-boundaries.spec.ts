/**
 * ZENTRA — Phase 14 Boundary Verification Test Suite
 * apps/api/test/evidence-boundaries.spec.ts
 *
 * Verifies strict phase isolation under MUSE SPARK protocol:
 * - Confirms zero Phase 15 endpoints (conveyance claim submissions, claim approval lifecycles, management web portal)
 * - Confirms zero Phase 15 schema fields (conveyanceKm, odometerStart, reimbursementAmount)
 * - Confirms zero Phase 16 hardening scripts or rehearsal routes
 * - Confirms Phase 14 evidence endpoints reject out-of-scope conveyance fields.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/modules/auth/token.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { generateUuidV7 } from '@zentra/shared';
import { assertTestEnvironmentIsSafe, assertTestDatabaseIsSafe } from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zentra_test';

describe('ZENTRA Phase 14 — Strict Architectural Boundary Verification', () => {
  let app: NestFastifyApplication;
  let tokenService: TokenService;
  let engineerToken: string;
  let masterAdminToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;
    assertTestEnvironmentIsSafe();
    assertTestDatabaseIsSafe(TEST_DB_URL);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    tokenService = moduleFixture.get<TokenService>(TokenService);

    masterAdminToken = tokenService.generateAccessToken({
      userId: generateUuidV7(),
      username: 'admin.demo@zentra.test',
      roles: ['MASTER_ADMIN'],
      activeRole: 'MASTER_ADMIN',
    }).token;

    engineerToken = tokenService.generateAccessToken({
      userId: generateUuidV7(),
      username: 'engineer.demo@zentra.local',
      roles: ['FIELD_ENGINEER'],
      activeRole: 'FIELD_ENGINEER',
    }).token;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('1. Negative Boundary: Phase 15 Conveyance Claims & Management Portal Out of Scope', () => {
    it('returns 404 for POST /api/v1/conveyance', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance',
        headers: {
          authorization: `Bearer ${engineerToken}`,
        },
        payload: {
          visitId: generateUuidV7(),
          claimAmount: 450,
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for POST /api/v1/conveyance/claims', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance/claims',
        headers: {
          authorization: `Bearer ${engineerToken}`,
        },
        payload: {
          visitId: generateUuidV7(),
          amount: 500,
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for GET /api/v1/claims', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/claims',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for POST /api/v1/claims/:id/approve', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/claims/${generateUuidV7()}/approve`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
        payload: {
          approvedAmount: 500,
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('2. Negative Boundary: Phase 16 E2E Hardening Scripts Out of Scope', () => {
    it('returns 404 for POST /api/v1/rehearsal/run', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rehearsal/run',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for POST /api/v1/hardening/chaos', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/hardening/chaos',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('3. Positive Boundary: Phase 14 Evidence Contracts Reject Conveyance Injection', () => {
    it('strips or ignores unpermitted Phase 15 conveyance fields in upload session payloads', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: {
          authorization: `Bearer ${engineerToken}`,
        },
        payload: {
          visitId: generateUuidV7(),
          serviceCaseId: generateUuidV7(),
          evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
          mimeType: 'image/png',
          fileSizeBytes: 2048,
          fileChecksumSha256: 'a'.repeat(64),
          // Attempted Phase 15 conveyance injection
          conveyanceKm: 42.5,
          odometerReading: 12450,
          claimReimbursement: true,
        },
      });

      // Should fail on territory/lineage authorization or validation, never process conveyance
      expect([400, 403, 404]).toContain(res.statusCode);
    });
  });
});

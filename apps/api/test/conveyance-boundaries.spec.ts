/**
 * ZENTRA — Phase 15 Boundary Verification Test Suite
 * apps/api/test/conveyance-boundaries.spec.ts
 *
 * Verifies strict phase isolation under MUSE SPARK protocol:
 * - Confirms zero Phase 16 endpoints (rehearsal runners, chaos injectors, production hardening)
 * - Confirms zero external payment gateway webhooks or direct banking integrations
 * - Confirms canonical Phase 15 routes are exclusively mounted under /api/v1/conveyance-claims
 * - Confirms legacy / alternative routes remain 404 (preserving Phase 13/14 boundary guarantees)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/modules/auth/token.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { generateUuidV7 } from '@zentra/shared';
import {
  assertTestEnvironmentIsSafe,
  assertDisposableTestDatabaseUrl,
  DISPOSABLE_INTEGRATION_TEST_DATABASE,
} from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  `postgresql://postgres:postgres@localhost:5432/${DISPOSABLE_INTEGRATION_TEST_DATABASE}`;

describe('ZENTRA Phase 15 — Strict Architectural Boundary Verification', () => {
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
    assertDisposableTestDatabaseUrl(TEST_DB_URL);

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

  describe('1. Negative Boundary: Phase 16 Rehearsal & Production Hardening Out of Scope', () => {
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

    it('returns 404 for POST /api/v1/rehearsal/simulate', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rehearsal/simulate',
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

    it('returns 404 for POST /api/v1/hardening/simulate-outage', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/hardening/simulate-outage',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('2. Negative Boundary: External Payment Gateways & Banking Integrations Out of Scope', () => {
    it('returns 404 for POST /api/v1/payment-gateway/webhook', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/payment-gateway/webhook',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for POST /api/v1/bank-transfer/disburse', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/bank-transfer/disburse',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('3. Positive Boundary: Canonical Route Preservation & Namespace Scoping', () => {
    it('returns 404 for unmounted /api/v1/conveyance (preserving Phase 13 boundary spec)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance',
        headers: {
          authorization: `Bearer ${engineerToken}`,
        },
        payload: {
          visitId: generateUuidV7(),
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for unmounted /api/v1/conveyance/claims', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance/claims',
        headers: {
          authorization: `Bearer ${engineerToken}`,
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for unmounted /api/v1/claims', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/claims',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('confirms canonical Phase 15 routes are active under /api/v1/conveyance-claims', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/conveyance-claims/policies',
        headers: {
          authorization: `Bearer ${engineerToken}`,
        },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});

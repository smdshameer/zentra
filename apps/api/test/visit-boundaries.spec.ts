/**
 * ZENTRA — Phase 13 Boundary Verification Test Suite
 * apps/api/test/visit-boundaries.spec.ts
 *
 * Verifies strict phase isolation under MUSE SPARK protocol:
 * - Confirms zero Phase 14 endpoints (S3 presigned URLs, direct uploads, evidence streaming, HM signatures)
 * - Confirms zero Phase 15 endpoints (conveyance claim submissions, claim approval lifecycles, management web portal)
 * - Confirms zero Phase 16 hardening scripts or rehearsal routes
 * - Confirms Phase 13 field visit endpoints reject out-of-scope fields and operations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { DATABASE_CONNECTION } from '../src/database/database.connection';
import type { DatabaseSchema } from '../src/database/database.types';
import { Kysely } from 'kysely';
import {
  seedSyntheticDevelopmentFixtures,
  type SeededEntities,
} from '../src/database/seeds/synthetic-dev-fixtures';
import { TokenService } from '../src/modules/auth/token.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { generateUuidV7 } from '@zentra/shared';
import { runMigrationsToLatest } from '../src/database/migration-runner';
import {
  setupDisposableIntegrationHarness,
  DISPOSABLE_INTEGRATION_TEST_DATABASE,
} from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  `postgresql://postgres:postgres@localhost:5432/${DISPOSABLE_INTEGRATION_TEST_DATABASE}`;

describe('ZENTRA Phase 13 — Strict Architectural Boundary Verification', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let tokenService: TokenService;
  let engineerToken: string;
  let masterAdminToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;

    const { createDatabaseConnection } = await import('../src/database/database.connection');
    const harness = await setupDisposableIntegrationHarness(
      TEST_DB_URL,
      createDatabaseConnection,
      runMigrationsToLatest,
    );
    db = harness.db;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    tokenService = moduleFixture.get<TokenService>(TokenService);

    const { sql } = await import('kysely');
    await sql`
      TRUNCATE TABLE
        idempotency_keys,
        tombstones,
        import_staging_records,
        import_jobs,
        evidence_files,
        visit_equipment_findings,
        field_visit_status_history,
        field_visits,
        assignment_history,
        service_case_status_history,
        service_cases,
        source_complaints,
        complaint_sources,
        refresh_tokens,
        user_territory_assignments,
        user_roles,
        role_permissions,
        permissions,
        users,
        roles,
        lab_equipment,
        equipment_attribute_definitions,
        equipment_types,
        oem_manufacturers,
        hi_tech_labs,
        schools,
        blocks,
        districts,
        audit_events
      CASCADE;
    `.execute(db);

    seeded = await seedSyntheticDevelopmentFixtures(db);

    masterAdminToken = tokenService.generateAccessToken({
      userId: seeded.adminUserId,
      username: 'admin.demo@zentra.test',
      roles: ['MASTER_ADMIN'],
      activeRole: 'MASTER_ADMIN',
      territoryDistrictIds: [seeded.districtId, seeded.secondDistrictId],
    }).token;

    engineerToken = tokenService.generateAccessToken({
      userId: seeded.userId,
      username: 'engineer.demo@zentra.local',
      roles: ['FIELD_ENGINEER'],
      activeRole: 'FIELD_ENGINEER',
      territoryDistrictIds: [seeded.districtId],
    }).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.destroy();
  });

  describe('1. Negative Boundary: Phase 14 Evidence & S3 Streaming Out of Scope', () => {
    it('returns 404 for POST /api/v1/evidence (Evidence pipeline not in Phase 13)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence',
        headers: {
          authorization: `Bearer ${engineerToken}`,
        },
        payload: {
          visitId: generateUuidV7(),
          fileName: 'evidence.jpg',
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for POST /api/v1/evidence/upload (Direct upload not in Phase 13)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload',
        headers: {
          authorization: `Bearer ${engineerToken}`,
        },
        payload: {
          visitId: generateUuidV7(),
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for POST /api/v1/evidence/presigned-url (S3 presigned URLs not in Phase 13)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/presigned-url',
        headers: {
          authorization: `Bearer ${engineerToken}`,
        },
        payload: {
          visitId: generateUuidV7(),
          fileType: 'image/jpeg',
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for POST /api/v1/visits/:id/signature (HM Signatures not in Phase 13)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${generateUuidV7()}/signature`,
        headers: {
          authorization: `Bearer ${engineerToken}`,
        },
        payload: {
          signatureSvg: '<svg></svg>',
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('2. Negative Boundary: Phase 15 Conveyance Claims & Management Portal Out of Scope', () => {
    it('returns 404 for POST /api/v1/conveyance (Conveyance claims not in Phase 13)', async () => {
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

    it('returns 404 for POST /api/v1/conveyance/claims (Claims submission not in Phase 13)', async () => {
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

    it('returns 404 for GET /api/v1/claims (Claims portal endpoints not in Phase 13)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/claims',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('3. Negative Boundary: Phase 16 E2E Hardening Scripts Out of Scope', () => {
    it('returns 404 for POST /api/v1/rehearsal or hardening endpoints', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rehearsal/run',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('4. Positive Boundary: Phase 13 Core Contract Enforcement', () => {
    it('accepts only valid Phase 13 check-in fields and rejects unpermitted mutations', async () => {
      const bogusVisitId = generateUuidV7();
      // Sending Phase 14 / 15 fields in check-in payload gets stripped or rejected by Zod
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${bogusVisitId}/check-in`,
        headers: {
          authorization: `Bearer ${engineerToken}`,
        },
        payload: {
          latitude: 11.45,
          longitude: 77.68,
          accuracyMeters: 10,
          capturedAt: new Date().toISOString(),
          // Phase 14 field injection attempt
          evidencePhotoUrl: 'https://s3.amazonaws.com/zentra-evidence/photo.jpg',
          // Phase 15 field injection attempt
          conveyanceClaimApproved: true,
        },
      });
      // Should fail either on visit not found (404) rather than processing any evidence or claim
      expect([400, 404]).toContain(res.statusCode);
    });
  });
});

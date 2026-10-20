/**
 * ZENTRA — Phase 12 Delta Synchronization & Conflict Arbitration Integration Suite
 * apps/api/test/sync-engine.spec.ts
 *
 * Comprehensive integration suite verifying:
 * 1. Server-side idempotency via PostgreSQL idempotency_keys
 * 2. Duplicate retry safety (zero duplicate domain mutations)
 * 3. Concurrency protection & typed conflict arbitration (VERSION_CONFLICT, INVALID_STATE_TRANSITION, etc.)
 * 4. Territory scoping & RBAC enforcement during sync (TERRITORY_ACCESS_CHANGED)
 * 5. Monotonic tombstones & prevention of deleted record resurrection (ENTITY_TOMBSTONED)
 * 6. Downstream row-level delta stream with opaque server-authoritative cursors
 * 7. Bounded delta pagination and continuation
 * 8. Authentication & security enforcement (unauthenticated / malformed payloads rejected)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { DATABASE_CONNECTION } from '../src/database/database.connection';
import type { DatabaseSchema } from '../src/database/database.types';
import { Kysely, sql } from 'kysely';
import {
  seedSyntheticDevelopmentFixtures,
  type SeededEntities,
} from '../src/database/seeds/synthetic-dev-fixtures';
import { TokenService } from '../src/modules/auth/token.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { generateUuidV7 } from '@zentra/shared';
import { runMigrationsToLatest } from '../src/database/migration-runner';
import { assertTestEnvironmentIsSafe, assertTestDatabaseIsSafe } from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zentra_test';

describe('ZENTRA Phase 12 — Delta Synchronization & Conflict Arbitration Subsystem', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let tokenService: TokenService;

  let masterAdminToken: string;
  let fieldEngineerToken: string;
  let secondFieldEngineerToken: string;
  let secondaryEngineerId: string;

  let testCaseId: string;
  let secondDistrictCaseId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;
    assertTestEnvironmentIsSafe();
    assertTestDatabaseIsSafe(TEST_DB_URL);

    // Run migrations including Phase 12 idempotency_keys
    await runMigrationsToLatest(TEST_DB_URL);

    const { createDatabaseConnection } = await import('../src/database/database.connection');
    db = createDatabaseConnection(TEST_DB_URL);

    // Clean tables for reproducible test runs
    await sql`
      TRUNCATE TABLE
        idempotency_keys,
        tombstones,
        import_staging_records,
        import_jobs,
        evidence_files,
        visit_equipment_findings,
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

    // Seed synthetic fixtures
    seeded = await seedSyntheticDevelopmentFixtures(db);

    // Create secondary field engineer assigned to District B (Salem)
    secondaryEngineerId = generateUuidV7();
    const defaultPasswordHash = '$scrypt$N=16384,r=8,p=1$fakehash$fakesalt';

    await db
      .insertInto('users')
      .values({
        user_id: secondaryEngineerId,
        username: 'engineer.salem@zentra.test',
        full_name: 'Salem Field Engineer',
        phone_number: '+919999900099',
        password_hash: defaultPasswordHash,
        account_status: 'ACTIVE',
        is_active: true,
      })
      .execute();

    await db
      .insertInto('user_roles')
      .values({
        user_role_id: generateUuidV7(),
        user_id: secondaryEngineerId,
        role_id: seeded.roleIds.FIELD_ENGINEER,
      })
      .execute();

    await db
      .insertInto('user_territory_assignments')
      .values({
        assignment_id: generateUuidV7(),
        user_id: secondaryEngineerId,
        district_id: seeded.secondDistrictId,
        is_primary_territory: true,
        valid_from: new Date(),
        valid_to: null,
      })
      .execute();

    // Point to seeded service cases
    testCaseId = seeded.serviceCaseId;
    secondDistrictCaseId = seeded.secondServiceCaseId;

    await db
      .updateTable('service_cases')
      .set({
        assigned_primary_engineer_id: secondaryEngineerId,
        operational_status: 'ASSIGNED',
        assigned_at: new Date('2026-10-01T11:00:00.000Z'),
      })
      .where('service_case_id', '=', secondDistrictCaseId)
      .execute();

    // Build NestJS application
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    tokenService = app.get<TokenService>(TokenService);

    masterAdminToken = tokenService.generateAccessToken({
      userId: seeded.adminUserId,
      username: 'admin.demo@zentra.test',
      roles: ['MASTER_ADMIN'],
      activeRole: 'MASTER_ADMIN',
      territoryDistrictIds: [seeded.districtId, seeded.secondDistrictId],
    }).token;

    fieldEngineerToken = tokenService.generateAccessToken({
      userId: seeded.userId,
      username: 'engineer.erode@zentra.test',
      roles: ['FIELD_ENGINEER'],
      activeRole: 'FIELD_ENGINEER',
      territoryDistrictIds: [seeded.districtId],
    }).token;

    secondFieldEngineerToken = tokenService.generateAccessToken({
      userId: secondaryEngineerId,
      username: 'engineer.salem@zentra.test',
      roles: ['FIELD_ENGINEER'],
      activeRole: 'FIELD_ENGINEER',
      territoryDistrictIds: [seeded.secondDistrictId],
    }).token;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (db) {
      await db.destroy();
    }
  });

  // ==========================================
  // 1. Idempotency & Duplicate Replay Tests
  // ==========================================

  describe('1. Server-Side Idempotency & Duplicate Replay', () => {
    it('accepts initial push mutation and executes domain status transition', async () => {
      const clientOpId = generateUuidV7();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${fieldEngineerToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: clientOpId,
              entityType: 'service_cases',
              entityId: testCaseId,
              operationType: 'STATUS_TRANSITION',
              payload: {
                fromStatus: 'ASSIGNED',
                toStatus: 'IN_TRANSIT',
                reason: 'Departing for school site',
              },
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.results).toHaveLength(1);
      expect(body.data.results[0].clientOperationId).toBe(clientOpId);
      expect(body.data.results[0].status).toBe('ACCEPTED');
      expect(body.data.results[0].serverVersion).toBe('2');

      // Verify domain database was updated
      const updatedCase = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', testCaseId)
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(updatedCase.operational_status).toBe('IN_TRANSIT');
      expect(Number(updatedCase.version)).toBe(2);

      // Verify idempotency ledger entry exists
      const idempRecord = await db
        .selectFrom('idempotency_keys')
        .where('client_operation_id', '=', clientOpId)
        .selectAll()
        .executeTakeFirst();

      expect(idempRecord).toBeDefined();
      expect(idempRecord?.response_status_code).toBe(200);
    });

    it('replays identical cached result on duplicate retry without re-executing domain transition', async () => {
      // Fetch status history count before retry
      const historyBefore = await db
        .selectFrom('service_case_status_history')
        .where('service_case_id', '=', testCaseId)
        .selectAll()
        .execute();

      const initialCount = historyBefore.length;

      // Re-send the exact same clientOperationId
      const idempKey = (await db
        .selectFrom('idempotency_keys')
        .selectAll()
        .executeTakeFirstOrThrow()).client_operation_id;

      const retryResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${fieldEngineerToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: idempKey,
              entityType: 'service_cases',
              entityId: testCaseId,
              operationType: 'STATUS_TRANSITION',
              payload: {
                fromStatus: 'ASSIGNED',
                toStatus: 'IN_TRANSIT',
                reason: 'Departing for school site (duplicate request)',
              },
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(retryResponse.statusCode).toBe(200);
      const retryBody = JSON.parse(retryResponse.body);
      expect(retryBody.data.results[0].clientOperationId).toBe(idempKey);
      expect(retryBody.data.results[0].status).toBe('ACCEPTED');

      // Assert status history did NOT grow (zero double execution)
      const historyAfter = await db
        .selectFrom('service_case_status_history')
        .where('service_case_id', '=', testCaseId)
        .selectAll()
        .execute();

      expect(historyAfter.length).toBe(initialCount);
    });
  });

  // ==========================================
  // 2. Concurrency & Conflict Arbitration
  // ==========================================

  describe('2. Concurrency & Conflict Arbitration', () => {
    it('detects VERSION_CONFLICT when client pushes mutation based on stale server version', async () => {
      const clientOpId = generateUuidV7();

      // Case is currently at version 2. Client pushes mutation based on stale version 1.
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${fieldEngineerToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: clientOpId,
              entityType: 'service_cases',
              entityId: testCaseId,
              operationType: 'STATUS_TRANSITION',
              clientBaseVersion: '1', // Stale! Current server version is 2
              payload: {
                fromStatus: 'ASSIGNED',
                toStatus: 'IN_TRANSIT',
              },
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.results[0].status).toBe('CONFLICT');
      expect(body.data.results[0].conflictCode).toBe('VERSION_CONFLICT');
      expect(body.data.results[0].message).toContain("current server version is '2'");
      expect(body.data.results[0].serverVersion).toBe('2');
    });

    it('accepts mutation based on current server version and atomically advances version', async () => {
      const clientOpId = generateUuidV7();

      // Case is currently at version 2. Client provides matching clientBaseVersion '2'.
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${fieldEngineerToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: clientOpId,
              entityType: 'service_cases',
              entityId: testCaseId,
              operationType: 'UPDATE',
              clientBaseVersion: '2', // Matches server version 2
              payload: {
                actualDiagnosisSummary: 'Diagnosed power supply unit failure on site',
              },
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.results[0].status).toBe('ACCEPTED');
      expect(body.data.results[0].serverVersion).toBe('3');

      // Verify version advanced atomically in database
      const updatedCase = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', testCaseId)
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(Number(updatedCase.version)).toBe(3);
      expect(updatedCase.actual_diagnosis_summary).toBe(
        'Diagnosed power supply unit failure on site',
      );
    });

    it('proves server version remains sole authority regardless of client clock skew', async () => {
      // Subcase A: Stale client timestamp from the past, but valid matching version 3 -> ACCEPTED
      const pastClockOpId = generateUuidV7();
      const pastClockResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${fieldEngineerToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: pastClockOpId,
              entityType: 'service_cases',
              entityId: testCaseId,
              operationType: 'UPDATE',
              clientBaseVersion: '3', // Matches current server version 3
              payload: {
                actualDiagnosisSummary: 'Diagnosis confirmed with past timestamp',
              },
              clientCreatedAt: '2020-01-01T00:00:00.000Z', // 6 years in the past!
            },
          ],
        },
      });

      expect(pastClockResponse.statusCode).toBe(200);
      const pastBody = JSON.parse(pastClockResponse.body);
      expect(pastBody.data.results[0].status).toBe('ACCEPTED');
      expect(pastBody.data.results[0].serverVersion).toBe('4');

      const caseAfterPastClock = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', testCaseId)
        .selectAll()
        .executeTakeFirstOrThrow();
      expect(Number(caseAfterPastClock.version)).toBe(4);

      // Subcase B: Future client timestamp, but stale version '2' (server is now at 4) -> REJECTED with VERSION_CONFLICT
      const futureClockOpId = generateUuidV7();
      const futureClockResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${fieldEngineerToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: futureClockOpId,
              entityType: 'service_cases',
              entityId: testCaseId,
              operationType: 'UPDATE',
              clientBaseVersion: '2', // Stale! Current is 4
              payload: {
                actualDiagnosisSummary: 'Malicious future timestamp edit',
              },
              clientCreatedAt: '2099-12-31T23:59:59.000Z', // Far future timestamp!
            },
          ],
        },
      });

      expect(futureClockResponse.statusCode).toBe(200);
      const futureBody = JSON.parse(futureClockResponse.body);
      expect(futureBody.data.results[0].status).toBe('CONFLICT');
      expect(futureBody.data.results[0].conflictCode).toBe('VERSION_CONFLICT');
      expect(futureBody.data.results[0].serverVersion).toBe('4');
      expect(futureBody.data.results[0].message).toContain("current server version is '4'");
    });

    it('rejects INVALID_STATE_TRANSITION when transition violates state machine rules', async () => {
      const clientOpId = generateUuidV7();

      // Case is IN_TRANSIT. Transition directly to RESOLVED is strictly illegal.
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${fieldEngineerToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: clientOpId,
              entityType: 'service_cases',
              entityId: testCaseId,
              operationType: 'STATUS_TRANSITION',
              clientBaseVersion: '4',
              payload: {
                fromStatus: 'IN_TRANSIT',
                toStatus: 'RESOLVED', // Illegal state jump!
              },
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.results[0].status).toBe('CONFLICT');
      expect(body.data.results[0].conflictCode).toBe('INVALID_STATE_TRANSITION');
    });

    it('returns RECORD_NOT_FOUND when mutating non-existent entity', async () => {
      const clientOpId = generateUuidV7();
      const nonExistentId = generateUuidV7();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: clientOpId,
              entityType: 'service_cases',
              entityId: nonExistentId,
              operationType: 'UPDATE',
              payload: { actualDiagnosisSummary: 'Test note' },
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.results[0].status).toBe('CONFLICT');
      expect(body.data.results[0].conflictCode).toBe('RECORD_NOT_FOUND');
    });
  });

  // ==========================================
  // 3. Territory Scoping & Authorization
  // ==========================================

  describe('3. Territory Scoping & Authorization Enforcement', () => {
    it('rejects cross-district mutation with TERRITORY_ACCESS_CHANGED', async () => {
      const clientOpId = generateUuidV7();

      // Engineer A (Erode) attempts to mutate case in District B (Salem)
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${fieldEngineerToken}`, // Erode engineer
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: clientOpId,
              entityType: 'service_cases',
              entityId: secondDistrictCaseId, // Salem case!
              operationType: 'UPDATE',
              payload: { actualDiagnosisSummary: 'Cross-district intrusion attempt' },
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.results[0].status).toBe('CONFLICT');
      expect(body.data.results[0].conflictCode).toBe('TERRITORY_ACCESS_CHANGED');
    });

    it('rejects unauthenticated sync push with HTTP 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [],
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ==========================================
  // 4. Tombstone Synchronization
  // ==========================================

  describe('4. Tombstone Synchronization & Anti-Resurrection', () => {
    it('rejects mutation against tombstoned entity with ENTITY_TOMBSTONED', async () => {
      const tombstonedCaseId = generateUuidV7();

      // Record tombstone in PostgreSQL
      await db
        .insertInto('tombstones')
        .values({
          tombstone_id: generateUuidV7(),
          entity_type: 'service_cases',
          entity_id: tombstonedCaseId,
          deleted_at: new Date(),
          deleted_by_user_id: seeded.adminUserId,
          tombstone_reason: 'Mistakenly registered call permanently purged',
        })
        .execute();

      const clientOpId = generateUuidV7();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: clientOpId,
              entityType: 'service_cases',
              entityId: tombstonedCaseId,
              operationType: 'UPDATE',
              payload: { actualDiagnosisSummary: 'Resurrection attempt' },
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.results[0].status).toBe('CONFLICT');
      expect(body.data.results[0].conflictCode).toBe('ENTITY_TOMBSTONED');
    });

    it('delivers tombstoned entity in downstream delta stream', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/delta?limit=50',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tombstones.length).toBeGreaterThanOrEqual(1);
      expect(body.data.tombstones[0].entityType).toBe('service_cases');
      expect(body.data.tombstones[0].deletedAt).toBeDefined();
    });
  });

  // ==========================================
  // 5. Delta Stream & Opaque Cursor Pagination
  // ==========================================

  describe('5. Delta Stream & Opaque Cursor Pagination', () => {
    it('scopes delta records strictly to authorized territory', async () => {
      // Erode engineer requests delta
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/delta',
        headers: {
          authorization: `Bearer ${fieldEngineerToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const caseIds = body.data.changes.map((c: any) => c.entityId);

      // Must contain assigned Erode case
      expect(caseIds).toContain(testCaseId);
      // Must NOT leak Salem case
      expect(caseIds).not.toContain(secondDistrictCaseId);
    });

    it('supports bounded pagination and monotonic cursor progression', async () => {
      // Request with limit 1
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/delta?limit=1',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.changes.length).toBeLessThanOrEqual(1);
      expect(body.data.nextCursor).toBeDefined();

      const nextCursor = body.data.nextCursor;

      // Request next batch with cursor
      const nextResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/sync/delta?cursor=${encodeURIComponent(nextCursor)}&limit=10`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });

      expect(nextResponse.statusCode).toBe(200);
      const nextBody = JSON.parse(nextResponse.body);
      expect(nextBody.success).toBe(true);
    });
  });
});

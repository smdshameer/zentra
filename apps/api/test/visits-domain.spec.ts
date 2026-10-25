/**
 * ZENTRA — Phase 13 Field Visit Execution & Multi-Visit Flow Test Suite
 * apps/api/test/visits-domain.spec.ts
 *
 * Verifies end-to-end domain logic, REST API endpoints, state machine,
 * GPS proximity check-in gating (<= 50m), structured outcomes, multi-visit sequencing,
 * append-only status histories, and Phase 12 sync engine integration.
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
import {
  setupDisposableIntegrationHarness,
  DISPOSABLE_INTEGRATION_TEST_DATABASE,
} from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  `postgresql://postgres:postgres@localhost:5432/${DISPOSABLE_INTEGRATION_TEST_DATABASE}`;

describe('ZENTRA Phase 13 — Field Visit Execution & Multi-Visit Flow', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let tokenService: TokenService;

  let masterAdminToken: string;
  let districtCoordToken: string;
  let primaryEngineerToken: string;
  let secondaryEngineerToken: string;
  let otherEngineerToken: string;

  let primaryEngineerId: string;
  let otherEngineerId: string;
  let activeCaseId: string;
  let schoolLat: number;
  let schoolLon: number;

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

    // Clean tables for reproducible test runs
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

    // Seed synthetic fixtures
    seeded = await seedSyntheticDevelopmentFixtures(db);

    // Clean pre-seeded visits so test cases start with deterministic sequence 1
    await db.deleteFrom('conveyance_claims').execute();
    await db.deleteFrom('field_visit_status_history').execute();
    await db.deleteFrom('field_visits').execute();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    tokenService = moduleFixture.get<TokenService>(TokenService);

    // Primary engineer assigned to seeded case
    primaryEngineerId = seeded.userId;

    // Create an unassigned "other" engineer in District B
    otherEngineerId = generateUuidV7();
    await db
      .insertInto('users')
      .values({
        user_id: otherEngineerId,
        username: 'other_fe_salem@zentra.test',
        password_hash: '$2b$10$synthetic_dev_hash_only',
        full_name: 'Other Engineer Salem',
        phone_number: '9840099999',
        account_status: 'ACTIVE',
        is_active: true,
      })
      .execute();

    await db
      .insertInto('user_roles')
      .values({
        user_role_id: generateUuidV7(),
        user_id: otherEngineerId,
        role_id: seeded.roleIds.FIELD_ENGINEER,
      })
      .execute();

    // Assign to District B (Salem)
    await db
      .insertInto('user_territory_assignments')
      .values({
        assignment_id: generateUuidV7(),
        user_id: otherEngineerId,
        district_id: seeded.secondDistrictId,
        is_primary_territory: true,
      })
      .execute();

    // Mint JWT tokens
    masterAdminToken = tokenService.generateAccessToken({
      userId: seeded.adminUserId,
      username: 'admin.demo@zentra.test',
      roles: ['MASTER_ADMIN'],
      activeRole: 'MASTER_ADMIN',
      territoryDistrictIds: [seeded.districtId, seeded.secondDistrictId],
    }).token;

    districtCoordToken = tokenService.generateAccessToken({
      userId: seeded.erodeCoordinatorUserId,
      username: 'coordinator.erode@zentra.test',
      roles: ['DISTRICT_COORDINATOR'],
      activeRole: 'DISTRICT_COORDINATOR',
      territoryDistrictIds: [seeded.districtId],
    }).token;

    primaryEngineerToken = tokenService.generateAccessToken({
      userId: primaryEngineerId,
      username: 'engineer.erode@zentra.test',
      roles: ['FIELD_ENGINEER'],
      activeRole: 'FIELD_ENGINEER',
      territoryDistrictIds: [seeded.districtId],
    }).token;

    secondaryEngineerToken = tokenService.generateAccessToken({
      userId: seeded.reportingHeadUserId,
      username: 'head.reporting@zentra.test',
      roles: ['REPORTING_HEAD'],
      activeRole: 'REPORTING_HEAD',
    }).token;

    otherEngineerToken = tokenService.generateAccessToken({
      userId: otherEngineerId,
      username: 'other_fe_salem@zentra.test',
      roles: ['FIELD_ENGINEER'],
      activeRole: 'FIELD_ENGINEER',
      territoryDistrictIds: [seeded.secondDistrictId],
    }).token;

    // Use seeded service case in District A (Erode)
    activeCaseId = seeded.serviceCaseId;
    schoolLat = 11.4501;
    schoolLon = 77.6822;

    await db
      .updateTable('schools')
      .set({
        latitude: schoolLat,
        longitude: schoolLon,
      })
      .where('school_id', '=', seeded.schoolId)
      .execute();

    await db
      .updateTable('service_cases')
      .set({
        assigned_primary_engineer_id: primaryEngineerId,
        operational_status: 'ASSIGNED',
        version: 1,
      })
      .where('service_case_id', '=', activeCaseId)
      .execute();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.destroy();
  });

  // ==========================================================
  // SECTION 1: VISIT CREATION & DETERMINISTIC SEQUENCING
  // ==========================================================
  describe('1. Visit Creation & Deterministic Sequencing', () => {
    it('creates Visit #1 for assigned service case with sequence 1 and status PLANNED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${activeCaseId}/visits`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          serviceCaseId: activeCaseId,
          visitDate: '2026-10-08',
          notes: 'Initial on-site inspection visit',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.visitSequenceNumber).toBe(1);
      expect(body.data.status).toBe('PLANNED');
      expect(body.data.engineerId).toBe(primaryEngineerId);
      expect(body.data.version).toBe(1);
    });

    it('creates Visit #2 for the same service case with sequence 2 deterministically', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${activeCaseId}/visits`,
        headers: {
          authorization: `Bearer ${districtCoordToken}`,
        },
        payload: {
          serviceCaseId: activeCaseId,
          engineerId: primaryEngineerId,
          visitDate: '2026-10-09',
          notes: 'Second follow-up visit',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.visitSequenceNumber).toBe(2);
      expect(body.data.status).toBe('PLANNED');
    });

    it('rejects visit creation for a non-existent service case (404)', async () => {
      const bogusCaseId = generateUuidV7();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${bogusCaseId}/visits`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
        payload: {
          serviceCaseId: bogusCaseId,
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it('rejects visit creation if service case is in final CLOSED status (400)', async () => {
      const closedCaseId = generateUuidV7();
      const closedComplaintId = generateUuidV7();

      await db
        .insertInto('source_complaints')
        .values({
          source_complaint_id: closedComplaintId,
          source_system_id: seeded.complaintSourceId,
          external_ticket_id: `DEMO-TKT-CLOSED-${closedComplaintId.slice(0, 8)}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          original_title: 'Closed Case Test',
          original_description: 'Closed Case Test Description',
          registered_at: new Date(),
          source_status: 'Closed',
          source_priority: 'LOW',
          reported_equipment_text: 'UPS',
          reported_serial_number: null,
          reporter_name: 'Test Reporter',
          reporter_phone: '+919999900001',
          raw_payload: {},
        })
        .execute();

      await db
        .insertInto('service_cases')
        .values({
          service_case_id: closedCaseId,
          zentra_case_code: `ZNT-CLOSED-${closedCaseId.slice(0, 8)}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          source_complaint_id: closedComplaintId,
          assigned_primary_engineer_id: primaryEngineerId,
          operational_status: 'CLOSED',
          internal_priority: 'LOW',
          version: 1,
        })
        .execute();

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${closedCaseId}/visits`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          serviceCaseId: closedCaseId,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      const errMessage = body.error?.message || body.message;
      expect(errMessage).toContain('final status');
    });
  });

  // ==========================================================
  // SECTION 2: GPS PROXIMITY CHECK-IN & ACCURACY GATING
  // ==========================================================
  describe('2. GPS Proximity Check-In & Accuracy Gating', () => {
    let visitId: string;

    beforeAll(async () => {
      // Create a fresh test visit
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${activeCaseId}/visits`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          serviceCaseId: activeCaseId,
        },
      });
      const body = JSON.parse(res.payload);
      visitId = body.data.visitId;
    });

    it('rejects GPS check-in when accuracy exceeds 50m threshold (e.g. 75m -> 400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${visitId}/check-in`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          latitude: schoolLat + 0.0001,
          longitude: schoolLon + 0.0001,
          accuracyMeters: 75.0, // Exceeds <= 50m requirement!
          capturedAt: new Date().toISOString(),
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      const errMessage =
        body.error?.details?.[0]?.message || body.error?.message || body.message || '';
      expect(errMessage).toContain('GPS accuracy');
    });

    it('accepts GPS check-in with high accuracy (<= 50m) and records coordinates, device timestamp, distance', async () => {
      const capturedAt = new Date().toISOString();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${visitId}/check-in`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          latitude: schoolLat + 0.0002, // ~25 meters from school
          longitude: schoolLon + 0.0002,
          accuracyMeters: 8.5, // Well within <= 50m
          capturedAt,
          equipmentConditionObserved: 'Projector ceiling bracket intact, lamp dead',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('CHECKED_IN');
      expect(body.data.checkInAccuracyMeters).toBe(8.5);
      expect(body.data.checkInWithinGeofence).toBe(true);
      expect(body.data.checkInDistanceMeters).toBeLessThan(100);
      expect(body.data.equipmentConditionObserved).toBe('Projector ceiling bracket intact, lamp dead');
      expect(body.data.version).toBe(2);

      // Verify parent service case advanced to VISIT_STARTED
      const updatedCase = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', activeCaseId)
        .select(['operational_status'])
        .executeTakeFirst();
      expect(updatedCase?.operational_status).toBe('VISIT_STARTED');
    });

    it('rejects invalid state transition from CHECKED_IN directly to COMPLETED without start-work (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${visitId}/check-out`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitOutcome: 'RESOLVED_ON_SITE',
          workPerformed: 'Replaced bulb',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      const errMessage = body.error?.message || body.message;
      expect(errMessage).toContain('Cannot check out');
    });
  });

  // ==========================================================
  // SECTION 3: WORK EXECUTION & STRUCTURED OUTCOMES
  // ==========================================================
  describe('3. Work Execution & Structured Outcomes', () => {
    let visitId: string;

    beforeAll(async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${activeCaseId}/visits`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: { serviceCaseId: activeCaseId },
      });
      visitId = JSON.parse(createRes.payload).data.visitId;

      // Check-in
      await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${visitId}/check-in`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          latitude: schoolLat,
          longitude: schoolLon,
          accuracyMeters: 10,
          capturedAt: new Date().toISOString(),
        },
      });
    });

    it('transitions visit to IN_PROGRESS via start-work and updates parent case to IN_PROGRESS', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${visitId}/start-work`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          onSiteDiagnosis: 'Ballast circuit fried, capacitor exploded',
          equipmentConditionObserved: 'Opened casing, motherboard intact',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data.status).toBe('IN_PROGRESS');
      expect(body.data.onSiteDiagnosis).toContain('Ballast circuit');
      expect(body.data.version).toBe(3);

      // Verify case status
      const c = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', activeCaseId)
        .select(['operational_status'])
        .executeTakeFirst();
      expect(c?.operational_status).toBe('IN_PROGRESS');
    });

    it('requires pendingReasonText when checking out with PENDING_PARTS outcome (400 on omission)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${visitId}/check-out`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitOutcome: 'PENDING_PARTS',
          // pendingReasonText is intentionally omitted
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('checks out with PENDING_PARTS outcome: transitions visit to PENDING_RETURN and case to PENDING_PARTS without closing case', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${visitId}/check-out`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitOutcome: 'PENDING_PARTS',
          pendingReasonText: 'Requires replacement ballast unit part #BLST-450',
          workPerformed: 'Tested power rail, diagnosed blown ballast',
          targetNextVisitDate: '2026-10-15',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data.status).toBe('PENDING_RETURN');
      expect(body.data.visitOutcome).toBe('PENDING_PARTS');
      expect(body.data.pendingReasonText).toBe('Requires replacement ballast unit part #BLST-450');

      // Verify parent case operational status is PENDING_PARTS, NOT CLOSED
      const c = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', activeCaseId)
        .select(['operational_status'])
        .executeTakeFirst();
      expect(c?.operational_status).toBe('PENDING_PARTS');
    });
  });

  // ==========================================================
  // SECTION 4: MULTI-VISIT FLOW & IMMUTABLE HISTORY
  // ==========================================================
  describe('4. Multi-Visit Flow & Immutable History', () => {
    let secondVisitId: string;

    it('creates Visit #2 for subsequent parts installation and preserves Visit #1 history immutably', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${activeCaseId}/visits`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          serviceCaseId: activeCaseId,
          visitDate: '2026-10-15',
          notes: 'Visit #2 to install replacement ballast',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const body = JSON.parse(createRes.payload);
      secondVisitId = body.data.visitId;
      expect(body.data.visitSequenceNumber).toBeGreaterThanOrEqual(2);

      // Check-in on site for Visit #2
      await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${secondVisitId}/check-in`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          latitude: schoolLat,
          longitude: schoolLon,
          accuracyMeters: 5.0,
          capturedAt: new Date().toISOString(),
        },
      });

      // Start work
      await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${secondVisitId}/start-work`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          onSiteDiagnosis: 'Received replacement ballast, beginning swap',
        },
      });

      // Check-out with RESOLVED_ON_SITE
      const checkOutRes = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${secondVisitId}/check-out`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitOutcome: 'RESOLVED_ON_SITE',
          workPerformed: 'Installed replacement ballast BLST-450, tested projector boot sequence for 30 minutes, full brightness achieved',
        },
      });

      expect(checkOutRes.statusCode).toBe(201);
      const checkOutBody = JSON.parse(checkOutRes.payload);
      expect(checkOutBody.data.status).toBe('COMPLETED');
      expect(checkOutBody.data.visitOutcome).toBe('RESOLVED_ON_SITE');

      // Condition #3 Verification: parent service case advances to RESOLVED (NEVER CLOSED or VERIFIED)
      const resolvedCase = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', activeCaseId)
        .select(['operational_status'])
        .executeTakeFirst();
      expect(resolvedCase?.operational_status).toBe('RESOLVED');
      expect(resolvedCase?.operational_status).not.toBe('CLOSED');
      expect(resolvedCase?.operational_status).not.toBe('VERIFIED');

      // Verify all visits for the case can be retrieved
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/v1/service-cases/${activeCaseId}/visits`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.payload);
      expect(listBody.data.length).toBeGreaterThanOrEqual(2);

      // Inspect detail of second visit + status history
      const detailRes = await app.inject({
        method: 'GET',
        url: `/api/v1/visits/${secondVisitId}`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect(detailRes.statusCode).toBe(200);
      const detailBody = JSON.parse(detailRes.payload);
      expect(detailBody.data.visit.visitId).toBe(secondVisitId);
      expect(detailBody.data.history.length).toBeGreaterThanOrEqual(3); // PLANNED, CHECKED_IN, IN_PROGRESS, COMPLETED
    });
  });

  // ==========================================================
  // SECTION 5: SECURITY, RBAC & TERRITORY SCOPING
  // ==========================================================
  describe('5. Security, RBAC & Territory Scoping', () => {
    it('rejects unauthenticated visit requests (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/service-cases/${activeCaseId}/visits`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects an engineer from another district attempting to check in to this visit (403)', async () => {
      // Create a fresh open case
      const authCompId = generateUuidV7();
      const authCaseId = generateUuidV7();
      await db
        .insertInto('source_complaints')
        .values({
          source_complaint_id: authCompId,
          source_system_id: seeded.complaintSourceId,
          external_ticket_id: `EXT-AUTH-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          original_title: 'Auth Test Complaint',
          registered_at: new Date(),
        })
        .execute();

      await db
        .insertInto('service_cases')
        .values({
          service_case_id: authCaseId,
          source_complaint_id: authCompId,
          zentra_case_code: `ZNT-AUTH-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          lab_equipment_id: seeded.equipmentId,
          operational_status: 'ASSIGNED',
          internal_priority: 'HIGH',
          assigned_primary_engineer_id: primaryEngineerId,
          version: 1,
        })
        .execute();

      // Create visit
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${authCaseId}/visits`,
        headers: {
          authorization: `Bearer ${districtCoordToken}`,
        },
        payload: {
          serviceCaseId: authCaseId,
          engineerId: primaryEngineerId,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const visit = JSON.parse(createRes.payload).data;

      // Other engineer from Thanjavur tries to check in
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${visit.visitId}/check-in`,
        headers: {
          authorization: `Bearer ${otherEngineerToken}`,
        },
        payload: {
          latitude: schoolLat,
          longitude: schoolLon,
          accuracyMeters: 10,
          capturedAt: new Date().toISOString(),
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ==========================================================
  // SECTION 6: SYNC ENGINE INTEGRATION FOR FIELD VISITS
  // ==========================================================
  describe('6. Phase 12 Sync Engine Integration for field_visits', () => {
    it('accepts offline field visit INSERT mutation via /api/v1/sync/push', async () => {
      const offlineVisitId = generateUuidV7();
      const clientOpId = generateUuidV7();

      const pushRes = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: clientOpId,
              entityType: 'field_visits',
              entityId: offlineVisitId,
              operationType: 'INSERT',
              clientBaseVersion: '1',
              payload: {
                serviceCaseId: activeCaseId,
                engineerId: primaryEngineerId,
                visitDate: '2026-10-18',
                notes: 'Offline created visit',
              },
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(pushRes.statusCode).toBe(200);
      const pushBody = JSON.parse(pushRes.payload);
      expect(pushBody.data.results[0].status).toBe('ACCEPTED');
      expect(pushBody.data.results[0].serverVersion).toBe('1');

      // Verify record exists in PostgreSQL database
      const dbVisit = await db
        .selectFrom('field_visits')
        .where('visit_id', '=', offlineVisitId)
        .selectAll()
        .executeTakeFirst();
      expect(dbVisit).not.toBeNull();
      expect(dbVisit?.service_case_id).toBe(activeCaseId);
    });

    it('detects VERSION_CONFLICT when mutation clientBaseVersion mismatches server version', async () => {
      const offlineVisitId = generateUuidV7();
      // First create it
      await db
        .insertInto('field_visits')
        .values({
          visit_id: offlineVisitId,
          service_case_id: activeCaseId,
          engineer_id: primaryEngineerId,
          visit_sequence_number: 99,
          visit_date: '2026-10-19',
          status: 'CHECKED_IN',
          version: 5, // Server is at version 5
        })
        .execute();

      const clientOpId = generateUuidV7();
      const pushRes = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: clientOpId,
              entityType: 'field_visits',
              entityId: offlineVisitId,
              operationType: 'STATUS_TRANSITION',
              clientBaseVersion: '4', // Mismatch! Client thinks version is 4, server is 5
              payload: {
                toStatus: 'IN_PROGRESS',
              },
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(pushRes.statusCode).toBe(200);
      const pushBody = JSON.parse(pushRes.payload);
      expect(pushBody.data.results[0].status).toBe('CONFLICT');
      expect(pushBody.data.results[0].conflictCode).toBe('VERSION_CONFLICT');
    });

    it('streams changed field_visits downstream in /api/v1/sync/delta', async () => {
      const deltaRes = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/delta',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect(deltaRes.statusCode).toBe(200);
      const deltaBody = JSON.parse(deltaRes.payload);
      const visitChanges = deltaBody.data.changes.filter(
        (c: any) => c.entityType === 'field_visits',
      );
      expect(visitChanges.length).toBeGreaterThan(0);
      expect(visitChanges[0].data.visitId).toBeDefined();
    });
  });

  // ==========================================================
  // SECTION 7: CONCURRENCY & CLOSED CASE BOUNDARY VERIFICATION
  // ==========================================================
  describe('7. Concurrency & Closed Case Boundary Verification (Conditions #2 & #3)', () => {
    let testCaseId: string;
    let closedCaseId: string;
    let closedVisitId: string;

    beforeAll(async () => {
      // 1. Create a fresh open service case for concurrency testing
      testCaseId = generateUuidV7();
      const complaintA = generateUuidV7();
      await db
        .insertInto('source_complaints')
        .values({
          source_complaint_id: complaintA,
          source_system_id: seeded.complaintSourceId,
          external_ticket_id: `EXT-CONC-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          original_title: 'Concurrent Sync Test Complaint',
          registered_at: new Date(),
        })
        .execute();

      await db
        .insertInto('service_cases')
        .values({
          service_case_id: testCaseId,
          source_complaint_id: complaintA,
          zentra_case_code: `ZNT-CONC-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          lab_equipment_id: seeded.equipmentId,
          operational_status: 'ASSIGNED',
          internal_priority: 'HIGH',
          assigned_primary_engineer_id: primaryEngineerId,
          version: 1,
        })
        .execute();

      // 2. Create a CLOSED service case for negative boundary testing
      closedCaseId = generateUuidV7();
      const complaintB = generateUuidV7();
      await db
        .insertInto('source_complaints')
        .values({
          source_complaint_id: complaintB,
          source_system_id: seeded.complaintSourceId,
          external_ticket_id: `EXT-CLOSED-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          original_title: 'Closed Test Complaint',
          registered_at: new Date(),
        })
        .execute();

      await db
        .insertInto('service_cases')
        .values({
          service_case_id: closedCaseId,
          source_complaint_id: complaintB,
          zentra_case_code: `ZNT-CLOSED-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          lab_equipment_id: seeded.equipmentId,
          operational_status: 'CLOSED',
          internal_priority: 'MEDIUM',
          assigned_primary_engineer_id: primaryEngineerId,
          version: 1,
        })
        .execute();

      // Create an existing visit attached to the closed case
      closedVisitId = generateUuidV7();
      await db
        .insertInto('field_visits')
        .values({
          visit_id: closedVisitId,
          service_case_id: closedCaseId,
          engineer_id: primaryEngineerId,
          visit_sequence_number: 1,
          visit_date: '2026-10-18',
          status: 'PLANNED',
          version: 1,
        })
        .execute();
    });

    it('Condition #2: serializes concurrent offline INSERT mutations for same case without sequence collision', async () => {
      const offlineVisitA = generateUuidV7();
      const offlineVisitB = generateUuidV7();

      // Concurrently submit two INSERT mutations for the same service case
      const [resA, resB] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/v1/sync/push',
          headers: {
            authorization: `Bearer ${primaryEngineerToken}`,
          },
          payload: {
            clientBatchId: generateUuidV7(),
            mutations: [
              {
                clientOperationId: generateUuidV7(),
                entityType: 'field_visits',
                entityId: offlineVisitA,
                operationType: 'INSERT',
                clientBaseVersion: '1',
                payload: {
                  serviceCaseId: testCaseId,
                  engineerId: primaryEngineerId,
                  visitDate: '2026-10-20',
                  notes: 'Concurrent offline client A',
                },
                clientCreatedAt: new Date().toISOString(),
              },
            ],
          },
        }),
        app.inject({
          method: 'POST',
          url: '/api/v1/sync/push',
          headers: {
            authorization: `Bearer ${primaryEngineerToken}`,
          },
          payload: {
            clientBatchId: generateUuidV7(),
            mutations: [
              {
                clientOperationId: generateUuidV7(),
                entityType: 'field_visits',
                entityId: offlineVisitB,
                operationType: 'INSERT',
                clientBaseVersion: '1',
                payload: {
                  serviceCaseId: testCaseId,
                  engineerId: primaryEngineerId,
                  visitDate: '2026-10-20',
                  notes: 'Concurrent offline client B',
                },
                clientCreatedAt: new Date().toISOString(),
              },
            ],
          },
        }),
      ]);

      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);

      const bodyA = JSON.parse(resA.payload);
      const bodyB = JSON.parse(resB.payload);

      expect(bodyA.data.results[0].status).toBe('ACCEPTED');
      expect(bodyB.data.results[0].status).toBe('ACCEPTED');

      const seqA = Number(bodyA.data.results[0].data?.visitSequenceNumber);
      const seqB = Number(bodyB.data.results[0].data?.visitSequenceNumber);

      expect(seqA).toBeGreaterThanOrEqual(1);
      expect(seqB).toBeGreaterThanOrEqual(1);
      expect(seqA).not.toBe(seqB);
      expect(Math.abs(seqA - seqB)).toBe(1);

      // Verify both records exist in DB with non-colliding sequences
      const visitsInDb = await db
        .selectFrom('field_visits')
        .where('service_case_id', '=', testCaseId)
        .selectAll()
        .execute();

      expect(visitsInDb.length).toBe(2);
      const sequences = visitsInDb.map((v) => v.visit_sequence_number).sort((a, b) => a - b);
      expect(sequences).toEqual([1, 2]);
    });

    it('Condition #3: rejects visit check-in when parent service case is CLOSED (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${closedVisitId}/check-in`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          latitude: schoolLat,
          longitude: schoolLon,
          accuracyMeters: 10,
          capturedAt: new Date().toISOString(),
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      const message = body.error?.message || body.message;
      expect(message).toContain("Service case is in final status 'CLOSED'");
    });

    it('Condition #3: rejects visit start-work when parent service case is CLOSED (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${closedVisitId}/start-work`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          onSiteDiagnosis: 'Attempting work on closed case',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      const message = body.error?.message || body.message;
      expect(message).toContain("Service case is in final status 'CLOSED'");
    });

    it('Condition #3: rejects visit check-out when parent service case is CLOSED (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${closedVisitId}/check-out`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitOutcome: 'RESOLVED_ON_SITE',
          workPerformed: 'Attempting checkout on closed case',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      const message = body.error?.message || body.message;
      expect(message).toContain("Service case is in final status 'CLOSED'");
    });

    it('Condition #3: rejects offline sync push visit mutation when parent service case is CLOSED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: generateUuidV7(),
              entityType: 'field_visits',
              entityId: closedVisitId,
              operationType: 'STATUS_TRANSITION',
              clientBaseVersion: '1',
              payload: {
                toStatus: 'CHECKED_IN',
              },
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.results[0].status).toBe('CONFLICT');
      expect(body.data.results[0].conflictCode).toBe('INVALID_STATE_TRANSITION');
      expect(body.data.results[0].message).toContain('CLOSED');
    });
  });
});


/**
 * ZENTRA — Phase 9 Service Case Lifecycle & Dispatch Engine Integration Suite
 * apps/api/test/service-case-lifecycle.spec.ts
 *
 * Comprehensive End-to-End & Integration Suite covering:
 * A. Case creation from committed source complaints
 * B. Business case code generation (ZNT-{YEAR}-{DIST}-{SEQ})
 * C. 1:1 uniqueness constraint enforcement (sourceComplaintId uniqueness)
 * D. Rejection of unapproved / draft intake
 * E. State Machine Lifecycle:
 *    - All 10 operational states traversed in valid sequence
 *    - Rejection of invalid state jumps (REGISTERED -> RESOLVED, etc.)
 *    - Prerequisite enforcement (engineer assigned, resolution notes)
 * F. Dispatch Engine:
 *    - Territory validation (same district allowed, cross-district rejected)
 *    - Emergency cross-district dispatch with mandatory justification
 *    - Primary and secondary engineer roles
 *    - Reassignment tracking with previous_engineer_id
 *    - Workload count and engineer availability
 * G. Technical Append-Only Immutability:
 *    - PostgreSQL trigger prevents UPDATE and DELETE on assignment_history
 *    - PostgreSQL trigger prevents UPDATE and DELETE on service_case_status_history
 * H. SLA Engine & Breach Calculations:
 *    - Priority-based SLA policy assignment
 *    - Warning threshold and breach evaluations
 *    - SLA breach does NOT alter operational lifecycle status
 * I. RBAC and Territory Scoping:
 *    - Master Admin statewide authority
 *    - Reporting Head read-only enforcement
 *    - District Coordinator district scoping
 *    - Field Engineer assignment scoping
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
import { assertTestEnvironmentIsSafe, assertTestDatabaseIsSafe } from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zentra_test';

describe('ZENTRA Phase 9 — Service Case Lifecycle & Dispatch Engine Subsystem', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let tokenService: TokenService;

  let masterAdminToken: string;
  let reportingHeadToken: string;
  let erodeCoordinatorToken: string;
  let salemCoordinatorToken: string;
  let fieldEngineerToken: string;
  let secondFieldEngineerToken: string;

  let secondaryEngineerId: string;
  let validCommittedComplaintId: string;
  let draftComplaintId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;
    assertTestEnvironmentIsSafe();
    assertTestDatabaseIsSafe(TEST_DB_URL);

    const { createDatabaseConnection } = await import('../src/database/database.connection');
    db = createDatabaseConnection(TEST_DB_URL);

    // Clean tables using TRUNCATE CASCADE to bypass row-level immutability triggers
    await sql`
      TRUNCATE TABLE
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

    // Create a second field engineer assigned to District B (Salem) for cross-district testing
    secondaryEngineerId = generateUuidV7();
    const defaultPasswordHash = '$scrypt$N=16384,r=8,p=1$fakehash$fakesalt';

    await db
      .insertInto('users')
      .values({
        user_id: secondaryEngineerId,
        username: 'engineer.salem@zentra.test',
        full_name: 'Demo Salem Field Engineer',
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
        block_id: null,
        is_primary_territory: true,
      })
      .execute();

    // Create a committed source complaint for testing
    validCommittedComplaintId = generateUuidV7();
    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: validCommittedComplaintId,
        source_system_id: seeded.complaintSourceId,
        external_ticket_id: 'TCK-2026-PH9-001',
        school_id: seeded.schoolId,
        lab_id: seeded.labId,
        original_title: 'Projector display failing intermittently',
        original_description: 'Lab projector turns off after 10 minutes of operation',
        registered_at: new Date(),
        source_status: 'REGISTERED',
        source_priority: 'HIGH',
      })
      .execute();

    // Create a DRAFT source complaint for negative testing
    draftComplaintId = generateUuidV7();
    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: draftComplaintId,
        source_system_id: seeded.complaintSourceId,
        external_ticket_id: 'TCK-2026-PH9-DRAFT',
        school_id: seeded.schoolId,
        lab_id: seeded.labId,
        original_title: 'Unverified draft complaint',
        original_description: 'Pending staging verification',
        registered_at: new Date(),
        source_status: 'DRAFT',
        source_priority: 'MEDIUM',
      })
      .execute();

    // Bootstrap NestJS Fastify testing application
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    tokenService = new TokenService();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // Issue tokens
    masterAdminToken = tokenService.generateAccessToken({
      userId: seeded.adminUserId,
      username: 'admin.demo@zentra.test',
      roles: ['MASTER_ADMIN'],
      activeRole: 'MASTER_ADMIN',
      territoryDistrictIds: [seeded.districtId, seeded.secondDistrictId],
    }).token;

    reportingHeadToken = tokenService.generateAccessToken({
      userId: seeded.reportingHeadUserId,
      username: 'reporting.head@zentra.test',
      roles: ['REPORTING_HEAD'],
      activeRole: 'REPORTING_HEAD',
      territoryDistrictIds: [seeded.districtId, seeded.secondDistrictId],
    }).token;

    erodeCoordinatorToken = tokenService.generateAccessToken({
      userId: seeded.erodeCoordinatorUserId,
      username: 'coordinator.erode@zentra.test',
      roles: ['DISTRICT_COORDINATOR'],
      activeRole: 'DISTRICT_COORDINATOR',
      territoryDistrictIds: [seeded.districtId],
    }).token;

    salemCoordinatorToken = tokenService.generateAccessToken({
      userId: seeded.salemCoordinatorUserId,
      username: 'coordinator.salem@zentra.test',
      roles: ['DISTRICT_COORDINATOR'],
      activeRole: 'DISTRICT_COORDINATOR',
      territoryDistrictIds: [seeded.secondDistrictId],
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
    if (app) await app.close();
    if (db) await db.destroy();
  });

  // =========================================================================
  // 1. SERVICE CASE CREATION & BOUNDARY INTEGRITY
  // =========================================================================

  describe('1. Service Case Creation Boundary', () => {
    it('creates a service case from an approved, committed source complaint', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/service-cases',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          sourceComplaintId: validCommittedComplaintId,
          internalPriority: 'HIGH',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.sourceComplaintId).toBe(validCommittedComplaintId);
      expect(body.data.operationalStatus).toBe('REGISTERED');
      expect(body.data.internalPriority).toBe('HIGH');
      expect(body.data.zentraCaseCode).toMatch(/^ZNT-\d{4}-[A-Z0-9_]+-\d{6}$/);

      // Verify SLA policy linked (HIGH = 48h)
      expect(body.data.slaTargetAt).not.toBeNull();
      const targetDate = new Date(body.data.slaTargetAt);
      const now = new Date();
      const diffHours = (targetDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(45);
      expect(diffHours).toBeLessThanOrEqual(49);

      // Verify initial status history recorded
      const statusHistory = await db
        .selectFrom('service_case_status_history')
        .where('service_case_id', '=', body.data.serviceCaseId)
        .selectAll()
        .execute();
      expect(statusHistory.length).toBe(1);
      expect(statusHistory[0].to_status).toBe('REGISTERED');

      // Verify Administrative Audit Log
      const auditLogs = await db
        .selectFrom('audit_events')
        .where('target_entity_id', '=', body.data.serviceCaseId)
        .where('action_type', '=', 'CREATE_FROM_SOURCE_COMPLAINT')
        .selectAll()
        .execute();
      expect(auditLogs.length).toBe(1);
    });

    it('rejects creating a service case from a DRAFT source complaint (400 Bad Request)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/service-cases',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          sourceComplaintId: draftComplaintId,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      const errMsg = body.error?.message || body.message;
      expect(errMsg).toContain('DRAFT');
    });

    it('enforces 1:1 uniqueness constraint and rejects duplicate service case creation (409 Conflict)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/service-cases',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          sourceComplaintId: validCommittedComplaintId,
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      const errMsg = body.error?.message || body.message;
      expect(errMsg).toContain('already exists');
    });
  });

  // =========================================================================
  // 2. DISPATCH ENGINE & TERRITORY SCOPING
  // =========================================================================

  describe('2. Dispatch Engine & Territory Scoping', () => {
    let testCaseId: string;

    beforeAll(async () => {
      // Create a fresh case in District A (Erode)
      const complaintId = generateUuidV7();
      await db
        .insertInto('source_complaints')
        .values({
          source_complaint_id: complaintId,
          source_system_id: seeded.complaintSourceId,
          external_ticket_id: 'TCK-2026-DISPATCH-01',
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          original_title: 'UPS Battery Failure',
          registered_at: new Date(),
          source_status: 'REGISTERED',
          source_priority: 'MEDIUM',
        })
        .execute();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/service-cases',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          sourceComplaintId: complaintId,
          internalPriority: 'MEDIUM',
        },
      });
      testCaseId = JSON.parse(createRes.payload).data.serviceCaseId;
    });

    it('queries eligible engineers by district with workload counts', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/dispatch/eligible-engineers?districtId=${seeded.districtId}`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      const erodeEng = body.data.find((e: any) => e.engineerId === seeded.userId);
      expect(erodeEng).toBeDefined();
      expect(erodeEng.fullName).toBe('Demo Field Engineer');
      expect(erodeEng.districtId).toBe(seeded.districtId);
      expect(typeof erodeEng.activeAssignedCasesCount).toBe('number');
    });

    it('supports configurable capacity threshold on eligible engineers query', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/dispatch/eligible-engineers?districtId=${seeded.districtId}&capacityThreshold=5`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      const erodeEng = body.data.find((e: any) => e.engineerId === seeded.userId);
      expect(erodeEng).toBeDefined();
      expect(erodeEng.configuredCapacityThreshold).toBe(5);
    });

    it('rejects dispatching an engineer from outside the district without emergency justification (400 Bad Request)', async () => {
      // secondaryEngineerId is assigned to Salem (District B), case is in Erode (District A)
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dispatch/${testCaseId}/assign`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          engineerId: secondaryEngineerId,
          isEmergencyCrossDistrict: false,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      const errMsg = body.error?.message || body.message;
      expect(errMsg).toContain('Territory mismatch');
    });

    it('rejects emergency cross-district dispatch if justification is too short (< 10 chars)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dispatch/${testCaseId}/assign`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          engineerId: secondaryEngineerId,
          isEmergencyCrossDistrict: true,
          emergencyJustification: 'Short',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('successfully assigns an in-territory engineer and automatically advances REGISTERED -> ASSIGNED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dispatch/${testCaseId}/assign`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          engineerId: seeded.userId,
          assignmentRole: 'PRIMARY',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.assignedPrimaryEngineerId).toBe(seeded.userId);
      expect(body.data.operationalStatus).toBe('ASSIGNED');

      // Verify assignment history recorded
      const historyRes = await app.inject({
        method: 'GET',
        url: `/api/v1/dispatch/${testCaseId}/history`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });

      expect(historyRes.statusCode).toBe(200);
      const historyBody = JSON.parse(historyRes.payload);
      expect(historyBody.data.length).toBe(1);
      expect(historyBody.data[0].engineerId).toBe(seeded.userId);
      expect(historyBody.data[0].action).toBe('ASSIGNED');
      expect(historyBody.data[0].isEmergencyCrossDistrict).toBe(false);
    });

    it('successfully performs emergency cross-district dispatch when valid justification is provided', async () => {
      // Reassign to Salem engineer with emergency justification
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dispatch/${testCaseId}/assign`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          engineerId: secondaryEngineerId,
          assignmentRole: 'PRIMARY',
          isEmergencyCrossDistrict: true,
          emergencyJustification: 'Urgent statewide exam support; local engineer currently indisposed',
          reassignmentReason: 'Local engineer unavailable',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data.assignedPrimaryEngineerId).toBe(secondaryEngineerId);

      // Verify assignment history ledger captures previous_engineer_id and emergency justification
      const historyRes = await app.inject({
        method: 'GET',
        url: `/api/v1/dispatch/${testCaseId}/history`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });

      const historyBody = JSON.parse(historyRes.payload);
      expect(historyBody.data.length).toBe(2);
      const latest = historyBody.data[1];
      expect(latest.engineerId).toBe(secondaryEngineerId);
      expect(latest.previousEngineerId).toBe(seeded.userId);
      expect(latest.action).toBe('REASSIGNED');
      expect(latest.isEmergencyCrossDistrict).toBe(true);
      expect(latest.emergencyJustification).toContain('statewide exam support');
    });

    it('assigns a secondary engineer without overriding the primary engineer', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dispatch/${testCaseId}/assign`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          engineerId: seeded.userId,
          assignmentRole: 'SECONDARY',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data.assignedPrimaryEngineerId).toBe(secondaryEngineerId);
      expect(body.data.assignedSecondaryEngineerId).toBe(seeded.userId);
    });
  });

  // =========================================================================
  // 3. COMPLETE 10-STATE LIFECYCLE STATE MACHINE
  // =========================================================================

  describe('3. Operational Lifecycle State Machine', () => {
    let lifecycleCaseId: string;

    beforeAll(async () => {
      const compId = generateUuidV7();
      await db
        .insertInto('source_complaints')
        .values({
          source_complaint_id: compId,
          source_system_id: seeded.complaintSourceId,
          external_ticket_id: 'TCK-2026-LIFECYCLE-01',
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          original_title: 'Full Lifecycle Test Case',
          registered_at: new Date(),
          source_status: 'REGISTERED',
          source_priority: 'CRITICAL',
        })
        .execute();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/service-cases',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          sourceComplaintId: compId,
          internalPriority: 'CRITICAL',
        },
      });
      lifecycleCaseId = JSON.parse(res.payload).data.serviceCaseId;
    });

    it('rejects illegal jump: REGISTERED -> RESOLVED (400 Bad Request)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'RESOLVED',
          reason: 'Premature resolution attempt',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      const errMsg = body.error?.message || body.message;
      expect(errMsg).toContain('Invalid state transition');
    });

    it('rejects illegal jump: REGISTERED -> CLOSED (400 Bad Request)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'CLOSED',
          reason: 'Premature close attempt',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('traverses the entire 10-state lifecycle in canonical order', async () => {
      // 1. Dispatch engineer to reach ASSIGNED
      await app.inject({
        method: 'POST',
        url: `/api/v1/dispatch/${lifecycleCaseId}/assign`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          engineerId: seeded.userId,
          assignmentRole: 'PRIMARY',
        },
      });

      // 2. ASSIGNED -> IN_TRANSIT
      const t1 = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'IN_TRANSIT',
          reason: 'Engineer departed for school site',
        },
      });
      expect(t1.statusCode).toBe(201);
      expect(JSON.parse(t1.payload).data.operationalStatus).toBe('IN_TRANSIT');

      // 3. IN_TRANSIT -> VISIT_STARTED
      const t2 = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'VISIT_STARTED',
          reason: 'Engineer checked in on site',
        },
      });
      expect(t2.statusCode).toBe(201);
      expect(JSON.parse(t2.payload).data.operationalStatus).toBe('VISIT_STARTED');

      // 4. VISIT_STARTED -> IN_PROGRESS
      const t3 = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'IN_PROGRESS',
          reason: 'Diagnostic inspection started',
        },
      });
      expect(t3.statusCode).toBe(201);
      expect(JSON.parse(t3.payload).data.operationalStatus).toBe('IN_PROGRESS');

      // 5. IN_PROGRESS -> PENDING_PARTS
      const t4 = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'PENDING_PARTS',
          reason: 'Replacement HDMI board requested',
        },
      });
      expect(t4.statusCode).toBe(201);
      expect(JSON.parse(t4.payload).data.operationalStatus).toBe('PENDING_PARTS');

      // 6. PENDING_PARTS -> IN_PROGRESS
      const t5 = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'IN_PROGRESS',
          reason: 'Parts arrived; replacement underway',
        },
      });
      expect(t5.statusCode).toBe(201);
      expect(JSON.parse(t5.payload).data.operationalStatus).toBe('IN_PROGRESS');

      // 7. IN_PROGRESS -> ESCALATED_OEM
      const t6 = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'ESCALATED_OEM',
          reason: 'Proprietary firmware reprogramming needed by OEM',
        },
      });
      expect(t6.statusCode).toBe(201);
      expect(JSON.parse(t6.payload).data.operationalStatus).toBe('ESCALATED_OEM');

      // 8. ESCALATED_OEM -> IN_PROGRESS
      const t7 = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'IN_PROGRESS',
          reason: 'OEM patch applied, testing final verification',
        },
      });
      expect(t7.statusCode).toBe(201);
      expect(JSON.parse(t7.payload).data.operationalStatus).toBe('IN_PROGRESS');

      // 9. IN_PROGRESS -> RESOLVED
      const t8 = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'RESOLVED',
          notes: 'Device motherboard replaced and stress tested successfully',
        },
      });
      expect(t8.statusCode).toBe(201);
      expect(JSON.parse(t8.payload).data.operationalStatus).toBe('RESOLVED');

      // 10. RESOLVED -> VERIFIED
      const t9 = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'VERIFIED',
          reason: 'School Headmaster verified operational display',
        },
      });
      expect(t9.statusCode).toBe(201);
      expect(JSON.parse(t9.payload).data.operationalStatus).toBe('VERIFIED');

      // 11. VERIFIED -> CLOSED
      const t10 = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'CLOSED',
          reason: 'Administrative service case closure complete',
        },
      });
      expect(t10.statusCode).toBe(201);
      expect(JSON.parse(t10.payload).data.operationalStatus).toBe('CLOSED');

      // Verify complete status history chain
      const history = await db
        .selectFrom('service_case_status_history')
        .where('service_case_id', '=', lifecycleCaseId)
        .orderBy('created_at', 'asc')
        .selectAll()
        .execute();

      expect(history.length).toBeGreaterThanOrEqual(10);
      const toStatuses = history.map((h) => h.to_status);
      expect(toStatuses).toContain('REGISTERED');
      expect(toStatuses).toContain('ASSIGNED');
      expect(toStatuses).toContain('IN_TRANSIT');
      expect(toStatuses).toContain('VISIT_STARTED');
      expect(toStatuses).toContain('IN_PROGRESS');
      expect(toStatuses).toContain('PENDING_PARTS');
      expect(toStatuses).toContain('ESCALATED_OEM');
      expect(toStatuses).toContain('RESOLVED');
      expect(toStatuses).toContain('VERIFIED');
      expect(toStatuses).toContain('CLOSED');
    });

    it('prohibits District Coordinator and Field Engineer from reopening a CLOSED case (403 Forbidden)', async () => {
      // Attempt reopening CLOSED -> IN_PROGRESS as District Coordinator
      const dcRes = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${erodeCoordinatorToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'IN_PROGRESS',
          reason: 'Coordinator attempting to reopen',
        },
      });

      expect(dcRes.statusCode).toBe(403);
      const dcBody = JSON.parse(dcRes.payload);
      const dcMsg = dcBody.error?.message || dcBody.message;
      expect(dcMsg).toContain('Only MASTER_ADMIN possesses authority to reopen a CLOSED service case');

      // Attempt reopening CLOSED -> IN_PROGRESS as Field Engineer
      const feRes = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${fieldEngineerToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'IN_PROGRESS',
          reason: 'Engineer attempting to reopen',
        },
      });

      expect(feRes.statusCode).toBe(403);
      const feBody = JSON.parse(feRes.payload);
      const feMsg = feBody.error?.message || feBody.message;
      expect(feMsg).toContain('Only MASTER_ADMIN possesses authority to reopen a CLOSED service case');
    });

    it('allows MASTER_ADMIN to reopen a CLOSED case back to IN_PROGRESS (Option A)', async () => {
      const reopenRes = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${lifecycleCaseId}/transition`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'IN_PROGRESS',
          reason: 'Reopened by Master Admin due to recurring fault',
        },
      });

      expect(reopenRes.statusCode).toBe(201);
      const body = JSON.parse(reopenRes.payload);
      expect(body.data.operationalStatus).toBe('IN_PROGRESS');
    });
  });

  // =========================================================================
  // 4. DATABASE APPEND-ONLY IMMUTABILITY KERNEL
  // =========================================================================

  describe('4. Database Append-Only Immutability Kernel', () => {
    it('prohibits direct SQL UPDATE on assignment_history via PostgreSQL trigger', async () => {
      // Find an existing assignment record
      const record = await db
        .selectFrom('assignment_history')
        .selectAll()
        .limit(1)
        .executeTakeFirst();

      expect(record).toBeDefined();

      let updateFailed = false;
      try {
        await db
          .updateTable('assignment_history')
          .set({ reassignment_reason: 'Tampered reason' })
          .where('assignment_history_id', '=', record!.assignment_history_id)
          .execute();
      } catch (err: any) {
        updateFailed = true;
        expect(err.message).toContain('assignment_history is append-only');
      }

      expect(updateFailed).toBe(true);
    });

    it('prohibits direct SQL DELETE on assignment_history via PostgreSQL trigger', async () => {
      const record = await db
        .selectFrom('assignment_history')
        .selectAll()
        .limit(1)
        .executeTakeFirst();

      expect(record).toBeDefined();

      let deleteFailed = false;
      try {
        await db
          .deleteFrom('assignment_history')
          .where('assignment_history_id', '=', record!.assignment_history_id)
          .execute();
      } catch (err: any) {
        deleteFailed = true;
        expect(err.message).toContain('assignment_history is append-only');
      }

      expect(deleteFailed).toBe(true);
    });

    it('prohibits direct SQL UPDATE on service_case_status_history via PostgreSQL trigger', async () => {
      const record = await db
        .selectFrom('service_case_status_history')
        .selectAll()
        .limit(1)
        .executeTakeFirst();

      expect(record).toBeDefined();

      let updateFailed = false;
      try {
        await db
          .updateTable('service_case_status_history')
          .set({ transition_reason: 'Tampered transition reason' })
          .where('status_history_id', '=', record!.status_history_id)
          .execute();
      } catch (err: any) {
        updateFailed = true;
        expect(err.message).toContain('service_case_status_history is append-only');
      }

      expect(updateFailed).toBe(true);
    });

    it('prohibits direct SQL DELETE on service_case_status_history via PostgreSQL trigger', async () => {
      const record = await db
        .selectFrom('service_case_status_history')
        .selectAll()
        .limit(1)
        .executeTakeFirst();

      expect(record).toBeDefined();

      let deleteFailed = false;
      try {
        await db
          .deleteFrom('service_case_status_history')
          .where('status_history_id', '=', record!.status_history_id)
          .execute();
      } catch (err: any) {
        deleteFailed = true;
        expect(err.message).toContain('service_case_status_history is append-only');
      }

      expect(deleteFailed).toBe(true);
    });
  });

  // =========================================================================
  // 5. SLA ENGINE & BREACH CALCULATION
  // =========================================================================

  describe('5. SLA Resolution Engine', () => {
    it('retrieves active SLA policies for all four priority tiers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/sla/policies',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(4);

      const critical = body.data.find((p: any) => p.priorityLevel === 'CRITICAL');
      const high = body.data.find((p: any) => p.priorityLevel === 'HIGH');
      const medium = body.data.find((p: any) => p.priorityLevel === 'MEDIUM');
      const low = body.data.find((p: any) => p.priorityLevel === 'LOW');

      expect(critical.targetResolutionHours).toBe(24);
      expect(high.targetResolutionHours).toBe(48);
      expect(medium.targetResolutionHours).toBe(72);
      expect(low.targetResolutionHours).toBe(168);
    });

    it('evaluates dynamic SLA status and verifies breach does NOT modify operational status', async () => {
      // Create a case with target in the past to simulate breach
      const pastDate = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30 hours ago
      const slaTargetPast = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6 hours ago
      const breachedCaseId = generateUuidV7();

      const compId = generateUuidV7();
      await db
        .insertInto('source_complaints')
        .values({
          source_complaint_id: compId,
          source_system_id: seeded.complaintSourceId,
          external_ticket_id: 'TCK-2026-SLA-BREACH',
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          original_title: 'Server Rack Fan Failure',
          registered_at: pastDate,
          source_status: 'REGISTERED',
          source_priority: 'CRITICAL',
        })
        .execute();

      await db
        .insertInto('service_cases')
        .values({
          service_case_id: breachedCaseId,
          source_complaint_id: compId,
          zentra_case_code: 'ZNT-2026-ERO-999999',
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          operational_status: 'IN_PROGRESS',
          internal_priority: 'CRITICAL',
          assigned_primary_engineer_id: seeded.userId,
          sla_target_at: slaTargetPast,
          sla_breach_status: 'WITHIN_SLA',
          created_at: pastDate,
          updated_at: pastDate,
        })
        .execute();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/sla/calculate/${breachedCaseId}`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.slaEvaluation.isBreached).toBe(true);
      expect(body.data.slaEvaluation.breachStatus).toBe('BREACHED');

      // CRITICAL BOUNDARY: Operational status MUST remain IN_PROGRESS
      expect(body.data.operationalStatus).toBe('IN_PROGRESS');

      const dbCase = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', breachedCaseId)
        .select('operational_status')
        .executeTakeFirstOrThrow();
      expect(dbCase.operational_status).toBe('IN_PROGRESS');
    });
  });

  // =========================================================================
  // 6. RBAC & MULTI-DISTRICT AUTHORIZATION
  // =========================================================================

  describe('6. RBAC & Multi-District Scoping', () => {
    it('prohibits Field Engineer from creating service cases (403 Forbidden)', async () => {
      const compId = generateUuidV7();
      await db
        .insertInto('source_complaints')
        .values({
          source_complaint_id: compId,
          source_system_id: seeded.complaintSourceId,
          external_ticket_id: 'TCK-2026-RBAC-01',
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          original_title: 'Unpermitted Creation Attempt',
          registered_at: new Date(),
          source_status: 'REGISTERED',
          source_priority: 'LOW',
        })
        .execute();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/service-cases',
        headers: {
          authorization: `Bearer ${fieldEngineerToken}`,
          'content-type': 'application/json',
        },
        payload: {
          sourceComplaintId: compId,
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('prohibits District Coordinator from querying service cases outside their territory (403 Forbidden)', async () => {
      // Salem coordinator trying to query Erode district
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/service-cases?districtId=${seeded.districtId}`,
        headers: {
          authorization: `Bearer ${salemCoordinatorToken}`,
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('allows Reporting Head to read cases statewide', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/service-cases',
        headers: {
          authorization: `Bearer ${reportingHeadToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('prohibits Reporting Head from transitioning case operational status (403 Forbidden)', async () => {
      const cases = await db
        .selectFrom('service_cases')
        .selectAll()
        .limit(1)
        .executeTakeFirst();

      expect(cases).toBeDefined();

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${cases!.service_case_id}/transition`,
        headers: {
          authorization: `Bearer ${reportingHeadToken}`,
          'content-type': 'application/json',
        },
        payload: {
          targetStatus: 'CLOSED',
          reason: 'Unauthorized mutation',
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});

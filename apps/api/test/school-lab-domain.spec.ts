/**
 * ZENTRA — Phase 6 School, Lab & Equipment Domain Foundation Tests
 * apps/api/test/school-lab-domain.spec.ts
 *
 * Comprehensive End-to-End & Integration Suite covering:
 * 1. Territory Hierarchy Validation (District -> Block -> School -> Lab)
 * 2. School Domain Operations (UDISE validation, CRUD, soft-deactivation)
 * 3. Hi-Tech Lab Multi-Lab Model (1 school:N labs, unique lab_code per school)
 * 4. RBAC & Multi-District Scoping (Master Admin, Reporting Head, Coordinator, Engineer)
 * 5. PostgreSQL Kernel Row-Level Security (RLS isolation for schools and labs)
 * 6. Immutable Audit Trail Logging (ADMINISTRATIVE events)
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
  SYNTHETIC_TEST_PASSWORD,
  type SeededEntities,
} from '../src/database/seeds/synthetic-dev-fixtures';
import { TokenService } from '../src/modules/auth/token.service';
import { RlsService } from '../src/modules/auth/rls.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { generateUuidV7 } from '@zentra/shared';
import { assertTestEnvironmentIsSafe, assertTestDatabaseIsSafe } from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zentra_test';

describe('ZENTRA Phase 6 — School, Lab & Equipment Domain Integration', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let tokenService: TokenService;
  let rlsService: RlsService;

  let masterAdminToken: string;
  let reportingHeadToken: string;
  let erodeCoordinatorToken: string;
  let salemCoordinatorToken: string;
  let fieldEngineerToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;
    assertTestEnvironmentIsSafe();
    assertTestDatabaseIsSafe(TEST_DB_URL);

    // 1. Establish database connection & clear existing test data
    const { createDatabaseConnection } = await import('../src/database/database.connection');
    db = createDatabaseConnection(TEST_DB_URL);

    // Clean tables in reverse foreign key order
    await db.deleteFrom('conveyance_claims').execute();
    await db.deleteFrom('evidence_files').execute();
    await db.deleteFrom('visit_equipment_findings').execute();
    await db.deleteFrom('field_visits').execute();
    await sql`TRUNCATE TABLE assignment_history, service_case_status_history CASCADE;`.execute(db);
    await db.deleteFrom('service_cases').execute();
    await db.deleteFrom('source_complaints').execute();
    await db.deleteFrom('complaint_sources').execute();
    await db.deleteFrom('refresh_tokens').execute();
    await db.deleteFrom('user_territory_assignments').execute();
    await db.deleteFrom('user_roles').execute();
    await db.deleteFrom('role_permissions').execute();
    await db.deleteFrom('permissions').execute();
    await db.deleteFrom('users').execute();
    await db.deleteFrom('roles').execute();
    await db.deleteFrom('lab_equipment').execute();
    await db.deleteFrom('equipment_attribute_definitions').execute();
    await db.deleteFrom('equipment_types').execute();
    await db.deleteFrom('oem_manufacturers').execute();
    await db.deleteFrom('hi_tech_labs').execute();
    await db.deleteFrom('schools').execute();
    await db.deleteFrom('blocks').execute();
    await db.deleteFrom('districts').execute();
    await db.deleteFrom('audit_events').execute();

    // 2. Seed synthetic dev fixtures
    seeded = await seedSyntheticDevelopmentFixtures(db);

    tokenService = new TokenService();
    rlsService = new RlsService(db);

    // 3. Bootstrap NestJS Fastify testing application
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // 4. Generate authenticated JWT tokens for personas
    masterAdminToken = tokenService.generateAccessToken({
      userId: seeded.adminUserId,
      username: 'admin.demo@zentra.test',
      roles: ['MASTER_ADMIN'],
      activeRole: 'MASTER_ADMIN',
      territoryDistrictIds: [seeded.districtId, seeded.secondDistrictId],
    }).token;

    reportingHeadToken = tokenService.generateAccessToken({
      userId: seeded.reportingHeadUserId,
      username: 'head.reporting@zentra.test',
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
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (db) {
      await db.destroy();
    }
  });

  // =========================================================================
  // 1. Territory Hierarchy Validation
  // =========================================================================
  describe('1. Territory Hierarchy & Validation', () => {
    it('lists all active districts via GET /districts', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/districts',
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(2);

      const districtCodes = body.data.map((d: { districtCode: string }) => d.districtCode);
      expect(districtCodes).toContain('DEMO_DIS');
      expect(districtCodes).toContain('DEMO_SAL');
    });

    it('retrieves district details via GET /districts/:districtId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/districts/${seeded.districtId}`,
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.districtId).toBe(seeded.districtId);
      expect(body.data.districtCode).toBe('DEMO_DIS');
    });

    it('lists blocks in a district via GET /districts/:districtId/blocks', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/districts/${seeded.districtId}/blocks`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.length).toBe(2); // Block A1 and Block A2
      const blockCodes = body.data.map((b: { blockCode: string }) => b.blockCode);
      expect(blockCodes).toContain('DEMO_BLK');
      expect(blockCodes).toContain('DEMO_BLK_EAST');
    });

    it('retrieves block details via GET /blocks/:blockId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/blocks/${seeded.blockId}`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.blockId).toBe(seeded.blockId);
      expect(body.data.districtId).toBe(seeded.districtId);
    });

    it('rejects cross-district hierarchy mismatch when creating a school (400 Bad Request)', async () => {
      // Attempt to pair District A (Erode) with Block B (Salem North)
      const res = await app.inject({
        method: 'POST',
        url: '/schools',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          udiseCode: '33100099999',
          schoolName: 'Mismatched School Test',
          districtId: seeded.districtId, // District A
          blockId: seeded.secondBlockId, // Block from District B
          schoolCategory: 'High School',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error.message).toContain('Hierarchy conflict');
    });

    it('rejects nonexistent districtId or blockId with 400 Bad Request', async () => {
      const fakeDistrictId = generateUuidV7();
      const res = await app.inject({
        method: 'POST',
        url: '/schools',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          udiseCode: '33100099998',
          schoolName: 'Ghost District School',
          districtId: fakeDistrictId,
          blockId: seeded.blockId,
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // 2. School Domain Operations & Validation
  // =========================================================================
  describe('2. School Domain Operations', () => {
    let createdSchoolId: string;

    it('creates a new school with valid 11-digit UDISE and contact details', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/schools',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          udiseCode: '33100055555',
          schoolName: 'ZENTRA Government Model Higher Secondary School Bhavani',
          districtId: seeded.districtId,
          blockId: seeded.blockId,
          schoolCategory: 'Higher Secondary',
          basePincode: '638301',
          isSpecialZone: false,
          latitude: 11.450123,
          longitude: 77.680456,
          hmName: 'K. Senthil Kumar',
          hmPhone: '9443322110',
          aiName: 'R. Meenakshi',
          aiPhone: '9443322111',
          aiEmpId: 'EDU-TN-2026-9812',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.udiseCode).toBe('33100055555');
      expect(body.data.schoolName).toBe('ZENTRA Government Model Higher Secondary School Bhavani');
      expect(body.data.basePincode).toBe('638301');
      expect(body.data.hmName).toBe('K. Senthil Kumar');
      expect(body.data.isActive).toBe(true);

      createdSchoolId = body.data.schoolId;
    });

    it('rejects duplicate UDISE code with 409 Conflict', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/schools',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          udiseCode: '33100055555', // Duplicate UDISE
          schoolName: 'Duplicate School Attempt',
          districtId: seeded.districtId,
          blockId: seeded.blockId,
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.error.message).toContain('already exists');
    });

    it('rejects invalid UDISE length or format (400 Bad Request)', async () => {
      // 10 digits instead of 11
      const res1 = await app.inject({
        method: 'POST',
        url: '/schools',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          udiseCode: '3310005555',
          schoolName: 'Short UDISE School',
          districtId: seeded.districtId,
          blockId: seeded.blockId,
        },
      });
      expect(res1.statusCode).toBe(400);

      // Non-numeric UDISE
      const res2 = await app.inject({
        method: 'POST',
        url: '/schools',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          udiseCode: '3310005555A',
          schoolName: 'Alpha UDISE School',
          districtId: seeded.districtId,
          blockId: seeded.blockId,
        },
      });
      expect(res2.statusCode).toBe(400);
    });

    it('lists schools with search and filter parameters via GET /schools', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/schools?districtId=${seeded.districtId}&search=Bhavani&page=1&limit=10`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(1);
      expect(body.data[0].udiseCode).toBe('33100055555');
      expect(body.meta.total).toBe(1);
      expect(body.meta.page).toBe(1);
    });

    it('retrieves school details including nested labs array via GET /schools/:schoolId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/schools/${seeded.schoolId}`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.schoolId).toBe(seeded.schoolId);
      expect(body.data.udiseCode).toBe('33100000001');
      expect(Array.isArray(body.data.labs)).toBe(true);
      // School A1-001 has TWO seeded labs
      expect(body.data.labs.length).toBe(2);
      const labCodes = body.data.labs.map((l: { labCode: string }) => l.labCode);
      expect(labCodes).toContain('DEMO-LAB-01');
      expect(labCodes).toContain('DEMO-LAB-02');
    });

    it('updates school details via PUT /schools/:schoolId', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/schools/${createdSchoolId}`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          schoolName: 'ZENTRA Government Model HSS Bhavani (Renamed)',
          hmName: 'Dr. K. Senthil Kumar PhD',
          isSpecialZone: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.schoolName).toBe('ZENTRA Government Model HSS Bhavani (Renamed)');
      expect(body.data.hmName).toBe('Dr. K. Senthil Kumar PhD');
      expect(body.data.isSpecialZone).toBe(true);
    });

    it('soft-deletes a school via DELETE /schools/:schoolId (sets is_active = false)', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/schools/${createdSchoolId}`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.isActive).toBe(false);

      // Verify in database that record still exists (no hard deletion)
      const inDb = await db
        .selectFrom('schools')
        .selectAll()
        .where('school_id', '=', createdSchoolId)
        .executeTakeFirst();

      expect(inDb).toBeDefined();
      expect(inDb?.is_active).toBe(false);
    });
  });

  // =========================================================================
  // 3. Hi-Tech Lab Multi-Lab Model & Operations
  // =========================================================================
  describe('3. Hi-Tech Lab Multi-Lab Model', () => {
    let createdLabId: string;

    it('verifies that 1 school supports multiple distinct labs (avoiding 1:1 fallacy)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/schools/${seeded.schoolId}/labs`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.length).toBe(2);

      const lab1 = body.data.find((l: { labCode: string }) => l.labCode === 'DEMO-LAB-01');
      const lab2 = body.data.find((l: { labCode: string }) => l.labCode === 'DEMO-LAB-02');

      expect(lab1).toBeDefined();
      expect(lab1.labType).toBe('PRIMARY');
      expect(lab1.activeComputersCount).toBe(20);

      expect(lab2).toBeDefined();
      expect(lab2.labType).toBe('ATAL_TINKERING');
      expect(lab2.activeComputersCount).toBe(15);
    });

    it('adds a third lab to an existing school via POST /schools/:schoolId/labs', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/schools/${seeded.schoolId}/labs`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          labCode: 'DEMO-LAB-03',
          labType: 'LANGUAGE_LAB',
          roomLocation: 'Language Center 2nd Floor',
          activeComputersCount: 16,
          commissioningDate: '2026-06-01',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data.labCode).toBe('DEMO-LAB-03');
      expect(body.data.labType).toBe('LANGUAGE_LAB');
      expect(body.data.activeComputersCount).toBe(16);
      expect(body.data.schoolId).toBe(seeded.schoolId);

      createdLabId = body.data.labId;
    });

    it('enforces uniqueness: rejects adding duplicate lab_code to the SAME school (409 Conflict)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/schools/${seeded.schoolId}/labs`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          labCode: 'DEMO-LAB-01', // Already exists in seeded.schoolId
          labType: 'PRIMARY',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.error.message).toContain('already exists');
    });

    it('allows identical lab_code across DIFFERENT schools (composite unique constraint)', async () => {
      // DEMO-LAB-01 already exists in School 1 and School 2; creating in School 3 should succeed
      const res = await app.inject({
        method: 'POST',
        url: `/schools/${seeded.secondSchoolId}/labs`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          labCode: 'DEMO-LAB-01', // Allowed in secondSchoolId where only DEMO-SAL-LAB-01 exists
          labType: 'PRIMARY',
          roomLocation: 'Block B IT Lab',
          activeComputersCount: 20,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data.labCode).toBe('DEMO-LAB-01');
      expect(body.data.schoolId).toBe(seeded.secondSchoolId);
    });

    it('retrieves lab details via GET /labs/:labId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/labs/${createdLabId}`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.labId).toBe(createdLabId);
      expect(body.data.labCode).toBe('DEMO-LAB-03');
    });

    it('updates lab metadata via PUT /labs/:labId', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/labs/${createdLabId}`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          activeComputersCount: 24,
          roomLocation: 'Renovated Language Center 2nd Floor',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.activeComputersCount).toBe(24);
      expect(body.data.roomLocation).toBe('Renovated Language Center 2nd Floor');
    });

    it('soft-deletes lab via DELETE /labs/:labId (preserves historical record)', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/labs/${createdLabId}`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.isActive).toBe(false);

      // Verify in DB that record still exists
      const inDb = await db
        .selectFrom('hi_tech_labs')
        .selectAll()
        .where('lab_id', '=', createdLabId)
        .executeTakeFirst();

      expect(inDb).toBeDefined();
      expect(inDb?.is_active).toBe(false);
    });
  });

  // =========================================================================
  // 4. RBAC & Multi-District Scoping Enforcement
  // =========================================================================
  describe('4. RBAC & Multi-District Scoping', () => {
    it('REPORTING_HEAD can read schools statewide but mutations are rejected with 403 Forbidden', async () => {
      // 1. Read statewide succeeds
      const readRes = await app.inject({
        method: 'GET',
        url: '/schools',
        headers: { authorization: `Bearer ${reportingHeadToken}` },
      });
      expect(readRes.statusCode).toBe(200);

      // 2. Mutation (POST /schools) is rejected with 403 Forbidden
      const createRes = await app.inject({
        method: 'POST',
        url: '/schools',
        headers: { authorization: `Bearer ${reportingHeadToken}` },
        payload: {
          udiseCode: '33100088888',
          schoolName: 'Unauthorized Create School',
          districtId: seeded.districtId,
          blockId: seeded.blockId,
        },
      });
      expect(createRes.statusCode).toBe(403);

      // 3. Mutation (PUT /schools/:id) is rejected with 403 Forbidden
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/schools/${seeded.schoolId}`,
        headers: { authorization: `Bearer ${reportingHeadToken}` },
        payload: { schoolName: 'Unauthorized Rename' },
      });
      expect(updateRes.statusCode).toBe(403);
    });

    it('non-administrative roles (FIELD_ENGINEER, HM, AI) can read assigned schools but mutations and unauthorized territory access are rejected with 403 Forbidden', async () => {
      // 1. Read assigned school succeeds for Field Engineer
      const readRes = await app.inject({
        method: 'GET',
        url: `/schools/${seeded.schoolId}`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
      });
      expect(readRes.statusCode).toBe(200);

      // 2. Mutation (DELETE /schools/:id) is rejected with 403 Forbidden for Field Engineer
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/schools/${seeded.schoolId}`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
      });
      expect(deleteRes.statusCode).toBe(403);

      // 3. Lab creation is rejected with 403 Forbidden for Field Engineer
      const createLabRes = await app.inject({
        method: 'POST',
        url: `/schools/${seeded.schoolId}/labs`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: { labCode: 'FE-UNAUTH-LAB' },
      });
      expect(createLabRes.statusCode).toBe(403);

      // 4. HM persona: read assigned territory school succeeds (Case A)
      const hmToken = tokenService.generateAccessToken({
        userId: seeded.userId, // Assigned to District A
        username: 'hm.demo@zentra.test',
        roles: ['HM'],
        activeRole: 'HM',
        territoryDistrictIds: [seeded.districtId],
      }).token;

      const hmReadRes = await app.inject({
        method: 'GET',
        url: `/schools/${seeded.schoolId}`,
        headers: { authorization: `Bearer ${hmToken}` },
      });
      expect(hmReadRes.statusCode).toBe(200);

      // 5. HM attempting administrative mutation is rejected with 403 Forbidden (Case E)
      const hmCreateRes = await app.inject({
        method: 'POST',
        url: '/schools',
        headers: { authorization: `Bearer ${hmToken}` },
        payload: {
          udiseCode: '33100099881',
          schoolName: 'HM Unauthorized School',
          districtId: seeded.districtId,
          blockId: seeded.blockId,
        },
      });
      expect(hmCreateRes.statusCode).toBe(403);

      // 6. HM attempting cross-territory access is rejected with 403 Forbidden (Cases B & F)
      const hmCrossRes = await app.inject({
        method: 'GET',
        url: `/schools?districtId=${seeded.secondDistrictId}`,
        headers: { authorization: `Bearer ${hmToken}` },
      });
      expect(hmCrossRes.statusCode).toBe(403);

      // 7. AI persona: mutation rejected with 403 Forbidden (Case E)
      const aiToken = tokenService.generateAccessToken({
        userId: seeded.userId,
        username: 'ai.demo@zentra.test',
        roles: ['AI'],
        activeRole: 'AI',
        territoryDistrictIds: [seeded.districtId],
      }).token;

      const aiMutateRes = await app.inject({
        method: 'PUT',
        url: `/schools/${seeded.schoolId}`,
        headers: { authorization: `Bearer ${aiToken}` },
        payload: { schoolName: 'AI Renamed' },
      });
      expect(aiMutateRes.statusCode).toBe(403);

      // 8. AI attempting cross-territory access rejected with 403 Forbidden (Cases D & F)
      const aiCrossRes = await app.inject({
        method: 'GET',
        url: `/schools?districtId=${seeded.secondDistrictId}`,
        headers: { authorization: `Bearer ${aiToken}` },
      });
      expect(aiCrossRes.statusCode).toBe(403);
    });

    it('DISTRICT_COORDINATOR can mutate schools within assigned district', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/schools',
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
        payload: {
          udiseCode: '33100077777',
          schoolName: 'Erode Coordinator Authorized School',
          districtId: seeded.districtId, // Assigned to Erode Coordinator
          blockId: seeded.blockId,
          schoolCategory: 'High School',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data.schoolName).toBe('Erode Coordinator Authorized School');
    });

    it('DISTRICT_COORDINATOR cannot mutate schools outside assigned district (403 Forbidden)', async () => {
      // Erode Coordinator attempting to create a school in Salem (District B)
      const res = await app.inject({
        method: 'POST',
        url: '/schools',
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
        payload: {
          udiseCode: '33100066666',
          schoolName: 'Cross-District Breach Attempt School',
          districtId: seeded.secondDistrictId, // Salem district (NOT assigned to Erode Coordinator)
          blockId: seeded.secondBlockId,
          schoolCategory: 'High School',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.error.message).toContain('not authorized to mutate school');
    });

    it('DISTRICT_COORDINATOR cannot mutate labs in other districts (403 Forbidden)', async () => {
      // Erode Coordinator attempting to add a lab to Salem school
      const res = await app.inject({
        method: 'POST',
        url: `/schools/${seeded.secondSchoolId}/labs`,
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
        payload: {
          labCode: 'SALEM-BREACH-LAB',
          labType: 'PRIMARY',
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // 5. PostgreSQL Kernel Row-Level Security (RLS) Isolation
  // =========================================================================
  describe('5. PostgreSQL Kernel Row-Level Security (RLS) Isolation', () => {
    it('District Coordinator context restricts SQL queries strictly to assigned district schools', async () => {
      const erodeSchools = await rlsService.withSecurityContext(
        { userId: seeded.erodeCoordinatorUserId, role: 'DISTRICT_COORDINATOR' },
        async (trx) => {
          return await trx.selectFrom('schools').selectAll().execute();
        },
      );

      expect(erodeSchools.length).toBeGreaterThan(0);
      for (const s of erodeSchools) {
        expect(s.district_id).toBe(seeded.districtId);
        expect(s.district_id).not.toBe(seeded.secondDistrictId);
      }
    });

    it('Salem Coordinator context restricts SQL queries strictly to Salem district schools', async () => {
      const salemSchools = await rlsService.withSecurityContext(
        { userId: seeded.salemCoordinatorUserId, role: 'DISTRICT_COORDINATOR' },
        async (trx) => {
          return await trx.selectFrom('schools').selectAll().execute();
        },
      );

      expect(salemSchools.length).toBeGreaterThan(0);
      for (const s of salemSchools) {
        expect(s.district_id).toBe(seeded.secondDistrictId);
        expect(s.district_id).not.toBe(seeded.districtId);
      }
    });

    it('hi_tech_labs table enforces RLS territory isolation joining parent school', async () => {
      const erodeLabs = await rlsService.withSecurityContext(
        { userId: seeded.erodeCoordinatorUserId, role: 'DISTRICT_COORDINATOR' },
        async (trx) => {
          return await trx.selectFrom('hi_tech_labs').selectAll().execute();
        },
      );

      expect(erodeLabs.length).toBeGreaterThan(0);
      // All visible labs must belong to schools in District A
      const labSchoolIds = erodeLabs.map((l) => l.school_id);
      expect(labSchoolIds).not.toContain(seeded.secondSchoolId);
    });

    it('MASTER_ADMIN context can query schools and labs across all districts', async () => {
      const allSchools = await rlsService.withSecurityContext(
        { userId: seeded.adminUserId, role: 'MASTER_ADMIN' },
        async (trx) => {
          return await trx.selectFrom('schools').selectAll().execute();
        },
      );

      const districtIds = allSchools.map((s) => s.district_id);
      expect(districtIds).toContain(seeded.districtId);
      expect(districtIds).toContain(seeded.secondDistrictId);
    });
  });

  // =========================================================================
  // 6. Immutable Audit Trail Logging
  // =========================================================================
  describe('6. Immutable Audit Trail Logging', () => {
    it('verifies audit_events entries were recorded for school and lab operations', async () => {
      const events = await db
        .selectFrom('audit_events')
        .selectAll()
        .where('action_type', 'in', [
          'SCHOOL_CREATED',
          'SCHOOL_UPDATED',
          'SCHOOL_DEACTIVATED',
          'LAB_CREATED',
          'LAB_UPDATED',
          'LAB_DEACTIVATED',
        ])
        .execute();

      expect(events.length).toBeGreaterThan(0);

      const actionTypes = events.map((e) => e.action_type);
      expect(actionTypes).toContain('SCHOOL_CREATED');
      expect(actionTypes).toContain('SCHOOL_UPDATED');
      expect(actionTypes).toContain('SCHOOL_DEACTIVATED');
      expect(actionTypes).toContain('LAB_CREATED');
      expect(actionTypes).toContain('LAB_UPDATED');
      expect(actionTypes).toContain('LAB_DEACTIVATED');

      // Verify that actor_user_id and target_entity_type are properly set
      for (const event of events) {
        expect(event.actor_user_id).toBeDefined();
        expect(['schools', 'hi_tech_labs']).toContain(event.target_entity_type);
        expect(event.event_category).toBe('ADMINISTRATIVE');
      }
    });
  });
});

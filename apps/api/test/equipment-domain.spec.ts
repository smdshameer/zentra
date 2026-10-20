/**
 * ZENTRA — Phase 7 Equipment Master & Dynamic Attribute Engine Integration Tests
 * apps/api/test/equipment-domain.spec.ts
 *
 * Comprehensive End-to-End & Integration Suite covering:
 * 1. OEM Manufacturers Master (CRUD, unique name/code, soft-deletion, RBAC)
 * 2. Equipment Types & Dynamic Attribute Definitions (CRUD, data types, dropdown validation, composite unique)
 * 3. Dynamic Attribute Engine (Strict type validation: TEXT, NUMBER, BOOLEAN, DROPDOWN, required fields, no silent coercion)
 * 4. Lab Equipment Instances (Creation, hierarchy resolution, dynamic attribute validation, updates, soft-deletion)
 * 5. Multi-District Territory Scoping & Authorization (Master Admin, Reporting Head, District Coordinator, Field Engineer)
 * 6. PostgreSQL Kernel Row-Level Security (RLS isolation on lab_equipment table)
 * 7. Administrative Audit Logging (Administrative Audit Logging for all mutations)
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
import { RlsService } from '../src/modules/auth/rls.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { generateUuidV7 } from '@zentra/shared';
import { assertTestEnvironmentIsSafe, assertTestDatabaseIsSafe } from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zentra_test';

describe('ZENTRA Phase 7 — Equipment Master & Dynamic Attribute Engine Integration', () => {
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

    seeded = await seedSyntheticDevelopmentFixtures(db);

    tokenService = new TokenService();
    rlsService = new RlsService(db);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    masterAdminToken = tokenService.generateAccessToken({
      userId: seeded.adminUserId,
      username: 'admin.demo@zentra.test',
      roles: ['MASTER_ADMIN'],
      activeRole: 'MASTER_ADMIN',
      territoryDistrictIds: [],
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
  // 1. OEM Manufacturers Master
  // =========================================================================
  describe('1. OEM Manufacturers Master', () => {
    let createdOemId: string;

    it('lists all OEMs via GET /oems for authenticated users', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/oems',
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].oemName).toContain('ZENTRA Demo OEM');
    });

    it('retrieves an OEM by ID via GET /oems/:id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/oems/${seeded.oemId}`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.oemId).toBe(seeded.oemId);
      expect(body.data.oemCode).toBe('DEMO_OEM');
    });

    it('creates a new OEM as MASTER_ADMIN via POST /oems', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/oems',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          oemName: 'Delta Power Electronics',
          oemCode: 'DELTA_PWR',
          supportContactInfo: 'support@deltapower.test',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.oemName).toBe('Delta Power Electronics');
      expect(body.data.oemCode).toBe('DELTA_PWR');
      expect(body.data.isActive).toBe(true);
      createdOemId = body.data.oemId;
    });

    it('enforces uniqueness on oem_name (409 Conflict)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/oems',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          oemName: 'Delta Power Electronics',
          oemCode: 'DELTA_NEW',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.error.message).toContain('already exists');
    });

    it('enforces uniqueness on oem_code (409 Conflict)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/oems',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          oemName: 'Different Delta Brand',
          oemCode: 'DELTA_PWR',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.error.message).toContain('already exists');
    });

    it('rejects non-admin roles from creating OEMs (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/oems',
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
        payload: {
          oemName: 'Unauthorized Brand Inc',
          oemCode: 'UNAUTH_OEM',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('updates an OEM as MASTER_ADMIN via PATCH /oems/:id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/oems/${createdOemId}`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          supportContactInfo: 'updated-support@deltapower.test',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.supportContactInfo).toBe('updated-support@deltapower.test');
    });

    it('soft-deactivates an OEM via DELETE /oems/:id', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/oems/${createdOemId}`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.isActive).toBe(false);

      // Verify in DB that it is soft-deleted, not removed
      const row = await db
        .selectFrom('oem_manufacturers')
        .select('is_active')
        .where('oem_id', '=', createdOemId)
        .executeTakeFirst();
      expect(row?.is_active).toBe(false);
    });
  });

  // =========================================================================
  // 2. Equipment Types & Dynamic Attribute Definitions
  // =========================================================================
  describe('2. Equipment Types & Attribute Definitions', () => {
    let createdTypeId: string;
    let textAttrId: string;
    let numberAttrId: string;
    let booleanAttrId: string;
    let dropdownAttrId: string;

    it('lists all equipment types via GET /equipment-types', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/equipment-types',
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.some((t: any) => t.typeCode === 'DEMO_UPS')).toBe(true);
    });

    it('creates an equipment type as MASTER_ADMIN via POST /equipment-types', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment-types',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          typeCode: 'HIGH_END_ROUTER',
          typeName: 'Core Network Router',
          description: 'Gigabit Layer-3 Managed Switch / Router',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.typeCode).toBe('HIGH_END_ROUTER');
      createdTypeId = body.data.equipmentTypeId;
    });

    it('enforces uniqueness on equipment type_code (409 Conflict)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment-types',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          typeCode: 'HIGH_END_ROUTER',
          typeName: 'Duplicate Router Type',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.error.message).toContain('already exists');
    });

    it('rejects non-admin roles from creating equipment types (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment-types',
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
        payload: {
          typeCode: 'PROJECTOR_SMART',
          typeName: 'Interactive Projector',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('creates a TEXT dynamic attribute definition', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/equipment-types/${createdTypeId}/attributes`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          attributeKey: 'management_ip',
          attributeLabel: 'Management IP Address',
          dataType: 'TEXT',
          isDiagnosticField: true,
          isRequired: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.attributeKey).toBe('management_ip');
      expect(body.data.dataType).toBe('TEXT');
      expect(body.data.isRequired).toBe(true);
      textAttrId = body.data.attributeDefId;
    });

    it('creates a NUMBER dynamic attribute definition', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/equipment-types/${createdTypeId}/attributes`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          attributeKey: 'port_count',
          attributeLabel: 'Number of Active Ports',
          dataType: 'NUMBER',
          isDiagnosticField: false,
          isRequired: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.dataType).toBe('NUMBER');
      numberAttrId = body.data.attributeDefId;
    });

    it('creates a BOOLEAN dynamic attribute definition', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/equipment-types/${createdTypeId}/attributes`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          attributeKey: 'supports_poe',
          attributeLabel: 'Supports Power over Ethernet (PoE)',
          dataType: 'BOOLEAN',
          isDiagnosticField: false,
          isRequired: false,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.dataType).toBe('BOOLEAN');
      booleanAttrId = body.data.attributeDefId;
    });

    it('creates a DROPDOWN dynamic attribute definition with valid options', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/equipment-types/${createdTypeId}/attributes`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          attributeKey: 'firmware_status',
          attributeLabel: 'Firmware Compliance Status',
          dataType: 'DROPDOWN',
          dropdownOptions: ['UP_TO_DATE', 'UPDATE_PENDING', 'DEPRECATED'],
          isDiagnosticField: true,
          isRequired: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.dataType).toBe('DROPDOWN');
      expect(body.data.dropdownOptions).toEqual(['UP_TO_DATE', 'UPDATE_PENDING', 'DEPRECATED']);
      dropdownAttrId = body.data.attributeDefId;
    });

    it('rejects a DROPDOWN attribute definition when dropdownOptions is empty or missing (400 Bad Request)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/equipment-types/${createdTypeId}/attributes`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          attributeKey: 'invalid_dropdown',
          attributeLabel: 'Invalid Dropdown Def',
          dataType: 'DROPDOWN',
          dropdownOptions: [],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects duplicate attribute_key within the same equipment type (409 Conflict)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/equipment-types/${createdTypeId}/attributes`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          attributeKey: 'management_ip',
          attributeLabel: 'Duplicate IP Label',
          dataType: 'TEXT',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.error.message).toContain('already exists');
    });

    it('lists all attribute definitions for the equipment type via GET /equipment-types/:id/attributes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/equipment-types/${createdTypeId}/attributes`,
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(4);
      const keys = body.data.map((a: any) => a.attributeKey);
      expect(keys).toContain('management_ip');
      expect(keys).toContain('port_count');
      expect(keys).toContain('supports_poe');
      expect(keys).toContain('firmware_status');
    });

    it('updates an attribute definition as MASTER_ADMIN via PATCH', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/equipment-types/${createdTypeId}/attributes/${textAttrId}`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          attributeLabel: 'Primary Management IPv4',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.attributeLabel).toBe('Primary Management IPv4');
    });

    it('safely deletes an unused attribute definition via DELETE /equipment-types/:id/attributes/:attrId', async () => {
      // 1. Create temporary unreferenced attribute
      const createRes = await app.inject({
        method: 'POST',
        url: `/equipment-types/${createdTypeId}/attributes`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          attributeKey: 'temp_debug_flag',
          attributeLabel: 'Temporary Debug Flag',
          dataType: 'BOOLEAN',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const tempAttrId = JSON.parse(createRes.payload).data.attributeDefId;

      // 2. Delete it while unreferenced
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/equipment-types/${createdTypeId}/attributes/${tempAttrId}`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });
      expect(delRes.statusCode).toBe(200);
      expect(JSON.parse(delRes.payload).success).toBe(true);
    });

    it('prevents deletion of an attribute definition when existing equipment records reference it in custom_attributes (409 Conflict)', async () => {
      // 1. Create an attribute definition
      const attrRes = await app.inject({
        method: 'POST',
        url: `/equipment-types/${createdTypeId}/attributes`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          attributeKey: 'active_vlan_tag',
          attributeLabel: 'Active VLAN Tag',
          dataType: 'NUMBER',
        },
      });
      expect(attrRes.statusCode).toBe(201);
      const vlanAttrId = JSON.parse(attrRes.payload).data.attributeDefId;

      // 2. Create equipment record that uses this attribute
      const equipRes = await app.inject({
        method: 'POST',
        url: '/equipment',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          labId: seeded.labId,
          equipmentTypeId: createdTypeId,
          serialNumber: 'ROUTER-VLAN-TEST',
          customAttributes: {
            management_ip: '10.0.0.1',
            port_count: 24,
            firmware_status: 'UP_TO_DATE',
            active_vlan_tag: 100,
          },
        },
      });
      expect(equipRes.statusCode).toBe(201);

      // 3. Attempt to delete the attribute definition - MUST fail with 409 Conflict
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/equipment-types/${createdTypeId}/attributes/${vlanAttrId}`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(delRes.statusCode).toBe(409);
      const err = JSON.parse(delRes.payload);
      expect(err.error.message).toContain('actively referenced by 1 equipment record(s)');
      expect(err.error.message).toContain('Historical equipment data must not lose its authoritative definition');

      // 4. Verify attribute definition still exists in the database
      const checkRow = await db
        .selectFrom('equipment_attribute_definitions')
        .select('attribute_def_id')
        .where('attribute_def_id', '=', vlanAttrId)
        .executeTakeFirst();
      expect(checkRow).toBeDefined();
    });
  });

  // =========================================================================
  // 3. Dynamic Attribute Engine Validation
  // =========================================================================
  describe('3. Dynamic Attribute Engine Validation', () => {
    let testTypeId: string;

    beforeAll(async () => {
      testTypeId = generateUuidV7();
      await db
        .insertInto('equipment_types')
        .values({
          equipment_type_id: testTypeId,
          type_code: 'VAL_TEST_DEVICE',
          type_name: 'Validation Test Device',
          is_active: true,
        })
        .execute();

      await db
        .insertInto('equipment_attribute_definitions')
        .values([
          {
            attribute_def_id: generateUuidV7(),
            equipment_type_id: testTypeId,
            attribute_key: 'req_num',
            attribute_label: 'Required Number',
            data_type: 'NUMBER',
            is_required: true,
          },
          {
            attribute_def_id: generateUuidV7(),
            equipment_type_id: testTypeId,
            attribute_key: 'opt_bool',
            attribute_label: 'Optional Boolean',
            data_type: 'BOOLEAN',
            is_required: false,
          },
          {
            attribute_def_id: generateUuidV7(),
            equipment_type_id: testTypeId,
            attribute_key: 'req_dropdown',
            attribute_label: 'Required Dropdown',
            data_type: 'DROPDOWN',
            dropdown_options: JSON.stringify(['ALPHA', 'BETA', 'GAMMA']),
            is_required: true,
          },
          {
            attribute_def_id: generateUuidV7(),
            equipment_type_id: testTypeId,
            attribute_key: 'req_text',
            attribute_label: 'Required Text',
            data_type: 'TEXT',
            is_required: true,
          },
        ])
        .execute();
    });

    it('validates dynamic attributes via POST /equipment/validate-attributes with valid payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment/validate-attributes',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          equipmentTypeId: testTypeId,
          customAttributes: {
            req_num: 42,
            opt_bool: true,
            req_dropdown: 'ALPHA',
            req_text: 'Sample description',
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.isValid).toBe(true);
      expect(body.data.errors.length).toBe(0);
    });

    it('detects missing required fields in dynamic attributes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment/validate-attributes',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          equipmentTypeId: testTypeId,
          customAttributes: {
            opt_bool: false,
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data.isValid).toBe(false);
      expect(body.data.errors.some((e: string) => e.includes('req_num'))).toBe(true);
      expect(body.data.errors.some((e: string) => e.includes('req_dropdown'))).toBe(true);
      expect(body.data.errors.some((e: string) => e.includes('req_text'))).toBe(true);
    });

    it('rejects invalid types: non-numeric string for NUMBER (no coercion)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment/validate-attributes',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          equipmentTypeId: testTypeId,
          customAttributes: {
            req_num: 'not-a-number',
            req_dropdown: 'ALPHA',
            req_text: 'Valid text',
          },
        },
      });

      const body = JSON.parse(res.payload);
      expect(body.data.isValid).toBe(false);
      expect(body.data.errors.some((e: string) => e.includes('must be a valid finite number'))).toBe(true);
    });

    it('rejects invalid types: numeric string for NUMBER without coercion', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment/validate-attributes',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          equipmentTypeId: testTypeId,
          customAttributes: {
            req_num: '100', // string, should NOT be coerced
            req_dropdown: 'ALPHA',
            req_text: 'Valid text',
          },
        },
      });

      const body = JSON.parse(res.payload);
      expect(body.data.isValid).toBe(false);
      expect(body.data.errors.some((e: string) => e.includes('must be a valid finite number'))).toBe(true);
    });

    it('rejects invalid types: non-boolean value for BOOLEAN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment/validate-attributes',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          equipmentTypeId: testTypeId,
          customAttributes: {
            req_num: 50,
            opt_bool: 'true', // string, should not be accepted
            req_dropdown: 'ALPHA',
            req_text: 'Valid text',
          },
        },
      });

      const body = JSON.parse(res.payload);
      expect(body.data.isValid).toBe(false);
      expect(body.data.errors.some((e: string) => e.includes('must be a boolean'))).toBe(true);
    });

    it('rejects unlisted dropdown values for DROPDOWN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment/validate-attributes',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          equipmentTypeId: testTypeId,
          customAttributes: {
            req_num: 50,
            req_dropdown: 'OMEGA', // not in ALPHA, BETA, GAMMA
            req_text: 'Valid text',
          },
        },
      });

      const body = JSON.parse(res.payload);
      expect(body.data.isValid).toBe(false);
      expect(body.data.errors.some((e: string) => e.includes('has invalid value \'OMEGA\''))).toBe(true);
    });
  });

  // =========================================================================
  // 4. Lab Equipment Instances & Territory Scoping
  // =========================================================================
  describe('4. Lab Equipment Instances & Territory Scoping', () => {
    let erodeEquipmentId: string;
    let salemEquipmentId: string;

    it('creates an equipment instance in Erode district by Erode Coordinator', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment',
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
        payload: {
          labId: seeded.labId, // Lab in School 1 (Erode)
          equipmentTypeId: seeded.equipmentTypeId,
          oemId: seeded.oemId,
          modelNumber: 'UPS-5KVA-ONLINE',
          serialNumber: 'ERODE-UPS-001',
          assetBarcode: 'BC-ERODE-001',
          operationalCondition: 'OPERATIONAL',
          customAttributes: {
            battery_bank_voltage: 52,
            battery_health_status: 'OPTIMAL',
            bypass_switch_present: true,
            firmware_version: 'v3.0.0',
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.serialNumber).toBe('ERODE-UPS-001');
      expect(body.data.districtId).toBe(seeded.districtId);
      erodeEquipmentId = body.data.labEquipmentId;
    });

    it('creates an equipment instance in Salem district by Master Admin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          labId: seeded.secondLabId, // Lab in School 2 (Salem)
          equipmentTypeId: seeded.equipmentTypeId,
          oemId: seeded.oemId,
          modelNumber: 'UPS-5KVA-ONLINE',
          serialNumber: 'SALEM-UPS-001',
          assetBarcode: 'BC-SALEM-001',
          operationalCondition: 'OPERATIONAL',
          customAttributes: {
            battery_bank_voltage: 48,
            battery_health_status: 'OPTIMAL',
            bypass_switch_present: false,
            firmware_version: 'v2.9.0',
          },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.districtId).toBe(seeded.secondDistrictId);
      salemEquipmentId = body.data.labEquipmentId;
    });

    it('rejects Erode coordinator from creating equipment in Salem district (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment',
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
        payload: {
          labId: seeded.secondLabId, // Salem Lab
          equipmentTypeId: seeded.equipmentTypeId,
          modelNumber: 'ROGUE-DEVICE',
          customAttributes: {
            battery_bank_voltage: 48,
          },
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.error.message).toContain('territorial authorization');
    });

    it('rejects equipment creation when dynamic attribute validation fails (400 Bad Request)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment',
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
        payload: {
          labId: seeded.labId,
          equipmentTypeId: seeded.equipmentTypeId,
          modelNumber: 'FAILING-VAL',
          customAttributes: {
            // Missing required battery_bank_voltage
            battery_health_status: 'INVALID_STATUS',
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error.message).toContain('validation failed');
    });

    it('retrieves equipment details by ID with relational hierarchy metadata', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/equipment/${erodeEquipmentId}`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.labEquipmentId).toBe(erodeEquipmentId);
      expect(body.data.schoolName).toBeDefined();
      expect(body.data.districtName).toBeDefined();
      expect(body.data.typeName).toBeDefined();
      expect(body.data.typeCode).toBe('DEMO_UPS');
    });

    it('lists equipment with pagination and filters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/equipment?equipmentTypeId=${seeded.equipmentTypeId}&page=1&limit=10`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta.page).toBe(1);
      expect(body.meta.limit).toBe(10);
      expect(body.meta.total).toBeGreaterThanOrEqual(2);
    });

    it('updates an equipment instance and merges custom attributes', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/equipment/${erodeEquipmentId}`,
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
        payload: {
          operationalCondition: 'DEGRADED',
          customAttributes: {
            battery_health_status: 'DEGRADED',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.operationalCondition).toBe('DEGRADED');
      expect(body.data.customAttributes.battery_health_status).toBe('DEGRADED');
      // Preserved unchanged custom attributes
      expect(body.data.customAttributes.battery_bank_voltage).toBe(52);
    });

    it('rejects Erode coordinator from updating Salem equipment (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/equipment/${salemEquipmentId}`,
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
        payload: {
          operationalCondition: 'NON_OPERATIONAL',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('allows soft-deactivation of equipment by District Coordinator in territory', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/equipment/${erodeEquipmentId}`,
        headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.isActive).toBe(false);

      // Verify soft-deactivation in database
      const row = await db
        .selectFrom('lab_equipment')
        .select('is_active')
        .where('lab_equipment_id', '=', erodeEquipmentId)
        .executeTakeFirst();
      expect(row?.is_active).toBe(false);
    });

    it('rejects Field Engineer from deleting equipment (403 Forbidden: only admin/coordinator permitted)', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/equipment/${salemEquipmentId}`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('allows Field Engineer to create equipment within assigned territory (Erode)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment',
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          labId: seeded.labId, // Erode Lab
          equipmentTypeId: seeded.equipmentTypeId,
          serialNumber: 'FE-ERODE-ASSET-01',
          operationalCondition: 'OPERATIONAL',
          customAttributes: { battery_bank_voltage: 50 },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.serialNumber).toBe('FE-ERODE-ASSET-01');
      expect(body.data.districtId).toBe(seeded.districtId);
    });

    it('allows Field Engineer to update equipment within assigned territory (Erode)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/equipment/${erodeEquipmentId}`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          operationalCondition: 'OPERATIONAL',
          customAttributes: { battery_health_status: 'OPTIMAL' },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.operationalCondition).toBe('OPERATIONAL');
    });

    it('rejects Field Engineer from creating equipment outside assigned territory in Salem (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/equipment',
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          labId: seeded.secondLabId, // Salem Lab
          equipmentTypeId: seeded.equipmentTypeId,
          serialNumber: 'FE-CROSS-TERRITORY-FAIL',
          customAttributes: { battery_bank_voltage: 48 },
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.error.message).toContain('territorial authorization');
    });

    it('rejects Field Engineer from updating equipment outside assigned territory in Salem (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/equipment/${salemEquipmentId}`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          operationalCondition: 'CRITICAL_FAULT',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.error.message).toContain('territorial authorization');
    });

    it('verifies non-unique serial_number and asset_barcode do not trigger DB constraint crashes', async () => {
      // Both equipment instances share serial 'NON_UNIQUE_SN_123'
      const first = await app.inject({
        method: 'POST',
        url: '/equipment',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          labId: seeded.labId,
          equipmentTypeId: seeded.equipmentTypeId,
          serialNumber: 'NON_UNIQUE_SN_123',
          assetBarcode: 'NON_UNIQUE_BC_456',
          customAttributes: { battery_bank_voltage: 48 },
        },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: '/equipment',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          labId: seeded.secondLabId,
          equipmentTypeId: seeded.equipmentTypeId,
          serialNumber: 'NON_UNIQUE_SN_123', // Identical serial
          assetBarcode: 'NON_UNIQUE_BC_456', // Identical barcode
          customAttributes: { battery_bank_voltage: 48 },
        },
      });
      expect(second.statusCode).toBe(201);
    });
  });

  // =========================================================================
  // 5. PostgreSQL Kernel Row-Level Security (RLS) Isolation
  // =========================================================================
  describe('5. PostgreSQL Kernel Row-Level Security (RLS)', () => {
    it('enforces RLS: Erode coordinator sees only Erode equipment, zero Salem equipment', async () => {
      const results = await rlsService.withSecurityContext(
        { userId: seeded.erodeCoordinatorUserId, role: 'DISTRICT_COORDINATOR' },
        async (trx) => {
          return await trx
            .selectFrom('lab_equipment')
            .innerJoin('hi_tech_labs', 'hi_tech_labs.lab_id', 'lab_equipment.lab_id')
            .innerJoin('schools', 'schools.school_id', 'hi_tech_labs.school_id')
            .select(['lab_equipment.lab_equipment_id', 'schools.district_id'])
            .execute();
        },
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      // Every equipment visible MUST belong to Erode
      for (const item of results) {
        expect(item.district_id).toBe(seeded.districtId);
        expect(item.district_id).not.toBe(seeded.secondDistrictId);
      }
    });

    it('enforces RLS: Salem coordinator sees only Salem equipment, zero Erode equipment', async () => {
      const results = await rlsService.withSecurityContext(
        { userId: seeded.salemCoordinatorUserId, role: 'DISTRICT_COORDINATOR' },
        async (trx) => {
          return await trx
            .selectFrom('lab_equipment')
            .innerJoin('hi_tech_labs', 'hi_tech_labs.lab_id', 'lab_equipment.lab_id')
            .innerJoin('schools', 'schools.school_id', 'hi_tech_labs.school_id')
            .select(['lab_equipment.lab_equipment_id', 'schools.district_id'])
            .execute();
        },
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      // Every equipment visible MUST belong to Salem
      for (const item of results) {
        expect(item.district_id).toBe(seeded.secondDistrictId);
        expect(item.district_id).not.toBe(seeded.districtId);
      }
    });

    it('enforces RLS: Master Admin sees statewide equipment across multiple districts', async () => {
      const results = await rlsService.withSecurityContext(
        { userId: seeded.adminUserId, role: 'MASTER_ADMIN' },
        async (trx) => {
          return await trx
            .selectFrom('lab_equipment')
            .innerJoin('hi_tech_labs', 'hi_tech_labs.lab_id', 'lab_equipment.lab_id')
            .innerJoin('schools', 'schools.school_id', 'hi_tech_labs.school_id')
            .select(['lab_equipment.lab_equipment_id', 'schools.district_id'])
            .execute();
        },
      );

      const districtIds = results.map((r) => r.district_id);
      expect(districtIds).toContain(seeded.districtId);
      expect(districtIds).toContain(seeded.secondDistrictId);
    });

    it('enforces RLS: Reporting Head sees statewide equipment across multiple districts', async () => {
      const results = await rlsService.withSecurityContext(
        { userId: seeded.reportingHeadUserId, role: 'REPORTING_HEAD' },
        async (trx) => {
          return await trx
            .selectFrom('lab_equipment')
            .innerJoin('hi_tech_labs', 'hi_tech_labs.lab_id', 'lab_equipment.lab_id')
            .innerJoin('schools', 'schools.school_id', 'hi_tech_labs.school_id')
            .select(['lab_equipment.lab_equipment_id', 'schools.district_id'])
            .execute();
        },
      );

      const districtIds = results.map((r) => r.district_id);
      expect(districtIds).toContain(seeded.districtId);
      expect(districtIds).toContain(seeded.secondDistrictId);
    });

    it('enforces RLS fail-closed: querying without security context returns 0 equipment rows', async () => {
      const results = await rlsService.withSecurityContext(
        { userId: null, role: null },
        async (trx) => {
          return await trx
            .selectFrom('lab_equipment')
            .select('lab_equipment_id')
            .execute();
        },
      );

      expect(results.length).toBe(0);
    });
  });

  // =========================================================================
  // 6. Administrative Audit Logging
  // =========================================================================
  describe('6. Administrative Audit Logging', () => {
    it('verifies mutating equipment operations emit ADMINISTRATIVE audit logs', async () => {
      const logs = await db
        .selectFrom('audit_events')
        .selectAll()
        .where('event_category', '=', 'ADMINISTRATIVE')
        .where('target_entity_type', 'in', ['lab_equipment', 'oem_manufacturers', 'equipment_types', 'equipment_attribute_definitions'])
        .orderBy('event_timestamp', 'desc')
        .execute();

      expect(logs.length).toBeGreaterThanOrEqual(5);

      const actionTypes = logs.map((l) => l.action_type);
      expect(actionTypes).toContain('EQUIPMENT_CREATED');
      expect(actionTypes).toContain('EQUIPMENT_UPDATED');
      expect(actionTypes).toContain('EQUIPMENT_DEACTIVATED');
      expect(actionTypes).toContain('OEM_CREATED');
      expect(actionTypes).toContain('EQUIPMENT_TYPE_CREATED');

      // Verify all logged actor_user_id values are populated
      for (const log of logs) {
        expect(log.actor_user_id).toBeDefined();
        expect(log.event_category).toBe('ADMINISTRATIVE');
      }
    });
  });
});

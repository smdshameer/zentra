/**
 * ZENTRA — Database Schema & Domain Model Integration Tests
 * apps/api/test/database-schema.spec.ts
 *
 * Verifies the authoritative PostgreSQL database foundation:
 * - 21 Domain Tables
 * - Relational Foreign Key Integrity
 * - Unique & Check Constraints
 * - Source Complaint vs Service Case Segregation
 * - Multi-Visit Support
 * - Slot 1 & Slot 2 Evidence Metadata Isolation
 * - JSONB Custom Attributes
 * - Soft-Deletes & Tombstone Monotonic Cursor
 * - Migration Rollback and Re-apply
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types';
import { createDatabaseConnection } from '../src/database/database.connection';
import { runMigrationsToLatest, rollbackLatestMigration } from '../src/database/migration-runner';
import {
  setupDisposableIntegrationHarness,
  DISPOSABLE_INTEGRATION_TEST_DATABASE,
} from '@zentra/testing';
import { generateUuidV7 } from '@zentra/shared';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  `postgresql://postgres:postgres@localhost:5432/${DISPOSABLE_INTEGRATION_TEST_DATABASE}`;

describe('ZENTRA PostgreSQL Database & Domain Foundation Tests', () => {
  let db: Kysely<DatabaseSchema>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;

    const harness = await setupDisposableIntegrationHarness(
      TEST_DB_URL,
      createDatabaseConnection,
      runMigrationsToLatest,
    );
    db = harness.db;
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  // 1. Clean Migration Verification
  it('1. Clean migration succeeds and all 21 domain tables exist', async () => {
    const tables = await db.introspection.getTables();
    const tableNames = tables.map((t) => t.name);

    const expectedTables = [
      'districts',
      'blocks',
      'schools',
      'hi_tech_labs',
      'oem_manufacturers',
      'equipment_types',
      'equipment_attribute_definitions',
      'lab_equipment',
      'users',
      'complaint_sources',
      'source_complaints',
      'sla_policies',
      'service_cases',
      'assignment_history',
      'field_visits',
      'visit_equipment_findings',
      'evidence_files',
      'import_jobs',
      'import_staging_records',
      'audit_events',
      'tombstones',
    ];

    for (const expected of expectedTables) {
      expect(tableNames).toContain(expected);
    }
  });

  // 2. Migration State is Correct
  it('2. Migration state records all 5 migrations as executed in kysely_migration table', async () => {
    const executedMigrations = await db
      .selectFrom('kysely_migration' as any)
      .selectAll()
      .execute();

    expect(executedMigrations.length).toBeGreaterThanOrEqual(5);
    const names = (executedMigrations as any[]).map((m) => m.name);
    expect(names).toContain('20261005000001_create_territory_and_schools');
    expect(names).toContain('20261005000002_create_equipment_master');
    expect(names).toContain('20261005000003_create_complaints_and_service_cases');
    expect(names).toContain('20261005000004_create_visits_evidence_and_findings');
    expect(names).toContain('20261005000005_create_governance_staging_and_audit');
    expect(names).toContain('20261007000001_create_auth_and_rbac');
    expect(names).toContain('20261007000002_create_hi_tech_labs_rls');
    expect(names).toContain('20261007000003_create_lab_equipment_rls');
  });

  // 3. District -> Block Relationship
  it('3. District -> Block relationship enforces relational integrity', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'Test District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_01',
        block_name: 'Test Block North',
      })
      .execute();

    const fetchedBlock = await db
      .selectFrom('blocks')
      .where('block_id', '=', blockId)
      .selectAll()
      .executeTakeFirstOrThrow();

    expect(fetchedBlock.district_id).toBe(districtId);
    expect(fetchedBlock.block_name).toBe('Test Block North');
  });

  // 4. Block -> School Relationship
  it('4. Block -> School relationship works with valid foreign keys', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const schoolId = generateUuidV7();
    const udise = `33${Date.now().toString().slice(-9)}`;

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'School Test District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_SCH',
        block_name: 'School Test Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: schoolId,
        udise_code: udise,
        school_name: 'Government Higher Secondary School Test',
        district_id: districtId,
        block_id: blockId,
        school_category: 'GHSS',
      })
      .execute();

    const fetchedSchool = await db
      .selectFrom('schools')
      .where('school_id', '=', schoolId)
      .selectAll()
      .executeTakeFirstOrThrow();

    expect(fetchedSchool.udise_code).toBe(udise);
    expect(fetchedSchool.block_id).toBe(blockId);
  });

  // 5. School -> Lab Relationship (Multi-lab support)
  it('5. School -> Lab relationship supports multiple labs per school', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const schoolId = generateUuidV7();
    const lab1Id = generateUuidV7();
    const lab2Id = generateUuidV7();

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'Lab Multi Test District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_LAB',
        block_name: 'Lab Test Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: schoolId,
        udise_code: `33${Date.now().toString().slice(-9)}`,
        school_name: 'Multi-Lab Model School',
        district_id: districtId,
        block_id: blockId,
        school_category: 'GHSS',
      })
      .execute();

    // Lab 1
    await db
      .insertInto('hi_tech_labs')
      .values({
        lab_id: lab1Id,
        school_id: schoolId,
        lab_code: 'LAB_01_PRIMARY',
        lab_type: 'PRIMARY',
        active_computers_count: 10,
      })
      .execute();

    // Lab 2 (Secondary Lab in same school)
    await db
      .insertInto('hi_tech_labs')
      .values({
        lab_id: lab2Id,
        school_id: schoolId,
        lab_code: 'LAB_02_HIGHER_SEC',
        lab_type: 'HIGHER_SECONDARY',
        active_computers_count: 20,
      })
      .execute();

    const labs = await db
      .selectFrom('hi_tech_labs')
      .where('school_id', '=', schoolId)
      .selectAll()
      .execute();

    expect(labs.length).toBe(2);
    expect(labs.map((l) => l.lab_code)).toContain('LAB_01_PRIMARY');
    expect(labs.map((l) => l.lab_code)).toContain('LAB_02_HIGHER_SEC');
  });

  // 6. Lab -> Equipment Relationship
  it('6. Lab -> Equipment relationship works with custom JSONB attributes', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const schoolId = generateUuidV7();
    const labId = generateUuidV7();
    const typeId = generateUuidV7();
    const eqId = generateUuidV7();

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'Equip Test District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_EQ',
        block_name: 'Equip Test Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: schoolId,
        udise_code: `33${Date.now().toString().slice(-9)}`,
        school_name: 'Equipment Host School',
        district_id: districtId,
        block_id: blockId,
        school_category: 'GHS',
      })
      .execute();

    await db
      .insertInto('hi_tech_labs')
      .values({
        lab_id: labId,
        school_id: schoolId,
        lab_code: 'EQ_LAB_01',
      })
      .execute();

    await db
      .insertInto('equipment_types')
      .values({
        equipment_type_id: typeId,
        type_code: `UPS_${Date.now().toString().slice(-4)}`,
        type_name: 'Power Backup UPS',
      })
      .execute();

    await db
      .insertInto('lab_equipment')
      .values({
        lab_equipment_id: eqId,
        lab_id: labId,
        equipment_type_id: typeId,
        model_number: 'SmartUPS-3000',
        serial_number: `SN-${Date.now()}`,
        custom_attributes: { battery_voltage: 48, bank_capacity_ah: 100 },
      })
      .execute();

    const eq = await db
      .selectFrom('lab_equipment')
      .where('lab_equipment_id', '=', eqId)
      .selectAll()
      .executeTakeFirstOrThrow();

    expect(eq.lab_id).toBe(labId);
    expect(eq.custom_attributes).toEqual({ battery_voltage: 48, bank_capacity_ah: 100 });
  });

  // 7. Source Complaint can Exist Independently
  it('7. Source complaint can exist independently without any service case', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const schoolId = generateUuidV7();
    const sourceSystemId = generateUuidV7();
    const complaintId = generateUuidV7();

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'Complaint Alone District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_CA',
        block_name: 'Complaint Alone Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: schoolId,
        udise_code: `33${Date.now().toString().slice(-9)}`,
        school_name: 'Complaint Alone School',
        district_id: districtId,
        block_id: blockId,
        school_category: 'PUMS',
      })
      .execute();

    await db
      .insertInto('complaint_sources')
      .values({
        source_system_id: sourceSystemId,
        system_code: `SRC_${Date.now().toString().slice(-5)}`,
        system_name: 'State Toll-Free Desk',
      })
      .execute();

    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: complaintId,
        source_system_id: sourceSystemId,
        external_ticket_id: `EXT-ALONE-${Date.now()}`,
        school_id: schoolId,
        original_title: 'Independent Intake Issue',
        registered_at: new Date(),
        source_status: 'New / Staged',
      })
      .execute();

    const count = await db
      .selectFrom('service_cases')
      .where('source_complaint_id', '=', complaintId)
      .selectAll()
      .execute();

    expect(count.length).toBe(0);
  });

  // 8. Service Case references Source Complaint (1:1 Unique)
  it('8. Service case can reference source complaint and generates unique case code', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const schoolId = generateUuidV7();
    const labId = generateUuidV7();
    const sourceSystemId = generateUuidV7();
    const complaintId = generateUuidV7();
    const caseId = generateUuidV7();
    const caseCode = `ZNT-2026-TEST-${Date.now().toString().slice(-5)}`;

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'Case Test District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_CS',
        block_name: 'Case Test Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: schoolId,
        udise_code: `33${Date.now().toString().slice(-9)}`,
        school_name: 'Case Test School',
        district_id: districtId,
        block_id: blockId,
        school_category: 'GHSS',
      })
      .execute();

    await db
      .insertInto('hi_tech_labs')
      .values({
        lab_id: labId,
        school_id: schoolId,
        lab_code: 'CS_LAB_01',
      })
      .execute();

    await db
      .insertInto('complaint_sources')
      .values({
        source_system_id: sourceSystemId,
        system_code: `SRC_${Date.now().toString().slice(-5)}`,
        system_name: 'Helpline Desk',
      })
      .execute();

    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: complaintId,
        source_system_id: sourceSystemId,
        external_ticket_id: `EXT-CASE-${Date.now()}`,
        school_id: schoolId,
        original_title: 'Router Port Down',
        registered_at: new Date(),
        source_status: 'Open',
      })
      .execute();

    await db
      .insertInto('service_cases')
      .values({
        service_case_id: caseId,
        source_complaint_id: complaintId,
        zentra_case_code: caseCode,
        school_id: schoolId,
        lab_id: labId,
        operational_status: 'REGISTERED',
      })
      .execute();

    const createdCase = await db
      .selectFrom('service_cases')
      .where('service_case_id', '=', caseId)
      .selectAll()
      .executeTakeFirstOrThrow();

    expect(createdCase.source_complaint_id).toBe(complaintId);
    expect(createdCase.zentra_case_code).toBe(caseCode);
  });

  // 9. Multiple Visits per Service Case
  it('9. Multiple visits can reference one service case with ordered sequence numbers', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const schoolId = generateUuidV7();
    const labId = generateUuidV7();
    const sourceSystemId = generateUuidV7();
    const complaintId = generateUuidV7();
    const caseId = generateUuidV7();
    const userId = generateUuidV7();
    const visit1Id = generateUuidV7();
    const visit2Id = generateUuidV7();

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'Multi Visit District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_MV',
        block_name: 'Multi Visit Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: schoolId,
        udise_code: `33${Date.now().toString().slice(-9)}`,
        school_name: 'Multi Visit School',
        district_id: districtId,
        block_id: blockId,
        school_category: 'GHSS',
      })
      .execute();

    await db
      .insertInto('hi_tech_labs')
      .values({
        lab_id: labId,
        school_id: schoolId,
        lab_code: 'MV_LAB_01',
      })
      .execute();

    await db
      .insertInto('users')
      .values({
        user_id: userId,
        username: `engineer_${Date.now()}@zentra.local`,
        full_name: 'Test Field Engineer',
      })
      .execute();

    await db
      .insertInto('complaint_sources')
      .values({
        source_system_id: sourceSystemId,
        system_code: `SRC_${Date.now().toString().slice(-5)}`,
        system_name: 'Multi Visit Source',
      })
      .execute();

    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: complaintId,
        source_system_id: sourceSystemId,
        external_ticket_id: `EXT-MV-${Date.now()}`,
        school_id: schoolId,
        original_title: 'Server HDD Failure',
        registered_at: new Date(),
      })
      .execute();

    await db
      .insertInto('service_cases')
      .values({
        service_case_id: caseId,
        source_complaint_id: complaintId,
        zentra_case_code: `ZNT-2026-MV-${Date.now().toString().slice(-5)}`,
        school_id: schoolId,
        lab_id: labId,
        operational_status: 'IN_PROGRESS',
        assigned_primary_engineer_id: userId,
      })
      .execute();

    // Visit 1: Parts pending
    await db
      .insertInto('field_visits')
      .values({
        visit_id: visit1Id,
        service_case_id: caseId,
        engineer_id: userId,
        visit_sequence_number: 1,
        visit_date: '2026-10-01',
        visit_outcome: 'PENDING_PARTS',
        pending_reason_text: 'Replacement 2TB SAS drive required.',
      })
      .execute();

    // Visit 2: Resolved
    await db
      .insertInto('field_visits')
      .values({
        visit_id: visit2Id,
        service_case_id: caseId,
        engineer_id: userId,
        visit_sequence_number: 2,
        visit_date: '2026-10-03',
        visit_outcome: 'RESOLVED_ON_SITE',
        work_performed: 'Replaced failed HDD and rebuilt RAID 5 array.',
      })
      .execute();

    const visits = await db
      .selectFrom('field_visits')
      .where('service_case_id', '=', caseId)
      .orderBy('visit_sequence_number', 'asc')
      .selectAll()
      .execute();

    expect(visits.length).toBe(2);
    expect(visits[0]!.visit_sequence_number).toBe(1);
    expect(visits[0]!.visit_outcome).toBe('PENDING_PARTS');
    expect(visits[1]!.visit_sequence_number).toBe(2);
    expect(visits[1]!.visit_outcome).toBe('RESOLVED_ON_SITE');
  });

  // 10. Evidence Metadata references correct Visit and Case
  it('10. Evidence metadata references visit and case with Slot 1 & Slot 2 isolation', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const schoolId = generateUuidV7();
    const labId = generateUuidV7();
    const sourceSystemId = generateUuidV7();
    const complaintId = generateUuidV7();
    const caseId = generateUuidV7();
    const userId = generateUuidV7();
    const visitId = generateUuidV7();
    const evidence1Id = generateUuidV7();
    const evidence2Id = generateUuidV7();

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'Evidence Test District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_EV',
        block_name: 'Evidence Test Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: schoolId,
        udise_code: `33${Date.now().toString().slice(-9)}`,
        school_name: 'Evidence School',
        district_id: districtId,
        block_id: blockId,
        school_category: 'GHSS',
      })
      .execute();

    await db
      .insertInto('hi_tech_labs')
      .values({
        lab_id: labId,
        school_id: schoolId,
        lab_code: 'EV_LAB_01',
      })
      .execute();

    await db
      .insertInto('users')
      .values({
        user_id: userId,
        username: `engineer_${Date.now()}@zentra.local`,
        full_name: 'Evidence Field Engineer',
      })
      .execute();

    await db
      .insertInto('complaint_sources')
      .values({
        source_system_id: sourceSystemId,
        system_code: `SRC_${Date.now().toString().slice(-5)}`,
        system_name: 'Evidence Source',
      })
      .execute();

    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: complaintId,
        source_system_id: sourceSystemId,
        external_ticket_id: `EXT-EV-${Date.now()}`,
        school_id: schoolId,
        original_title: 'Projector Lamp Issue',
        registered_at: new Date(),
      })
      .execute();

    await db
      .insertInto('service_cases')
      .values({
        service_case_id: caseId,
        source_complaint_id: complaintId,
        zentra_case_code: `ZNT-2026-EV-${Date.now().toString().slice(-5)}`,
        school_id: schoolId,
        lab_id: labId,
      })
      .execute();

    await db
      .insertInto('field_visits')
      .values({
        visit_id: visitId,
        service_case_id: caseId,
        engineer_id: userId,
        visit_date: '2026-10-04',
      })
      .execute();

    // Slot 1: HM Signed Completion Report
    await db
      .insertInto('evidence_files')
      .values({
        evidence_file_id: evidence1Id,
        visit_id: visitId,
        service_case_id: caseId,
        evidence_slot: 'SLOT_1_HM_SIGNED_REPORT',
        storage_path: 'evidence/2026/10/slot1_hm_report.jpg',
        file_checksum_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        file_size_bytes: '450210',
        captured_at: new Date('2026-10-04T11:00:00Z'),
      })
      .execute();

    // Slot 2: Equipment Working Photo (with Watermarked GPS)
    await db
      .insertInto('evidence_files')
      .values({
        evidence_file_id: evidence2Id,
        visit_id: visitId,
        service_case_id: caseId,
        evidence_slot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
        storage_path: 'evidence/2026/10/slot2_working_photo.jpg',
        file_checksum_sha256: '5bf1fd927dfb8679496a2e6cf00cbe50c1c87f447e01ecb30c42c67c5148972e',
        file_size_bytes: '890120',
        captured_at: new Date('2026-10-04T11:05:00Z'),
        gps_latitude: '10.76543200',
        gps_longitude: '79.84321000',
        gps_accuracy_meters: '7.20',
      })
      .execute();

    const evidences = await db
      .selectFrom('evidence_files')
      .where('visit_id', '=', visitId)
      .selectAll()
      .execute();

    expect(evidences.length).toBe(2);
    const slots = evidences.map((e) => e.evidence_slot);
    expect(slots).toContain('SLOT_1_HM_SIGNED_REPORT');
    expect(slots).toContain('SLOT_2_EQUIPMENT_WORKING_PHOTO');
  });

  // 11. Source Complaint Identity Deduplication
  it('11. Source complaint identity constraint rejects duplicate (source_system_id, external_ticket_id)', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const schoolId = generateUuidV7();
    const sourceSystemId = generateUuidV7();
    const externalTicketId = `EXT-DUP-${Date.now()}`;

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'Dedupe District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_DD',
        block_name: 'Dedupe Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: schoolId,
        udise_code: `33${Date.now().toString().slice(-9)}`,
        school_name: 'Dedupe School',
        district_id: districtId,
        block_id: blockId,
        school_category: 'GHS',
      })
      .execute();

    await db
      .insertInto('complaint_sources')
      .values({
        source_system_id: sourceSystemId,
        system_code: `SRC_${Date.now().toString().slice(-5)}`,
        system_name: 'Dedupe Source System',
      })
      .execute();

    // First insert succeeds
    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: generateUuidV7(),
        source_system_id: sourceSystemId,
        external_ticket_id: externalTicketId,
        school_id: schoolId,
        original_title: 'Original Intake 1',
        registered_at: new Date(),
      })
      .execute();

    // Second insert with identical (source_system_id, external_ticket_id) must reject
    await expect(
      db
        .insertInto('source_complaints')
        .values({
          source_complaint_id: generateUuidV7(),
          source_system_id: sourceSystemId,
          external_ticket_id: externalTicketId,
          school_id: schoolId,
          original_title: 'Duplicate Intake Attempt',
          registered_at: new Date(),
        })
        .execute(),
    ).rejects.toThrow();
  });

  // 12. Multiple complaints for same school are legitimately allowed
  it('12. Same school legitimately allows multiple distinct complaints', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const schoolId = generateUuidV7();
    const sourceSystemId = generateUuidV7();

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'Multi Complaint District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_MC',
        block_name: 'Multi Complaint Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: schoolId,
        udise_code: `33${Date.now().toString().slice(-9)}`,
        school_name: 'Multi Complaint School',
        district_id: districtId,
        block_id: blockId,
        school_category: 'GHSS',
      })
      .execute();

    await db
      .insertInto('complaint_sources')
      .values({
        source_system_id: sourceSystemId,
        system_code: `SRC_${Date.now().toString().slice(-5)}`,
        system_name: 'Multi Complaint Source',
      })
      .execute();

    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: generateUuidV7(),
        source_system_id: sourceSystemId,
        external_ticket_id: `TKT-A-${Date.now()}`,
        school_id: schoolId,
        original_title: 'Complaint 1: UPS Problem',
        registered_at: new Date(),
      })
      .execute();

    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: generateUuidV7(),
        source_system_id: sourceSystemId,
        external_ticket_id: `TKT-B-${Date.now()}`,
        school_id: schoolId,
        original_title: 'Complaint 2: Web camera offline',
        registered_at: new Date(),
      })
      .execute();

    const schoolComplaints = await db
      .selectFrom('source_complaints')
      .where('school_id', '=', schoolId)
      .selectAll()
      .execute();

    expect(schoolComplaints.length).toBe(2);
  });

  // 13. Source Complaint vs Service Case Separation
  it('13. Source status is preserved immutably separate from field-service operational_status', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const schoolId = generateUuidV7();
    const labId = generateUuidV7();
    const sourceSystemId = generateUuidV7();
    const complaintId = generateUuidV7();
    const caseId = generateUuidV7();

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'Status District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_ST',
        block_name: 'Status Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: schoolId,
        udise_code: `33${Date.now().toString().slice(-9)}`,
        school_name: 'Status School',
        district_id: districtId,
        block_id: blockId,
        school_category: 'GHSS',
      })
      .execute();

    await db
      .insertInto('hi_tech_labs')
      .values({
        lab_id: labId,
        school_id: schoolId,
        lab_code: 'ST_LAB_01',
      })
      .execute();

    await db
      .insertInto('complaint_sources')
      .values({
        source_system_id: sourceSystemId,
        system_code: `SRC_${Date.now().toString().slice(-5)}`,
        system_name: 'Status Source',
      })
      .execute();

    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: complaintId,
        source_system_id: sourceSystemId,
        external_ticket_id: `EXT-STATUS-${Date.now()}`,
        school_id: schoolId,
        original_title: 'Original Portal Record',
        registered_at: new Date(),
        source_status: 'EXTERNAL_NEW',
      })
      .execute();

    await db
      .insertInto('service_cases')
      .values({
        service_case_id: caseId,
        source_complaint_id: complaintId,
        zentra_case_code: `ZNT-2026-ST-${Date.now().toString().slice(-5)}`,
        school_id: schoolId,
        lab_id: labId,
        operational_status: 'IN_TRANSIT',
      })
      .execute();

    // Verify source complaint status remains EXTERNAL_NEW while service case progresses
    const sc = await db
      .selectFrom('source_complaints')
      .where('source_complaint_id', '=', complaintId)
      .selectAll()
      .executeTakeFirstOrThrow();

    const cs = await db
      .selectFrom('service_cases')
      .where('service_case_id', '=', caseId)
      .selectAll()
      .executeTakeFirstOrThrow();

    expect(sc.source_status).toBe('EXTERNAL_NEW');
    expect(cs.operational_status).toBe('IN_TRANSIT');
  });

  // 14. Soft-delete & Tombstone Foundation
  it('14. Soft-delete updates is_deleted and appends a tombstone with monotonic sync_sequence_number', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const schoolId = generateUuidV7();
    const labId = generateUuidV7();
    const sourceSystemId = generateUuidV7();
    const complaintId = generateUuidV7();
    const caseId = generateUuidV7();
    const tombstoneId = generateUuidV7();

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'Tombstone District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_TB',
        block_name: 'Tombstone Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: schoolId,
        udise_code: `33${Date.now().toString().slice(-9)}`,
        school_name: 'Tombstone School',
        district_id: districtId,
        block_id: blockId,
        school_category: 'GHSS',
      })
      .execute();

    await db
      .insertInto('hi_tech_labs')
      .values({
        lab_id: labId,
        school_id: schoolId,
        lab_code: 'TB_LAB_01',
      })
      .execute();

    await db
      .insertInto('complaint_sources')
      .values({
        source_system_id: sourceSystemId,
        system_code: `SRC_${Date.now().toString().slice(-5)}`,
        system_name: 'Tombstone Source',
      })
      .execute();

    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: complaintId,
        source_system_id: sourceSystemId,
        external_ticket_id: `EXT-TB-${Date.now()}`,
        school_id: schoolId,
        original_title: 'Tombstone Complaint',
        registered_at: new Date(),
      })
      .execute();

    await db
      .insertInto('service_cases')
      .values({
        service_case_id: caseId,
        source_complaint_id: complaintId,
        zentra_case_code: `ZNT-2026-TB-${Date.now().toString().slice(-5)}`,
        school_id: schoolId,
        lab_id: labId,
        is_deleted: false,
      })
      .execute();

    // Administrative Soft Delete
    await db
      .updateTable('service_cases')
      .set({
        is_deleted: true,
        deleted_at: new Date(),
      })
      .where('service_case_id', '=', caseId)
      .execute();

    // Insert Tombstone
    await db
      .insertInto('tombstones')
      .values({
        tombstone_id: tombstoneId,
        entity_type: 'service_cases',
        entity_id: caseId,
        tombstone_reason: 'Administrative test soft purge',
      })
      .execute();

    const tombstone = await db
      .selectFrom('tombstones')
      .where('tombstone_id', '=', tombstoneId)
      .selectAll()
      .executeTakeFirstOrThrow();

    expect(tombstone.entity_id).toBe(caseId);
    expect(Number(tombstone.sync_sequence_number)).toBeGreaterThan(0);

    const deletedCase = await db
      .selectFrom('service_cases')
      .where('service_case_id', '=', caseId)
      .selectAll()
      .executeTakeFirstOrThrow();

    expect(deletedCase.is_deleted).toBe(true);
    expect(deletedCase.deleted_at).toBeDefined();
  });

  // 15. Foreign Keys reject invalid references
  it('15. Foreign keys reject insertion of orphan records', async () => {
    const nonExistentDistrictId = generateUuidV7();
    const blockId = generateUuidV7();

    await expect(
      db
        .insertInto('blocks')
        .values({
          block_id: blockId,
          district_id: nonExistentDistrictId,
          block_code: 'ORPHAN',
          block_name: 'Orphan Block',
        })
        .execute(),
    ).rejects.toThrow();
  });

  // 16. Unique Constraints reject duplicate codes
  it('16. Unique constraints reject duplicate UDISE codes', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const duplicateUdise = `33${Date.now().toString().slice(-9)}`;

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'UDISE Test District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_UD',
        block_name: 'UDISE Test Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: generateUuidV7(),
        udise_code: duplicateUdise,
        school_name: 'First UDISE School',
        district_id: districtId,
        block_id: blockId,
        school_category: 'GHS',
      })
      .execute();

    await expect(
      db
        .insertInto('schools')
        .values({
          school_id: generateUuidV7(),
          udise_code: duplicateUdise, // Duplicate UDISE
          school_name: 'Second UDISE School',
          district_id: districtId,
          block_id: blockId,
          school_category: 'GHSS',
        })
        .execute(),
    ).rejects.toThrow();
  });

  // 17. Check constraint rejects invalid operational_status
  it('17. Operational status check constraint rejects invalid status values', async () => {
    const districtId = generateUuidV7();
    const blockId = generateUuidV7();
    const schoolId = generateUuidV7();
    const labId = generateUuidV7();
    const sourceSystemId = generateUuidV7();
    const complaintId = generateUuidV7();

    await db
      .insertInto('districts')
      .values({
        district_id: districtId,
        district_code: `D_${Date.now().toString().slice(-6)}`,
        district_name: 'Check Constraint District',
      })
      .execute();

    await db
      .insertInto('blocks')
      .values({
        block_id: blockId,
        district_id: districtId,
        block_code: 'BLK_CC',
        block_name: 'Check Constraint Block',
      })
      .execute();

    await db
      .insertInto('schools')
      .values({
        school_id: schoolId,
        udise_code: `33${Date.now().toString().slice(-9)}`,
        school_name: 'Check Constraint School',
        district_id: districtId,
        block_id: blockId,
        school_category: 'GHSS',
      })
      .execute();

    await db
      .insertInto('hi_tech_labs')
      .values({
        lab_id: labId,
        school_id: schoolId,
        lab_code: 'CC_LAB_01',
      })
      .execute();

    await db
      .insertInto('complaint_sources')
      .values({
        source_system_id: sourceSystemId,
        system_code: `SRC_${Date.now().toString().slice(-5)}`,
        system_name: 'Check Constraint Source',
      })
      .execute();

    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: complaintId,
        source_system_id: sourceSystemId,
        external_ticket_id: `EXT-CC-${Date.now()}`,
        school_id: schoolId,
        original_title: 'Check Constraint Complaint',
        registered_at: new Date(),
      })
      .execute();

    await expect(
      db
        .insertInto('service_cases')
        .values({
          service_case_id: generateUuidV7(),
          source_complaint_id: complaintId,
          zentra_case_code: `ZNT-2026-CC-${Date.now().toString().slice(-5)}`,
          school_id: schoolId,
          lab_id: labId,
          operational_status: 'INVALID_STATUS_VALUE' as any,
        })
        .execute(),
    ).rejects.toThrow();
  });

  // 18. Audit Events append-only log record insertion
  it('18. Audit events accepts valid structured event records', async () => {
    const auditId = generateUuidV7();
    const entityId = generateUuidV7();

    await db
      .insertInto('audit_events')
      .values({
        audit_event_id: auditId,
        event_category: 'DISPATCH',
        target_entity_type: 'service_cases',
        target_entity_id: entityId,
        action_type: 'UPDATE',
        actor_ip_address: '192.168.1.100',
        pre_mutation_state: { status: 'REGISTERED' },
        post_mutation_state: { status: 'ASSIGNED', assigned_to: 'engineer-01' },
      })
      .execute();

    const event = await db
      .selectFrom('audit_events')
      .where('audit_event_id', '=', auditId)
      .selectAll()
      .executeTakeFirstOrThrow();

    expect(event.target_entity_id).toBe(entityId);
    expect(event.action_type).toBe('UPDATE');
    expect(event.pre_mutation_state).toEqual({ status: 'REGISTERED' });
  });

  // 19. Migration rollback and re-apply verification
  it('19. Reversible migration down() and up() execution succeeds cleanly', async () => {
    const rollbackRes = await rollbackLatestMigration(TEST_DB_URL);
    expect(rollbackRes.error).toBeUndefined();
    expect(rollbackRes.results?.[0]?.direction).toBe('Down');
    expect(rollbackRes.results?.[0]?.status).toBe('Success');

    const migrateUpRes = await runMigrationsToLatest(TEST_DB_URL);
    expect(migrateUpRes.error).toBeUndefined();
    expect(migrateUpRes.results?.[0]?.direction).toBe('Up');
    expect(migrateUpRes.results?.[0]?.status).toBe('Success');
  });
});

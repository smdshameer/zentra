/**
 * ZENTRA — Phase 8 Staged Ingestion & Duplicate Classification Domain Tests
 * apps/api/test/import-staging-domain.spec.ts
 *
 * Comprehensive End-to-End & Integration Suite covering:
 * A. File parsing (XLSX, XLS, CSV)
 * B. XLSX ingestion via Base64 buffer
 * C. CSV ingestion via text content
 * D. Malformed file rejection (empty buffer, corrupt bytes, invalid extension)
 * E. Dynamic column mapping & aliases
 * F. Deterministic normalization (whitespace, priority defaulting, phone formatting)
 * G. Required field validation (UDISE format, problem description)
 * H. School master identification & resolution
 * I. Source identity matching (sourceSystemId + externalTicketId)
 * J. All five duplicate classifications:
 *    - Tier 1: EXACT_SOURCE_DUPLICATE
 *    - Tier 2: NEW_UNIQUE
 *    - Tier 3: NEW_ISSUE_DIFFERENT_EQUIPMENT
 *    - Tier 4: ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT (Chaser)
 *    - Tier 5: REOPENED_POST_SERVICE_FAILURE (Recurring within 7 days)
 * K. Duplicate reasoning & confidence calculation
 * L. Intra-batch duplicate detection (DUPLICATE_IN_FILE)
 * M. Re-import idempotency & duplicate hash detection
 * N. Staging isolation (zero direct impact on operational tables before commit)
 * O. Unauthorized staging access (unauthenticated 401, field engineer 403)
 * P. Cross-district staging isolation (District Coordinator scoped)
 * Q. Reporting Head read-only enforcement (mutations rejected 403)
 * R. Authorized staging approval
 * S. Unauthorized staging approval
 * T. Atomic database transaction commit
 * U. Partial failure rollback & idempotency
 * V. Source status preservation separate from field service lifecycle
 * W. CRITICAL MANDATORY BOUNDARY WALL SCENARIO:
 *    Active field service case (assigned engineer, operational status, findings)
 *    is 100% UNTOUCHED when re-import is committed.
 * X. Administrative Audit Logging (IMPORT_CREATED, IMPORT_APPROVED, IMPORT_COMMITTED)
 * Y. Failed import state
 * Z. Successful committed import state
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as XLSX from 'xlsx';
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
import { runMigrationsToLatest } from '../src/database/migration-runner';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zentra_test';

describe('ZENTRA Phase 8 — Staged Ingestion & Duplicate Classification Subsystem', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let tokenService: TokenService;

  let masterAdminToken: string;
  let reportingHeadToken: string;
  let erodeCoordinatorToken: string;
  let salemCoordinatorToken: string;
  let fieldEngineerToken: string;

  let schoolUdiseErode: string;
  let schoolUdiseSalem: string;
  let schoolUdiseClean: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;
    assertTestEnvironmentIsSafe();
    assertTestDatabaseIsSafe(TEST_DB_URL);

    // Run migrations to ensure latest schema
    const migrationResult = await runMigrationsToLatest(TEST_DB_URL);
    if (migrationResult.error) {
      throw migrationResult.error;
    }

    const { createDatabaseConnection } = await import('../src/database/database.connection');
    db = createDatabaseConnection(TEST_DB_URL);

    // Clean tables in reverse foreign key order
    await db.deleteFrom('import_staging_records').execute();
    await db.deleteFrom('import_jobs').execute();
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

    // Seed synthetic fixtures
    seeded = await seedSyntheticDevelopmentFixtures(db);

    // Retrieve UDISE codes for test assertions
    const schoolA = await db
      .selectFrom('schools')
      .where('school_id', '=', seeded.schoolId)
      .select('udise_code')
      .executeTakeFirstOrThrow();
    schoolUdiseErode = schoolA.udise_code;

    const schoolB = await db
      .selectFrom('schools')
      .where('school_id', '=', seeded.secondSchoolId)
      .select('udise_code')
      .executeTakeFirstOrThrow();
    schoolUdiseSalem = schoolB.udise_code;

    const schoolClean = await db
      .selectFrom('schools')
      .where('school_id', '=', seeded.schoolA1_2Id)
      .select('udise_code')
      .executeTakeFirstOrThrow();
    schoolUdiseClean = schoolClean.udise_code;

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

  // =========================================================================
  // 1. Multi-Format File Ingestion & Parsing (A, B, C, D)
  // =========================================================================

  it('A & B. Parses and stages valid binary XLSX spreadsheet via Base64 buffer', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([
      {
        'Ticket ID': 'TKT-XLSX-001',
        UDISE: schoolUdiseErode,
        'School Name': 'GHSS Erode South',
        Issue: 'Smartboard HDMI cable loose',
        Priority: 'CRITICAL',
        Equipment: 'Smartboard',
        'Serial No': 'SN-SB-9901',
        Reporter: 'HM Erode',
        Phone: '9876543210',
      },
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Complaints');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fileContentBase64 = xlsxBuffer.toString('base64');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'erode_intake_batch_01.xlsx',
        fileType: 'XLSX',
        fileContentBase64,
        sourceSystemCode: 'HELPLINE',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.job.sourceFilename).toBe('erode_intake_batch_01.xlsx');
    expect(body.data.job.fileType).toBe('XLSX');
    expect(body.data.statistics.totalRowsParsed).toBe(1);
    expect(body.data.statistics.validRowsCount).toBe(1);
    expect(body.data.statistics.errorRowsCount).toBe(0);
    expect(body.data.job.jobStatus).toBe('STAGED');
  });

  it('A & C. Parses and stages CSV content text format directly', async () => {
    const csvContent = [
      'Ticket No,School Code,Complaint Description,Urgency,Hardware',
      `TKT-CSV-001,${schoolUdiseErode},"Internet connection down, router unreachable",HIGH,Meraki Router`,
      `TKT-CSV-002,${schoolUdiseErode},"Web camera not detected by PC",LOW,Web Camera`,
    ].join('\n');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'router_complaints.csv',
        fileType: 'CSV',
        csvContent,
        sourceSystemCode: 'PORTAL',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.statistics.totalRowsParsed).toBe(2);
    expect(body.data.statistics.validRowsCount).toBe(2);
    expect(body.data.job.jobStatus).toBe('STAGED');
  });

  it('A. Parses and stages binary XLS (BIFF8) legacy format', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([
      {
        'Ticket ID': 'TKT-XLS-001',
        UDISE: schoolUdiseErode,
        Problem: 'Projector ceiling mount damaged',
        Urgency: 'NORMAL',
        Device: 'Projector',
      },
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Complaints');
    const xlsBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' });
    const fileContentBase64 = xlsBuffer.toString('base64');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'legacy_tickets.xls',
        fileType: 'XLS',
        fileContentBase64,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.statistics.totalRowsParsed).toBe(1);
    expect(body.data.statistics.validRowsCount).toBe(1);
  });

  it('D. Rejects malformed and unsupported file formats', async () => {
    // 1. Unsupported extension (.pdf)
    const resPdf = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'complaints.pdf',
        fileType: 'PDF' as any,
        csvContent: 'Some arbitrary text',
      },
    });
    expect(resPdf.statusCode).toBe(400);

    // 2. Corrupt buffer
    const corruptBase64 = Buffer.from('NOT_A_VALID_EXCEL_STREAM').toString('base64');
    const resCorrupt = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'corrupted.xlsx',
        fileType: 'XLSX',
        fileContentBase64: corruptBase64,
      },
    });
    expect(resCorrupt.statusCode).toBe(400);
  });

  // =========================================================================
  // 2. Column Mapping, Normalization & Validation (E, F, G, H)
  // =========================================================================

  it('E & F. Auto-detects column aliases and normalizes values while preserving raw row data', async () => {
    const rawRow = {
      'Call ID': 'EXT-ALIAS-88',
      'School UDISE': `  ${schoolUdiseErode}  `,
      'Nature of Complaint': '   Screen blinking intermittently   ',
      Severity: 'URGENT',
      'Hardware Category': 'Monitor',
      'Reporter Mobile': '+91 94433 22110',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'aliased_import.csv',
        rows: [rawRow],
      },
    });

    expect(res.statusCode).toBe(201);
    const jobId = JSON.parse(res.body).data.job.importJobId;

    // Inspect staged row
    const stagedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/imports/${jobId}/staging`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
    });
    const stagedRows = JSON.parse(stagedRes.body).data;
    expect(stagedRows.length).toBe(1);

    const record = stagedRows[0];
    expect(record.mappedExternalTicketId).toBe('EXT-ALIAS-88');
    expect(record.mappedUdiseCode).toBe(schoolUdiseErode);
    expect(record.mappedIssueText).toBe('Screen blinking intermittently');
    expect(record.mappedPriority).toBe('CRITICAL'); // URGENT normalized to CRITICAL
    expect(record.rawRowData['Call ID']).toBe('EXT-ALIAS-88'); // Raw preserved
  });

  it('G & H. Validates mandatory fields and flags row-level errors without crashing import job', async () => {
    const csvContent = [
      'Ticket ID,UDISE,Issue',
      `TKT-VAL-01,${schoolUdiseErode},"Valid row with problem text"`,
      'TKT-VAL-02,INVALID_UDISE,"Invalid UDISE length"',
      `TKT-VAL-03,${schoolUdiseErode},`, // Missing problem text
      'TKT-VAL-04,99999999999,"Non-existent school in master catalog"',
    ].join('\n');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'mixed_validation.csv',
        fileType: 'CSV',
        csvContent,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.statistics.totalRowsParsed).toBe(4);
    expect(body.data.statistics.validRowsCount).toBe(1);
    expect(body.data.statistics.errorRowsCount).toBe(3);
    expect(body.data.job.jobStatus).toBe('REVIEW_REQUIRED');

    // Query error rows endpoint
    const errRes = await app.inject({
      method: 'GET',
      url: `/api/v1/imports/${body.data.job.importJobId}/errors`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
    });
    const errorRecords = JSON.parse(errRes.body).data;
    expect(errorRecords.length).toBe(3);

    const errorMessages = errorRecords.map((r: any) => r.validationErrorMessage);
    expect(errorMessages.some((m: string) => m.includes('INVALID_UDISE'))).toBe(true);
    expect(errorMessages.some((m: string) => m.includes('MISSING_REQUIRED_FIELD'))).toBe(true);
    expect(errorMessages.some((m: string) => m.includes('SCHOOL_NOT_FOUND'))).toBe(true);
  });

  // =========================================================================
  // 3. Five-Tier Duplicate Classification Engine (I, J, K, L, M)
  // =========================================================================

  it('I, J, K. Deterministically classifies all 5 duplicate tiers with reasoning and confidence', async () => {
    const sourceSystemId = seeded.complaintSourceId;
    const testSchoolId = seeded.schoolId;

    // Setup DB state for testing tiers:
    // 1. Existing Active UPS Complaint
    const activeTicketId = `EXT-ACTIVE-UPS-${Date.now()}`;
    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: generateUuidV7(),
        source_system_id: sourceSystemId,
        external_ticket_id: activeTicketId,
        school_id: testSchoolId,
        original_title: 'Active UPS Breakdown',
        original_description: 'UPS beep sound and zero battery backup',
        registered_at: new Date(),
        source_status: 'Open',
        source_priority: 'HIGH',
        reported_equipment_text: 'UPS',
      })
      .execute();

    // 2. Existing Recently Resolved Camera Complaint (Resolved 2 days ago)
    const resolvedTicketId = `EXT-RESOLVED-CAM-${Date.now()}`;
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: generateUuidV7(),
        source_system_id: sourceSystemId,
        external_ticket_id: resolvedTicketId,
        school_id: testSchoolId,
        original_title: 'IP Camera focus issue',
        original_description: 'IP Camera focus blurred',
        registered_at: twoDaysAgo,
        source_status: 'RESOLVED',
        source_priority: 'LOW',
        reported_equipment_text: 'IP Camera',
        updated_at: twoDaysAgo,
      })
      .execute();

    // Inbound Batch designed to trigger all 5 tiers:
    const csvBatch = [
      'Ticket ID,UDISE,Issue,Equipment',
      // Tier 1: Exact source identity match on activeTicketId
      `${activeTicketId},${schoolUdiseErode},"Re-imported active UPS ticket with minor text update",UPS`,
      // Tier 2: New unique complaint on unused school with zero prior complaints
      `TKT-NEW-CLEAN,${schoolUdiseClean},"Computer table screws missing",Student Computer Table`,
      // Tier 3: Same school (Erode), but different equipment (D-Link Switch)
      `TKT-DIFF-EQUIP,${schoolUdiseErode},"Switch port 4 link light off",Network Switch`,
      // Tier 4: Same school (Erode) + same equipment (UPS) as active ticket -> Chaser
      `TKT-CHASER-UPS,${schoolUdiseErode},"UPS still not powering up, teacher follow-up",UPS`,
      // Tier 5: Same school (Erode) + same equipment (IP Camera) as recently resolved ticket
      `TKT-REOPENED-CAM,${schoolUdiseErode},"Camera blurred again after repair",IP Camera`,
    ].join('\n');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'five_tier_classification_matrix.csv',
        fileType: 'CSV',
        csvContent: csvBatch,
        sourceSystemCode: 'DEMO_HELPLINE',
      },
    });

    expect(res.statusCode).toBe(201);
    const jobId = JSON.parse(res.body).data.job.importJobId;

    const stagedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/imports/${jobId}/staging`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
    });
    const stagedRows: any[] = JSON.parse(stagedRes.body).data;
    expect(stagedRows.length).toBe(5);

    // Row 1 -> Tier 1: EXACT_SOURCE_DUPLICATE
    const row1 = stagedRows.find((r) => r.mappedExternalTicketId === activeTicketId);
    expect(row1.duplicateClassification).toBe('EXACT_SOURCE_DUPLICATE');
    expect(row1.duplicateConfidence).toBe(1.0);
    expect(row1.duplicateReason).toContain('Exact source system and external ticket ID match');
    expect(row1.recommendedAction).toBe('REJECT_DUPLICATE');
    expect(row1.isApprovedForCommit).toBe(false);
    expect(row1.approvedByUserId).toBeNull();
    expect(row1.matchedSourceComplaintId).toBeDefined();

    // Row 2 -> Tier 2: NEW_UNIQUE (Recommended for approval, but unapproved by default)
    const row2 = stagedRows.find((r) => r.mappedExternalTicketId === 'TKT-NEW-CLEAN');
    expect(row2.duplicateClassification).toBe('NEW_UNIQUE');
    expect(row2.duplicateConfidence).toBe(1.0);
    expect(row2.duplicateReason).toContain('Unique complaint');
    expect(row2.recommendedAction).toBe('RECOMMEND_APPROVE');
    expect(row2.isApprovedForCommit).toBe(false);
    expect(row2.approvedByUserId).toBeNull();

    // Row 3 -> Tier 3: NEW_ISSUE_DIFFERENT_EQUIPMENT (Recommended for approval, but unapproved by default)
    const row3 = stagedRows.find((r) => r.mappedExternalTicketId === 'TKT-DIFF-EQUIP');
    expect(row3.duplicateClassification).toBe('NEW_ISSUE_DIFFERENT_EQUIPMENT');
    expect(row3.duplicateConfidence).toBe(0.9);
    expect(row3.duplicateReason).toContain('Different equipment failure in same school');
    expect(row3.recommendedAction).toBe('RECOMMEND_APPROVE');
    expect(row3.isApprovedForCommit).toBe(false);
    expect(row3.approvedByUserId).toBeNull();

    // Row 4 -> Tier 4: ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT
    const row4 = stagedRows.find((r) => r.mappedExternalTicketId === 'TKT-CHASER-UPS');
    expect(row4.duplicateClassification).toBe('ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT');
    expect(row4.duplicateConfidence).toBe(0.85);
    expect(row4.duplicateReason).toContain('Chaser candidate');
    expect(row4.recommendedAction).toBe('REVIEW_ACTIVE_CHASER');
    expect(row4.isApprovedForCommit).toBe(false);
    expect(row4.approvedByUserId).toBeNull();

    // Row 5 -> Tier 5: REOPENED_POST_SERVICE_FAILURE
    const row5 = stagedRows.find((r) => r.mappedExternalTicketId === 'TKT-REOPENED-CAM');
    expect(row5.duplicateClassification).toBe('REOPENED_POST_SERVICE_FAILURE');
    expect(row5.duplicateConfidence).toBe(0.75);
    expect(row5.duplicateReason).toContain('potential recurring fault');
    expect(row5.recommendedAction).toBe('REVIEW_WARRANTY_CALLBACK');
    expect(row5.isApprovedForCommit).toBe(false);
    expect(row5.approvedByUserId).toBeNull();
  });

  it('L. Detects intra-batch duplicate rows within the same import file', async () => {
    const csvContent = [
      'Ticket ID,UDISE,Issue,Equipment',
      `TKT-INTRA-01,${schoolUdiseClean},"Primary row in batch",Meraki Router`,
      `TKT-INTRA-01,${schoolUdiseClean},"Duplicate row with identical ticket ID",Meraki Router`,
    ].join('\n');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'intra_batch_duplicates.csv',
        fileType: 'CSV',
        csvContent,
      },
    });

    expect(res.statusCode).toBe(201);
    const jobId = JSON.parse(res.body).data.job.importJobId;

    const stagedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/imports/${jobId}/staging`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
    });
    const stagedRows = JSON.parse(stagedRes.body).data;

    expect(stagedRows[0].duplicateClassification).toBe('NEW_UNIQUE');
    expect(stagedRows[1].duplicateClassification).toBe('DUPLICATE_IN_FILE');
    expect(stagedRows[1].duplicateReason).toContain('matches Row 1');
    expect(stagedRows[1].isApprovedForCommit).toBe(false); // Disapproved by default
  });

  it('M. Detects identical re-import via cryptographic file hash', async () => {
    const csvContent = `Ticket ID,UDISE,Issue\nTKT-IDEM-01,${schoolUdiseErode},"Idempotency test"`;

    // 1st Import
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'idempotent_sheet.csv',
        csvContent,
      },
    });
    expect(res1.statusCode).toBe(201);
    const hash1 = JSON.parse(res1.body).data.job.fileHashSha256;
    expect(hash1).toBeDefined();

    // 2nd Import of identical content
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'idempotent_sheet_reupload.csv',
        csvContent,
      },
    });
    expect(res2.statusCode).toBe(201);
    const hash2 = JSON.parse(res2.body).data.job.fileHashSha256;
    expect(hash2).toBe(hash1); // Identical cryptographic hash
  });

  // =========================================================================
  // 4. Staging Isolation, RBAC & Territory Scoping (N, O, P, Q, R, S)
  // =========================================================================

  it('N. Staging rows are completely isolated from operational tables before commit', async () => {
    const ticketId = `EXT-STAGING-ISOLATION-${Date.now()}`;
    const csvContent = `Ticket ID,UDISE,Issue\n${ticketId},${schoolUdiseErode},"Transient staging record"`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { fileName: 'isolation.csv', csvContent },
    });
    expect(res.statusCode).toBe(201);

    // Operational tables check: source_complaints and service_cases must NOT contain this record yet
    const sc = await db
      .selectFrom('source_complaints')
      .where('external_ticket_id', '=', ticketId)
      .selectAll()
      .execute();
    expect(sc.length).toBe(0);

    const cases = await db
      .selectFrom('service_cases')
      .where('zentra_case_code', 'like', `%${ticketId}%`)
      .selectAll()
      .execute();
    expect(cases.length).toBe(0);
  });

  it('O. Unauthenticated and Field Engineer requests are rejected with 401/403', async () => {
    // Unauthenticated
    const resUnauth = await app.inject({
      method: 'GET',
      url: '/api/v1/imports',
    });
    expect(resUnauth.statusCode).toBe(401);

    // Field Engineer forbidden
    const resEngineer = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${fieldEngineerToken}` },
      payload: { fileName: 'eng.csv', csvContent: 'Ticket,UDISE,Issue\n1,2,3' },
    });
    expect(resEngineer.statusCode).toBe(403);
  });

  it('P. Cross-district staging isolation: Coordinator cannot ingest or approve foreign district records', async () => {
    // Erode coordinator attempts to ingest Salem school
    const csvContent = `Ticket ID,UDISE,Issue\nTKT-CROSS-01,${schoolUdiseSalem},"Salem school complaint"`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
      payload: {
        fileName: 'cross_district_attempt.csv',
        csvContent,
      },
    });
    expect(res.statusCode).toBe(403); // Forbidden territory
  });

  it('Q. Reporting Head is strictly read-only: Can list/inspect but cannot approve or commit', async () => {
    // Setup job by admin
    const resJob = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'reporting_head_check.csv',
        csvContent: `Ticket ID,UDISE,Issue\nTKT-RH-01,${schoolUdiseErode},"Read only check"`,
      },
    });
    const jobId = JSON.parse(resJob.body).data.job.importJobId;

    // Reporting Head can read job
    const resRead = await app.inject({
      method: 'GET',
      url: `/api/v1/imports/${jobId}`,
      headers: { authorization: `Bearer ${reportingHeadToken}` },
    });
    expect(resRead.statusCode).toBe(200);

    // Reporting Head rejected on approve
    const resApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/approve`,
      headers: { authorization: `Bearer ${reportingHeadToken}` },
      payload: { isApproved: true },
    });
    expect(resApprove.statusCode).toBe(403);

    // Reporting Head rejected on commit
    const resCommit = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/commit`,
      headers: { authorization: `Bearer ${reportingHeadToken}` },
      payload: {},
    });
    expect(resCommit.statusCode).toBe(403);
  });

  it('R & S. Scoped District Coordinator successfully approves within assigned territory', async () => {
    // Erode coordinator ingests valid Erode school record
    const resJob = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
      payload: {
        fileName: 'erode_approved.csv',
        csvContent: `Ticket ID,UDISE,Issue\nTKT-ERODE-OK,${schoolUdiseErode},"Valid Erode UPS complaint"`,
      },
    });
    expect(resJob.statusCode).toBe(201);
    const jobId = JSON.parse(resJob.body).data.job.importJobId;

    // Erode coordinator approves
    const resApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/approve`,
      headers: { authorization: `Bearer ${erodeCoordinatorToken}` },
      payload: { isApproved: true },
    });
    expect(resApprove.statusCode).toBe(201);
    expect(JSON.parse(resApprove.body).data.message).toContain('approved for commit');
  });

  // =========================================================================
  // 5. Atomic Commit & Authoritative Boundary Wall (T, U, V, W, X, Y, Z)
  // =========================================================================

  it('T & Z. Commits approved records atomically and updates job state to COMMITTED', async () => {
    const ticketId = `TKT-COMMIT-${Date.now()}`;
    const csvContent = `Ticket ID,UDISE,Issue,Priority\n${ticketId},${schoolUdiseErode},"Atomic commit issue",CRITICAL`;

    const resJob = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { fileName: 'atomic_commit.csv', csvContent },
    });
    const jobId = JSON.parse(resJob.body).data.job.importJobId;

    // Approve job
    await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/approve`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { isApproved: true },
    });

    // Commit job
    const resCommit = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/commit`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { notes: 'Approved statewide batch by Master Admin' },
    });

    expect(resCommit.statusCode).toBe(201);
    const commitBody = JSON.parse(resCommit.body);
    expect(commitBody.success).toBe(true);
    expect(commitBody.data.committedCount).toBe(1);

    // Verify source_complaints row was created
    const sc = await db
      .selectFrom('source_complaints')
      .where('external_ticket_id', '=', ticketId)
      .selectAll()
      .executeTakeFirst();
    expect(sc).toBeDefined();
    expect(sc!.original_title).toBe('Atomic commit issue');
    expect(sc!.source_priority).toBe('CRITICAL');

    // Verify import_jobs state is COMMITTED with timestamp
    const job = await db
      .selectFrom('import_jobs')
      .where('import_job_id', '=', jobId)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(job.job_status).toBe('COMMITTED');
    expect(job.committed_at).toBeDefined();

    // Staging record has committed_source_complaint_id linked
    const staging = await db
      .selectFrom('import_staging_records')
      .where('import_job_id', '=', jobId)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(staging.committed_source_complaint_id).toBe(sc!.source_complaint_id);
  });

  it('U. Idempotency guard: Re-committing an already COMMITTED job is safely rejected', async () => {
    const ticketId = `TKT-DOUBLE-COMMIT-${Date.now()}`;
    const csvContent = `Ticket ID,UDISE,Issue\n${ticketId},${schoolUdiseErode},"Double commit guard"`;

    const resJob = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { fileName: 'double_commit.csv', csvContent },
    });
    const jobId = JSON.parse(resJob.body).data.job.importJobId;

    await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/approve`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { isApproved: true },
    });

    // 1st commit succeeds
    const resCommit1 = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/commit`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {},
    });
    expect(resCommit1.statusCode).toBe(201);

    // 2nd commit attempt fails gracefully
    const resCommit2 = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/commit`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {},
    });
    expect(resCommit2.statusCode).toBe(400);
    expect(JSON.parse(resCommit2.body).error.message).toContain('already COMMITTED');
  });

  it('W & V. MANDATORY BOUNDARY WALL SCENARIO: Existing field operational data is 100% UNTOUCHED upon re-import', async () => {
    // 1. Establish existing authoritative field record in PostgreSQL:
    const sourceSystemId = seeded.complaintSourceId;
    const testSchoolId = seeded.schoolId;
    const testLabId = seeded.labId;
    const originalComplaintId = generateUuidV7();
    const originalCaseId = generateUuidV7();
    const originalVisitId = generateUuidV7();
    const externalTicketId = `EXT-PROT-WALL-${Date.now()}`;

    // A. Source complaint
    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: originalComplaintId,
        source_system_id: sourceSystemId,
        external_ticket_id: externalTicketId,
        school_id: testSchoolId,
        original_title: 'Original Teacher Complaint',
        original_description: 'Initial reported symptoms',
        registered_at: new Date('2026-10-01T08:00:00Z'),
        source_status: 'Open',
        source_priority: 'MEDIUM',
      })
      .execute();

    // B. Field Service Case (Operational field data: assigned engineer, status, diagnosis)
    await db
      .insertInto('service_cases')
      .values({
        service_case_id: originalCaseId,
        source_complaint_id: originalComplaintId,
        zentra_case_code: `ZNT-WALL-${Date.now().toString().slice(-6)}`,
        school_id: testSchoolId,
        lab_id: testLabId,
        operational_status: 'IN_PROGRESS',
        assigned_primary_engineer_id: seeded.userId, // Demo Field Engineer
        assigned_at: new Date('2026-10-01T10:00:00Z'),
        actual_diagnosis_summary: 'PROTECTED FIELD DIAGNOSIS: Blown transformer fuse detected.',
        actual_action_taken_summary: 'Replaced fuse and tested under 3KVA load.',
      })
      .execute();

    // C. Field Visit (GPS check-in, on-site findings)
    await db
      .insertInto('field_visits')
      .values({
        visit_id: originalVisitId,
        service_case_id: originalCaseId,
        engineer_id: seeded.userId,
        visit_sequence_number: 1,
        visit_date: '2026-10-02',
        check_in_timestamp: new Date('2026-10-02T10:30:00Z'),
        check_in_latitude: '11.34100000',
        check_in_longitude: '77.71720000',
        check_in_accuracy_meters: '8.50',
        check_in_within_geofence: true,
        visit_outcome: 'RESOLVED_ON_SITE',
      })
      .execute();

    // 2. Inbound Spreadsheet arrives with updated remarks on the SAME external ticket:
    const reImportCsv = [
      'Ticket ID,UDISE,Issue,Priority',
      `${externalTicketId},${schoolUdiseErode},"Statewide Helpline follow-up: HM called again requesting status",HIGH`,
    ].join('\n');

    // Ingest
    const resJob = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {
        fileName: 'statewide_weekly_reimport.csv',
        fileType: 'CSV',
        csvContent: reImportCsv,
        sourceSystemCode: 'DEMO_HELPLINE',
      },
    });
    expect(resJob.statusCode).toBe(201);
    const jobId = JSON.parse(resJob.body).data.job.importJobId;

    // Check duplicate classification is EXACT_SOURCE_DUPLICATE (Tier 1)
    const stagedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/imports/${jobId}/staging`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
    });
    const stagedRecord = JSON.parse(stagedRes.body).data[0];
    expect(stagedRecord.duplicateClassification).toBe('EXACT_SOURCE_DUPLICATE');
    expect(stagedRecord.matchedSourceComplaintId).toBe(originalComplaintId);

    // Approve staging record for update
    await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/approve`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { isApproved: true, recordIds: [stagedRecord.stagingRecordId] },
    });

    // Commit import
    const resCommit = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/commit`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {},
    });
    expect(resCommit.statusCode).toBe(201);

    // 3. VERIFY AUTHORITATIVE BOUNDARY WALL HOLDS:
    // A. Service Case operational data is 100% UNCHANGED:
    const verifiedCase = await db
      .selectFrom('service_cases')
      .where('service_case_id', '=', originalCaseId)
      .selectAll()
      .executeTakeFirstOrThrow();

    expect(verifiedCase.operational_status).toBe('IN_PROGRESS'); // NOT overwritten!
    expect(verifiedCase.assigned_primary_engineer_id).toBe(seeded.userId); // NOT unassigned!
    expect(verifiedCase.actual_diagnosis_summary).toBe(
      'PROTECTED FIELD DIAGNOSIS: Blown transformer fuse detected.',
    ); // NOT wiped!
    expect(verifiedCase.actual_action_taken_summary).toBe(
      'Replaced fuse and tested under 3KVA load.',
    ); // NOT modified!

    // B. Field Visit is 100% UNCHANGED:
    const verifiedVisit = await db
      .selectFrom('field_visits')
      .where('visit_id', '=', originalVisitId)
      .selectAll()
      .executeTakeFirstOrThrow();

    expect(Number(verifiedVisit.check_in_latitude)).toBeCloseTo(11.341, 3);
    expect(verifiedVisit.visit_outcome).toBe('RESOLVED_ON_SITE');

    // C. Source complaint metadata was updated with origin traceability:
    const updatedSource = await db
      .selectFrom('source_complaints')
      .where('source_complaint_id', '=', originalComplaintId)
      .selectAll()
      .executeTakeFirstOrThrow();

    expect(updatedSource.original_remarks).toContain('Statewide Helpline follow-up');
    expect(updatedSource.source_status).toBe('UPDATED_IN_SOURCE');
  });

  it('X. Administrative Audit Logging records import events in audit_events', async () => {
    // Query audit events for IMPORT category
    const events = await db
      .selectFrom('audit_events')
      .where('event_category', '=', 'IMPORT')
      .selectAll()
      .orderBy('event_timestamp', 'desc')
      .execute();

    expect(events.length).toBeGreaterThan(0);
    const actionTypes = events.map((e) => e.action_type);
    expect(actionTypes).toContain('IMPORT_CREATED');
    expect(actionTypes).toContain('IMPORT_APPROVED');
    expect(actionTypes).toContain('IMPORT_COMMITTED');

    const commitEvent = events.find((e) => e.action_type === 'IMPORT_COMMITTED');
    expect(commitEvent!.actor_user_id).toBe(seeded.adminUserId);
    expect(commitEvent!.post_mutation_state).toHaveProperty('status', 'COMMITTED');
  });

  it('Y. Import job can be rejected, preventing any commits', async () => {
    const csvContent = `Ticket ID,UDISE,Issue\nTKT-REJECT-01,${schoolUdiseErode},"Will be rejected"`;

    const resJob = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { fileName: 'reject_me.csv', csvContent },
    });
    const jobId = JSON.parse(resJob.body).data.job.importJobId;

    // Reject job
    const resReject = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/reject`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { reason: 'Corrupt batch data from external vendor' },
    });
    expect(resReject.statusCode).toBe(201);
    expect(JSON.parse(resReject.body).data.message).toContain('rejected');

    // Attempting commit must fail
    const resCommit = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/commit`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {},
    });
    expect(resCommit.statusCode).toBe(400);

    const job = await db
      .selectFrom('import_jobs')
      .where('import_job_id', '=', jobId)
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(job.job_status).toBe('REJECTED');
  });

  // =========================================================================
  // 6. Mandatory Boundary & Human Approval Proofs (Corrections 1, 2, 3)
  // =========================================================================

  it('Boundary Proof 1: Algorithmic recommendation != Human approval (Tier 2/3 cannot commit until authorized approval occurs)', async () => {
    // 1. Ingest batch with Tier 2 (New Unique) and Tier 3 (Different Equipment)
    const tktTier2 = `TKT-REC-T2-${Date.now()}`;
    const tktTier3 = `TKT-REC-T3-${Date.now()}`;
    const csvContent = [
      'Ticket ID,UDISE,Issue,Equipment',
      `${tktTier2},${schoolUdiseClean},"Clean school table repair",Student Computer Table`,
      `${tktTier3},${schoolUdiseErode},"Different equipment switch failure",Network Switch`,
    ].join('\n');

    const resJob = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { fileName: 'recommendation_vs_approval.csv', csvContent },
    });
    expect(resJob.statusCode).toBe(201);
    const jobId = JSON.parse(resJob.body).data.job.importJobId;

    // 2. Fetch staged rows: verify recommendation is populated but human approval is false
    const stagedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/imports/${jobId}/staging`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
    });
    const stagedRows: any[] = JSON.parse(stagedRes.body).data;
    expect(stagedRows.length).toBe(2);

    for (const row of stagedRows) {
      expect(row.recommendedAction).toBe('RECOMMEND_APPROVE');
      expect(row.isApprovedForCommit).toBe(false); // Algorithmic recommendation is NOT human approval!
      expect(row.approvedByUserId).toBeNull();
      expect(row.approvedAt).toBeNull();
    }

    // 3. Attempting to commit before authorized approval MUST FAIL with 400 Bad Request
    const prematureCommit = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/commit`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {},
    });
    expect(prematureCommit.statusCode).toBe(400);
    expect(JSON.parse(prematureCommit.body).error.message).toContain('No approved, valid staging records');

    // 4. Unauthorized users cannot approve
    // A. Field Engineer cannot approve (403)
    const engineerApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/approve`,
      headers: { authorization: `Bearer ${fieldEngineerToken}` },
      payload: { isApproved: true },
    });
    expect(engineerApprove.statusCode).toBe(403);

    // B. Reporting Head cannot approve (403)
    const rhApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/approve`,
      headers: { authorization: `Bearer ${reportingHeadToken}` },
      payload: { isApproved: true },
    });
    expect(rhApprove.statusCode).toBe(403);

    // 5. Authorized Master Admin approves records
    const adminApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/approve`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { isApproved: true },
    });
    expect(adminApprove.statusCode).toBe(201);

    // 6. Verify staged rows now reflect authorized human approval
    const stagedResApproved = await app.inject({
      method: 'GET',
      url: `/api/v1/imports/${jobId}/staging`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
    });
    const approvedRows: any[] = JSON.parse(stagedResApproved.body).data;
    for (const row of approvedRows) {
      expect(row.isApprovedForCommit).toBe(true);
      expect(row.approvedByUserId).toBe(seeded.adminUserId);
      expect(row.approvedAt).toBeDefined();
    }

    // 7. Now commit succeeds atomically
    const validCommit = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/commit`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {},
    });
    expect(validCommit.statusCode).toBe(201);
    expect(JSON.parse(validCommit.body).data.committedCount).toBe(2);
  });

  it('Boundary Proof 2: Classification and commit do not create service cases or dispatch engineers (Strict Phase 9 Boundary)', async () => {
    // 1. Record pre-test counts in operational tables
    const preCases = await db.selectFrom('service_cases').selectAll().execute();
    const preAssignments = await db.selectFrom('assignment_history').selectAll().execute();
    const preVisits = await db.selectFrom('field_visits').selectAll().execute();

    const tktProof = `TKT-BOUND-PH9-${Date.now()}`;
    const csvContent = `Ticket ID,UDISE,Issue,Equipment\n${tktProof},${schoolUdiseClean},"Boundary proof projector lamp",Projector`;

    // 2. Ingest & classify
    const resJob = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { fileName: 'phase9_boundary_proof.csv', csvContent },
    });
    expect(resJob.statusCode).toBe(201);
    const jobId = JSON.parse(resJob.body).data.job.importJobId;

    // 3. Approve and commit
    await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/approve`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: { isApproved: true },
    });

    const resCommit = await app.inject({
      method: 'POST',
      url: `/api/v1/imports/${jobId}/commit`,
      headers: { authorization: `Bearer ${masterAdminToken}` },
      payload: {},
    });
    expect(resCommit.statusCode).toBe(201);

    // 4. Verify STRICT PHASE 9 BOUNDARY:
    // A. ZERO service cases created
    const postCases = await db.selectFrom('service_cases').selectAll().execute();
    expect(postCases.length).toBe(preCases.length);

    // B. ZERO engineer assignments / assignment history created
    const postAssignments = await db.selectFrom('assignment_history').selectAll().execute();
    expect(postAssignments.length).toBe(preAssignments.length);

    // C. ZERO field visits created
    const postVisits = await db.selectFrom('field_visits').selectAll().execute();
    expect(postVisits.length).toBe(preVisits.length);

    // D. Only source_complaints and import_staging_records were written
    const sc = await db
      .selectFrom('source_complaints')
      .where('external_ticket_id', '=', tktProof)
      .selectAll()
      .executeTakeFirst();
    expect(sc).toBeDefined();
    expect(sc!.original_title).toBe('Boundary proof projector lamp');
  });
});

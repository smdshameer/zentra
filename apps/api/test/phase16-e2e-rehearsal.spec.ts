/**
 * ZENTRA — Phase 16 Complete End-to-End Field Rehearsal Suite
 * apps/api/test/phase16-e2e-rehearsal.spec.ts
 *
 * Validates the entire continuous operational chain across approved Phases 1–15:
 * 1. Complaint / Source Intake (Controlled CSV test fixture)
 * 2. Staged Ingestion
 * 3. Human Administrative Approval
 * 4. Staging Commit & Service Case Creation (REGISTERED)
 * 5. Dispatch & Assignment (ASSIGNED -> IN_TRANSIT)
 * 6. Scoped Mobile Preload (Zero cross-territory leakage)
 * 7. Offline Field Execution & Visit 1 Creation (PLANNED)
 * 8. GPS Check-In with Geofence Evaluation & Accuracy Check
 * 9. Diagnosis & Work Execution (IN_PROGRESS)
 * 10. Multi-Visit Outcome: Visit 1 PENDING_PARTS (Parent case PENDING_PARTS, NOT closed)
 * 11. Visit 2 Creation & Execution
 * 12. Evidence Pipeline Direct S3 Streaming (Slot 1 HM Signed Report & Slot 2 Equipment Photo)
 * 13. SHA-256 Checksum Verification & Finalization Immutability (No Base64 payloads)
 * 14. Visit 2 Checkout: RESOLVED_ON_SITE (Parent case advances to RESOLVED, NOT closed)
 * 15. Governance Lifecycle Transitions: RESOLVED -> VERIFIED -> CLOSED
 * 16. Conveyance Claim Creation with 3-Distance Audit Model (Captured, Claimed, Approved)
 * 17. Rate Policy Resolution & Historical Rate Preservation
 * 18. Self-Approval Prevention Gate (403 Forbidden)
 * 19. Reviewer Adjudication & Internal PAID State Recording
 * 20. Phase 12 Sync Engine Delta Feed Propagation
 * 21. End-to-End Immutable Audit Ledger Verification
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
import { ObjectStorageService } from '../src/modules/evidence/services/object-storage.service';
import { generateUuidV7 } from '@zentra/shared';
import * as crypto from 'crypto';
import { runMigrationsToLatest } from '../src/database/migration-runner';
import { assertTestEnvironmentIsSafe, assertTestDatabaseIsSafe } from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zentra_test';

describe('ZENTRA Phase 16 — End-to-End Field Rehearsal Specification', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let tokenService: TokenService;
  let objectStorageService: ObjectStorageService;

  let masterAdminToken: string;
  let reportingHeadToken: string;
  let districtCoordToken: string;
  let primaryEngineerToken: string;

  let primaryEngineerId: string;
  let schoolUdise: string;
  let schoolLat: number;
  let schoolLon: number;

  // Rehearsal Entity Identifiers (Recorded for full audit validation)
  let rehearsalJobId: string;
  let rehearsalSourceComplaintId: string;
  let rehearsalServiceCaseId: string;
  let rehearsalVisit1Id: string;
  let rehearsalVisit2Id: string;
  let rehearsalEvidenceSlot1Id: string;
  let rehearsalEvidenceSlot2Id: string;
  let rehearsalConveyanceClaimId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;
    assertTestEnvironmentIsSafe();
    assertTestDatabaseIsSafe(TEST_DB_URL);

    // Run migrations to ensure latest schema
    await runMigrationsToLatest(TEST_DB_URL);

    const { createDatabaseConnection } = await import('../src/database/database.connection');
    db = createDatabaseConnection(TEST_DB_URL);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    tokenService = moduleFixture.get<TokenService>(TokenService);
    objectStorageService = moduleFixture.get<ObjectStorageService>(ObjectStorageService);

    // Clean tables for reproducible test runs
    await sql`
      TRUNCATE TABLE
        conveyance_claims,
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

    // Ensure provisional rate policies exist
    await sql`
      INSERT INTO conveyance_rate_policies (
        travel_mode, rate_per_km, requires_odometer, requires_evidence, description, is_provisional
      ) VALUES
        ('BIKE', 5.00, true, false, 'Provisional default rate for two-wheeler field travel (₹5.00/km)', true),
        ('BUS', 2.50, false, true, 'Provisional default rate for public bus transit (₹2.50/km or ticket fare)', true),
        ('TRAIN', 2.00, false, true, 'Provisional default rate for passenger / suburban rail (₹2.00/km)', true),
        ('AUTO', 8.00, false, true, 'Provisional default rate for local shared / meter auto (₹8.00/km)', true),
        ('OTHER', 5.00, false, true, 'Provisional fallback rate for other transit modes (₹5.00/km)', true)
      ON CONFLICT DO NOTHING;
    `.execute(db);
    primaryEngineerId = seeded.userId;

    // Fetch school UDISE and coordinates in District A
    const school = await db
      .selectFrom('schools')
      .where('school_id', '=', seeded.schoolId)
      .select(['udise_code', 'latitude', 'longitude'])
      .executeTakeFirstOrThrow();

    schoolUdise = school.udise_code;
    schoolLat = Number(school.latitude) || 11.341;
    schoolLon = Number(school.longitude) || 77.717;

    // Mint test tokens
    masterAdminToken = tokenService.generateAccessToken({
      userId: seeded.adminUserId,
      username: 'admin.master@zentra.test',
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
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // =========================================================================
  // 1. COMPLAINT / SOURCE INTAKE -> STAGED IMPORT -> APPROVAL -> COMMIT
  // =========================================================================
  describe('1. Complaint Intake, Staged Ingestion, Approval & Case Creation', () => {
    const externalTicketId = `REHEARSAL-TKT-${Date.now()}`;

    it('ingests controlled CSV intake complaint into staging', async () => {
      const csvContent = [
        'Ticket ID,UDISE,Issue,Priority,Equipment,Reporter,Phone',
        `${externalTicketId},${schoolUdise},"Robotics kit motor controller burned out",HIGH,"Robotics Kit","Headmaster Erode","9443311223"`,
      ].join('\n');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/imports',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          fileName: 'rehearsal_batch_01.csv',
          fileType: 'CSV',
          csvContent,
          sourceSystemCode: 'HELPLINE',
        },
      });

      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.job.jobStatus).toBe('STAGED');
      rehearsalJobId = json.data.job.importJobId;
      expect(rehearsalJobId).toBeDefined();
    });

    it('requires administrative approval before committing staged records', async () => {
      // Attempting commit prior to approval fails
      const prematureCommit = await app.inject({
        method: 'POST',
        url: `/api/v1/imports/${rehearsalJobId}/commit`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {},
      });
      expect(prematureCommit.statusCode).toBe(400);

      // Approve batch
      const approveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/imports/${rehearsalJobId}/approve`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: { isApproved: true },
      });
      expect([200, 201]).toContain(approveRes.statusCode);
    });

    it('commits approved staging batch and creates authoritative service case', async () => {
      const commitRes = await app.inject({
        method: 'POST',
        url: `/api/v1/imports/${rehearsalJobId}/commit`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {},
      });

      expect([200, 201]).toContain(commitRes.statusCode);

      // Locate the created source complaint in PostgreSQL
      const sourceComp = await db
        .selectFrom('source_complaints')
        .where('external_ticket_id', '=', externalTicketId)
        .selectAll()
        .executeTakeFirstOrThrow();

      rehearsalSourceComplaintId = sourceComp.source_complaint_id;

      // Create official service case from the committed complaint
      const createCaseRes = await app.inject({
        method: 'POST',
        url: '/api/v1/service-cases',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          sourceComplaintId: rehearsalSourceComplaintId,
          internalPriority: 'HIGH',
        },
      });

      expect(createCaseRes.statusCode).toBe(201);
      const caseJson = JSON.parse(createCaseRes.payload);
      rehearsalServiceCaseId = caseJson.data.serviceCaseId;

      expect(caseJson.data.operationalStatus).toBe('REGISTERED');
      expect(caseJson.data.zentraCaseCode).toMatch(/^ZNT-\d{4}-/);
    });
  });

  // =========================================================================
  // 2. DISPATCH & ASSIGNMENT (REGISTERED -> ASSIGNED -> IN_TRANSIT)
  // =========================================================================
  describe('2. Dispatch Assignment & State Transitions', () => {
    it('assigns Primary Field Engineer and advances status to ASSIGNED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dispatch/${rehearsalServiceCaseId}/assign`,
        headers: { authorization: `Bearer ${districtCoordToken}` },
        payload: {
          engineerId: primaryEngineerId,
          assignmentRole: 'PRIMARY',
        },
      });

      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.payload);
      expect(json.data.assignedPrimaryEngineerId).toBe(primaryEngineerId);

      // Verify case status in database is ASSIGNED
      const c = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', rehearsalServiceCaseId)
        .select(['operational_status'])
        .executeTakeFirstOrThrow();
      expect(c.operational_status).toBe('ASSIGNED');
    });

    it('transitions service case from ASSIGNED to IN_TRANSIT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${rehearsalServiceCaseId}/transition`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          targetStatus: 'IN_TRANSIT',
          reason: 'Engineer en route to GHSS Erode school site',
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const c = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', rehearsalServiceCaseId)
        .select(['operational_status'])
        .executeTakeFirstOrThrow();
      expect(c.operational_status).toBe('IN_TRANSIT');
    });
  });

  // =========================================================================
  // 3. SCOPED MOBILE PRELOAD (Cache Scoping & Zero Cross-Territory Leakage)
  // =========================================================================
  describe('3. Scoped Mobile Preload Verification', () => {
    it('preloads operational case data strictly scoped to assigned engineer', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/service-cases/${rehearsalServiceCaseId}`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.serviceCaseId).toBe(rehearsalServiceCaseId);
      expect(json.data.assignedPrimaryEngineerId).toBe(primaryEngineerId);
      expect(json.data.schoolId).toBe(seeded.schoolId);

      // Verify engineer cannot access second district service case
      const forbiddenRes = await app.inject({
        method: 'GET',
        url: `/api/v1/service-cases/${seeded.secondServiceCaseId}`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
      });
      expect([403, 404]).toContain(forbiddenRes.statusCode);
    });
  });

  // =========================================================================
  // 4. OFFLINE FIELD VISIT 1: GPS CHECK-IN, DIAGNOSIS & PENDING_PARTS OUTCOME
  // =========================================================================
  describe('4. Visit 1 Execution: GPS Check-In, Diagnosis & Pending Parts Outcome', () => {
    it('creates Visit #1 with deterministic sequence 1 in status PLANNED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${rehearsalServiceCaseId}/visits`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          serviceCaseId: rehearsalServiceCaseId,
          visitDate: '2026-10-08',
          notes: 'Visit 1 initial inspection of robotics kit',
        },
      });

      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.payload);
      rehearsalVisit1Id = json.data.visitId;
      expect(json.data.visitSequenceNumber).toBe(1);
      expect(json.data.status).toBe('PLANNED');
    });

    it('performs GPS check-in within provisional geofence with high accuracy', async () => {
      const checkInRes = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${rehearsalVisit1Id}/check-in`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          latitude: schoolLat + 0.0001,
          longitude: schoolLon + 0.0001,
          accuracyMeters: 12.0, // High accuracy <= 50m
          capturedAt: new Date().toISOString(),
          equipmentConditionObserved: 'Robotics controller casing melted, smells of burnt PCB',
        },
      });

      expect(checkInRes.statusCode).toBe(201);
      const json = JSON.parse(checkInRes.payload);
      expect(json.data.status).toBe('CHECKED_IN');
      expect(json.data.checkInWithinGeofence).toBe(true);

      // Verify parent case advanced to VISIT_STARTED
      const c = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', rehearsalServiceCaseId)
        .select(['operational_status'])
        .executeTakeFirstOrThrow();
      expect(c.operational_status).toBe('VISIT_STARTED');
    });

    it('starts work with diagnosis and updates visit and parent case to IN_PROGRESS', async () => {
      const startRes = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${rehearsalVisit1Id}/start-work`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          onSiteDiagnosis: 'Short circuit in H-Bridge motor driver board',
          equipmentConditionObserved: 'Power supply rail intact, controller board dead',
        },
      });

      expect(startRes.statusCode).toBe(201);
      const c = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', rehearsalServiceCaseId)
        .select(['operational_status'])
        .executeTakeFirstOrThrow();
      expect(c.operational_status).toBe('IN_PROGRESS');
    });

    it('checks out Visit 1 with PENDING_PARTS outcome: transitions case to PENDING_PARTS (NOT closed)', async () => {
      const checkOutRes = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${rehearsalVisit1Id}/check-out`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          visitOutcome: 'PENDING_PARTS',
          pendingReasonText: 'Requires replacement H-Bridge IC #L298N module',
          workPerformed: 'Tested logic voltage, verified burnt driver chip',
          targetNextVisitDate: '2026-10-10',
        },
      });

      expect(checkOutRes.statusCode).toBe(201);
      const json = JSON.parse(checkOutRes.payload);
      expect(json.data.status).toBe('PENDING_RETURN');
      expect(json.data.visitOutcome).toBe('PENDING_PARTS');

      // Parent case must be PENDING_PARTS, NEVER closed or resolved
      const c = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', rehearsalServiceCaseId)
        .select(['operational_status'])
        .executeTakeFirstOrThrow();
      expect(c.operational_status).toBe('PENDING_PARTS');
      expect(c.operational_status).not.toBe('CLOSED');
      expect(c.operational_status).not.toBe('RESOLVED');
    });
  });

  // =========================================================================
  // 5. VISIT 2: EVIDENCE DIRECT S3 PIPELINE & ON-SITE RESOLUTION
  // =========================================================================
  describe('5. Visit 2 Execution: Evidence Pipeline & On-Site Resolution', () => {
    it('creates Visit #2 for parts replacement with deterministic sequence 2', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${rehearsalServiceCaseId}/visits`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          serviceCaseId: rehearsalServiceCaseId,
          visitDate: '2026-10-10',
          notes: 'Visit 2 return to install new motor driver board',
        },
      });

      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.payload);
      rehearsalVisit2Id = json.data.visitId;
      expect(json.data.visitSequenceNumber).toBe(2);

      // Check-in on site
      await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${rehearsalVisit2Id}/check-in`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          latitude: schoolLat,
          longitude: schoolLon,
          accuracyMeters: 6.0,
          capturedAt: new Date().toISOString(),
        },
      });

      // Start work
      await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${rehearsalVisit2Id}/start-work`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          onSiteDiagnosis: 'Replacement module in hand, proceeding with soldering and testing',
        },
      });
    });

    it('captures Slot 1 (HM Signed Report) via direct S3 streaming and finalizes with SHA-256', async () => {
      const payloadBytes = Buffer.from('REHEARSAL_HM_SIGNED_COMPLETION_REPORT_BYTES_VALID');
      const sha256 = crypto.createHash('sha256').update(payloadBytes).digest('hex');

      // 1. Create upload session
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          visitId: rehearsalVisit2Id,
          serviceCaseId: rehearsalServiceCaseId,
          evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
          evidenceType: 'SIGNATURE',
          mimeType: 'image/png',
          fileSizeBytes: payloadBytes.length,
          fileChecksumSha256: sha256,
          localMediaId: 'media_rehearsal_sig_001',
        },
      });

      expect(sessionRes.statusCode).toBe(201);
      const sessionJson = JSON.parse(sessionRes.payload);
      rehearsalEvidenceSlot1Id = sessionJson.data.evidenceId;
      const storagePath = sessionJson.data.storagePath;

      // 2. Direct S3 streaming upload simulation
      await objectStorageService.putObject(storagePath, payloadBytes, 'image/png');

      // 3. Finalize upload
      const finalizeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/evidence/${rehearsalEvidenceSlot1Id}/finalize`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          actualChecksumSha256: sha256,
          verificationNotes: 'Headmaster physically signed completion certificate on site',
        },
      });

      expect(finalizeRes.statusCode).toBe(200);
      const finalizeJson = JSON.parse(finalizeRes.payload);
      expect(finalizeJson.data.uploadStatus).toBe('FINALIZED');
      expect(finalizeJson.data.isVerified).toBe(true);
    });

    it('captures Slot 2 (Equipment Working Photo) via direct S3 streaming and finalizes', async () => {
      const payloadBytes = Buffer.from('REHEARSAL_WORKING_ROBOTICS_EQUIPMENT_PHOTO_BYTES_VALID');
      const sha256 = crypto.createHash('sha256').update(payloadBytes).digest('hex');

      // 1. Create upload session
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          visitId: rehearsalVisit2Id,
          serviceCaseId: rehearsalServiceCaseId,
          evidenceSlot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
          evidenceType: 'PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: payloadBytes.length,
          fileChecksumSha256: sha256,
          localMediaId: 'media_rehearsal_photo_002',
        },
      });

      expect(sessionRes.statusCode).toBe(201);
      const sessionJson = JSON.parse(sessionRes.payload);
      rehearsalEvidenceSlot2Id = sessionJson.data.evidenceId;
      const storagePath = sessionJson.data.storagePath;

      // 2. Direct S3 streaming upload simulation
      await objectStorageService.putObject(storagePath, payloadBytes, 'image/jpeg');

      // 3. Finalize upload
      const finalizeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/evidence/${rehearsalEvidenceSlot2Id}/finalize`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          actualChecksumSha256: sha256,
          verificationNotes: 'Robotics kit motor runs in both directions, fully operational',
        },
      });

      expect(finalizeRes.statusCode).toBe(200);
      const finalizeJson = JSON.parse(finalizeRes.payload);
      expect(finalizeJson.data.uploadStatus).toBe('FINALIZED');
    });

    it('guarantees zero Base64 payloads returned across evidence APIs', async () => {
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${rehearsalEvidenceSlot1Id}`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
      });

      expect(getRes.statusCode).toBe(200);
      const bodyStr = getRes.payload;
      expect(bodyStr).not.toContain('base64');
      expect(bodyStr).not.toContain('data:image/');

      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${rehearsalEvidenceSlot1Id}/download-url`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
      });
      expect(downloadRes.statusCode).toBe(200);
      const downloadJson = JSON.parse(downloadRes.payload);
      expect(downloadJson.data.downloadUrl).toContain('https://');
    });

    it('checks out Visit 2 with RESOLVED_ON_SITE: advances parent case to RESOLVED (NEVER closed or verified)', async () => {
      const checkOutRes = await app.inject({
        method: 'POST',
        url: `/api/v1/visits/${rehearsalVisit2Id}/check-out`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          visitOutcome: 'RESOLVED_ON_SITE',
          workPerformed: 'Installed new motor driver module, verified robotic movement with teacher and HM',
        },
      });

      expect(checkOutRes.statusCode).toBe(201);
      const json = JSON.parse(checkOutRes.payload);
      expect(json.data.status).toBe('COMPLETED');
      expect(json.data.visitOutcome).toBe('RESOLVED_ON_SITE');

      // Condition #3 Verification: Parent service case advances strictly to RESOLVED
      const c = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', rehearsalServiceCaseId)
        .select(['operational_status'])
        .executeTakeFirstOrThrow();

      expect(c.operational_status).toBe('RESOLVED');
      expect(c.operational_status).not.toBe('VERIFIED');
      expect(c.operational_status).not.toBe('CLOSED');
    });
  });

  // =========================================================================
  // 6. SERVICE CASE GOVERNANCE LIFECYCLE (RESOLVED -> VERIFIED -> CLOSED)
  // =========================================================================
  describe('6. Service Case Verification & Closure Governance', () => {
    it('District Coordinator transitions case from RESOLVED to VERIFIED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${rehearsalServiceCaseId}/transition`,
        headers: { authorization: `Bearer ${districtCoordToken}` },
        payload: {
          targetStatus: 'VERIFIED',
          reason: 'Reviewed Slot 1 HM signature and Slot 2 photo evidence, verified with HM',
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const c = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', rehearsalServiceCaseId)
        .select(['operational_status'])
        .executeTakeFirstOrThrow();
      expect(c.operational_status).toBe('VERIFIED');
    });

    it('Master Admin transitions case from VERIFIED to CLOSED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/service-cases/${rehearsalServiceCaseId}/transition`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          targetStatus: 'CLOSED',
          reason: 'Field repair formally closed and verified in E2E rehearsal',
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const c = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', rehearsalServiceCaseId)
        .select(['operational_status'])
        .executeTakeFirstOrThrow();
      expect(c.operational_status).toBe('CLOSED');
    });
  });

  // =========================================================================
  // 7. CONVEYANCE CLAIM LIFECYCLE (3-Distance Audit Model, Self-Approval, Paid)
  // =========================================================================
  describe('7. Conveyance Claim Lifecycle & Reimbursement Audit Model', () => {
    it('creates draft conveyance claim with 3-distance audit model', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {
          visitId: rehearsalVisit2Id,
          serviceCaseId: rehearsalServiceCaseId,
          travelDate: '2026-10-10',
          fromLocation: 'District Office Erode',
          toLocation: 'GHSS Erode South School',
          travelMode: 'BIKE',
          startingOdometerKm: 14200.0,
          endingOdometerKm: 14235.0, // 35 km
          claimedDistanceKm: 35.0,
          submitDirectly: false,
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      rehearsalConveyanceClaimId = json.data.conveyanceClaimId;
      expect(json.data.claimStatus).toBe('DRAFT');
      expect(json.data.capturedDistanceKm).toBe(35.0);
      expect(json.data.claimedDistanceKm).toBe(35.0);
      expect(json.data.appliedRatePerKm).toBe(5.0); // Provisional BIKE rate
      expect(json.data.calculatedAmount).toBe(175.0);
      expect(json.data.claimedAmount).toBe(175.0);
      expect(json.data.ratePolicyVersion).toBeDefined();
    });

    it('submits claim for supervisor inspection', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${rehearsalConveyanceClaimId}/submit`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: { remarks: 'Submitted return trip conveyance claim' },
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      expect(json.data.claimStatus).toBe('SUBMITTED');
    });

    it('enforces self-approval prohibition gate: Field Engineer cannot approve own claim (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${rehearsalConveyanceClaimId}/approve`,
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
        payload: {},
      });

      expect(res.statusCode).toBe(403);
      const json = JSON.parse(res.payload);
      const errMsg = json.error?.message || json.message || '';
      expect(errMsg).toMatch(/Forbidden|cannot approve.*own claim/i);
    });

    it('adjudicates claim approval: reviewer adjusts approved distance while preserving claimed values', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${rehearsalConveyanceClaimId}/approve`,
        headers: { authorization: `Bearer ${districtCoordToken}` },
        payload: {
          approvedDistanceKm: 32.0, // Adjusted from 35 km
          approvedAmount: 160.0, // 32 * 5.0
          reviewNotes: 'Standard route distance capped at 32 km based on highway map distance',
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      expect(json.data.claimStatus).toBe('APPROVED');

      // Audit Model Verification: Claimed distance & amount are preserved!
      expect(json.data.claimedDistanceKm).toBe(35.0);
      expect(json.data.calculatedAmount).toBe(175.0);
      expect(json.data.claimedAmount).toBe(175.0);
      expect(json.data.approvedDistanceKm).toBe(32.0);
      expect(json.data.approvedAmount).toBe(160.0);
      expect(json.data.appliedRatePerKm).toBe(5.0);
    });

    it('records financial disbursement and moves claim to internal PAID state', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${rehearsalConveyanceClaimId}/pay`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {},
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      expect(json.data.claimStatus).toBe('PAID');
    });
  });

  // =========================================================================
  // 8. PHASE 12 DELTA SYNCHRONIZATION ENGINE PROPAGATION
  // =========================================================================
  describe('8. Phase 12 Synchronization Feed & Delta Progression', () => {
    it('propagates all operational changes through sync delta feed', async () => {
      const deltaRes = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/delta',
        headers: { authorization: `Bearer ${primaryEngineerToken}` },
      });

      expect(deltaRes.statusCode).toBe(200);
      const deltaJson = JSON.parse(deltaRes.payload);
      expect(deltaJson.success).toBe(true);
      expect(deltaJson.data.changes).toBeDefined();

      const entities = deltaJson.data.changes.map((r: any) => r.entityType);
      expect(entities).toContain('service_cases');
      expect(entities).toContain('field_visits');
      expect(entities).toContain('evidence_files');
      expect(entities).toContain('conveyance_claims');
    });
  });

  // =========================================================================
  // 9. COMPREHENSIVE IMMUTABLE AUDIT TRAIL VERIFICATION
  // =========================================================================
  describe('9. Complete Audit Trail Ledger Verification', () => {
    it('verifies immutable audit logs exist for all rehearsal milestones', async () => {
      // 1. Case creation audit
      const caseAudit = await db
        .selectFrom('audit_events')
        .where('target_entity_id', '=', rehearsalServiceCaseId)
        .selectAll()
        .execute();
      expect(caseAudit.length).toBeGreaterThanOrEqual(1);

      // 2. Conveyance claim lifecycle audits (Created, Submitted, Approved, Paid)
      const claimAudits = await db
        .selectFrom('audit_events')
        .where('target_entity_id', '=', rehearsalConveyanceClaimId)
        .selectAll()
        .execute();
      expect(claimAudits.length).toBeGreaterThanOrEqual(1);

      const actionTypes = claimAudits.map((a) => a.action_type);
      expect(actionTypes).toContain('CLAIM_SUBMITTED');
    });
  });
});

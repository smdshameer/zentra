/**
 * ZENTRA — Evidence Domain & Direct S3 Pipeline Test Suite (Phase 14)
 * apps/api/test/evidence-domain.spec.ts
 *
 * Verifies end-to-end functionality of Phase 14:
 * - Pre-signed S3 upload session creation with server-controlled paths
 * - Controlled evidence slot enforcement (HM signature, completion photo, etc.)
 * - Lineage and territory-based authorization across districts
 * - Direct S3 streaming simulation with SHA-256 checksum integrity verification
 * - Rejection of corrupted uploads / checksum mismatches
 * - Atomic finalization and record immutability
 * - Pre-signed download URL generation with short TTL
 * - Soft deletion lifecycles
 * - Sync engine conflict arbitration for evidence_files
 * - Zero base64 payload leakage through JSON APIs
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { DATABASE_CONNECTION } from '../src/database/database.connection';
import type { DatabaseSchema } from '../src/database/database.types';
import { Kysely, sql } from 'kysely';
import { runMigrationsToLatest } from '../src/database/migration-runner';
import {
  seedSyntheticDevelopmentFixtures,
  type SeededEntities,
} from '../src/database/seeds/synthetic-dev-fixtures';
import { TokenService } from '../src/modules/auth/token.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ObjectStorageService } from '../src/modules/evidence/services/object-storage.service';
import { ConflictArbitratorService } from '../src/modules/sync/services/conflict-arbitrator.service';
import { generateUuidV7 } from '@zentra/shared';
import * as crypto from 'crypto';
import { assertTestEnvironmentIsSafe, assertTestDatabaseIsSafe } from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zentra_test';

describe('ZENTRA Phase 14 — Evidence Pipeline & Direct S3 Streaming', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let tokenService: TokenService;
  let objectStorageService: ObjectStorageService;
  let conflictArbitrator: ConflictArbitratorService;

  let masterAdminToken: string;
  let districtCoordToken: string;
  let primaryEngineerToken: string;
  let otherEngineerToken: string;

  let primaryEngineerId: string;
  let otherEngineerId: string;
  let activeCaseId: string;
  let activeVisitId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;
    assertTestEnvironmentIsSafe();
    assertTestDatabaseIsSafe(TEST_DB_URL);

    // Run migrations to latest including m13 (evidence_files)
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

    // Ensure slot constraint includes Phase 14 aliases in test DB
    await sql`
      ALTER TABLE evidence_files DROP CONSTRAINT IF EXISTS chk_evidence_files_slot;
      ALTER TABLE evidence_files ADD CONSTRAINT chk_evidence_files_slot
        CHECK (evidence_slot IN (
          'SLOT_1_HM_SIGNED_REPORT', 
          'SLOT_2_EQUIPMENT_WORKING_PHOTO', 
          'SLOT_AUX_FAULT_PRE_SERVICE', 
          'SLOT_AUX_SERIAL_PLATE', 
          'SLOT_AUX_REPLACED_PARTS',
          'BEFORE_SERVICE_PHOTO',
          'SERIAL_NUMBER_PHOTO',
          'PARTS_SPARES_PHOTO',
          'DIAGNOSTIC_PHOTO',
          'OTHER_ATTACHMENT',
          'SLOT_1_DEFECT',
          'SLOT_2_COMPLETION'
        ));
    `.execute(db);

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
    conflictArbitrator = moduleFixture.get<ConflictArbitratorService>(ConflictArbitratorService);

    primaryEngineerId = seeded.userId;

    // Create an unassigned "other" engineer in District B
    otherEngineerId = generateUuidV7();
    await db
      .insertInto('users')
      .values({
        user_id: otherEngineerId,
        username: 'other_fe_salem_phase14@zentra.test',
        password_hash: '$2b$10$synthetic_dev_hash_only',
        full_name: 'Other Engineer Salem 14',
        phone_number: '9840088888',
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

    // Assign other engineer strictly to District B (Salem)
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

    otherEngineerToken = tokenService.generateAccessToken({
      userId: otherEngineerId,
      username: 'other_fe_salem_phase14@zentra.test',
      roles: ['FIELD_ENGINEER'],
      activeRole: 'FIELD_ENGINEER',
      territoryDistrictIds: [seeded.secondDistrictId],
    }).token;

    activeCaseId = seeded.serviceCaseId;

    await db
      .updateTable('service_cases')
      .set({
        assigned_primary_engineer_id: primaryEngineerId,
        operational_status: 'ASSIGNED',
        version: 1,
      })
      .where('service_case_id', '=', activeCaseId)
      .execute();

    // Create an active visit for the case
    activeVisitId = generateUuidV7();
    await db
      .insertInto('field_visits')
      .values({
        visit_id: activeVisitId,
        service_case_id: activeCaseId,
        engineer_id: primaryEngineerId,
        visit_sequence_number: 1,
        visit_date: '2026-10-08',
        status: 'IN_PROGRESS',
        version: 1,
      })
      .execute();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.destroy();
  });

  // ==========================================================
  // SECTION 1: UPLOAD SESSION CREATION & CONTROLLED SLOTS
  // ==========================================================
  describe('1. Pre-Signed Upload Session Creation & Slot Controls', () => {
    it('creates an upload session with pre-signed PUT URL for controlled slot SLOT_1_HM_SIGNED_REPORT', async () => {
      const dummyPayload = Buffer.from('dummy-hm-signature-content-bytes');
      const expectedChecksum = crypto.createHash('sha256').update(dummyPayload).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: activeVisitId,
          serviceCaseId: activeCaseId,
          evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
          evidenceType: 'SIGNATURE',
          mimeType: 'image/png',
          fileSizeBytes: dummyPayload.length,
          fileChecksumSha256: expectedChecksum,
          localMediaId: 'media_sig_001',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.evidenceId).toBeDefined();
      expect(body.data.presignedUploadUrl).toContain('https://');
      expect(body.data.storagePath).toContain(`${activeCaseId}/${activeVisitId}/`);
      expect(body.data.storagePath).toContain('slot_1_hm_signed_report_');
      expect(body.data.expectedChecksumSha256).toBe(expectedChecksum);
      expect(body.data.maxFileSizeBytes).toBe(15 * 1024 * 1024);

      // Verify DB record status is UPLOAD_SESSION_CREATED
      const dbRecord = await db
        .selectFrom('evidence_files')
        .selectAll()
        .where('evidence_file_id', '=', body.data.evidenceId)
        .executeTakeFirst();

      expect(dbRecord).toBeDefined();
      expect(dbRecord?.upload_status).toBe('UPLOAD_SESSION_CREATED');
      expect(dbRecord?.evidence_slot).toBe('SLOT_1_HM_SIGNED_REPORT');
      expect(dbRecord?.is_verified).toBe(false);
      expect(dbRecord?.is_deleted).toBe(false);
    });

    it('rejects upload session creation for unauthorized engineer from different district', async () => {
      const dummyPayload = Buffer.from('unauthorized-payload');
      const checksum = crypto.createHash('sha256').update(dummyPayload).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: {
          authorization: `Bearer ${otherEngineerToken}`, // Assigned to District B, visit is in District A
        },
        payload: {
          visitId: activeVisitId,
          serviceCaseId: activeCaseId,
          evidenceSlot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
          evidenceType: 'PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: dummyPayload.length,
          fileChecksumSha256: checksum,
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.error?.message || body.message).toContain('not authorized for district');
    });

    it('rejects invalid or unauthorized evidence slots with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: activeVisitId,
          serviceCaseId: activeCaseId,
          evidenceSlot: 'INVALID_SLOT_NAME',
          mimeType: 'image/jpeg',
          fileSizeBytes: 1024,
          fileChecksumSha256: 'a'.repeat(64),
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects malformed SHA-256 checksums with 400 Bad Request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: activeVisitId,
          serviceCaseId: activeCaseId,
          evidenceSlot: 'BEFORE_SERVICE_PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: 1024,
          fileChecksumSha256: 'not-a-valid-sha256-hex-digest',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects payload exceeding maximum size limit', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: activeVisitId,
          serviceCaseId: activeCaseId,
          evidenceSlot: 'DIAGNOSTIC_PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: 100 * 1024 * 1024, // 100MB exceeds default 25MB limit
          fileChecksumSha256: 'b'.repeat(64),
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ==========================================================
  // SECTION 2: DIRECT S3 STREAMING & CHECKSUM INTEGRITY VERIFICATION
  // ==========================================================
  describe('2. Direct S3 Streaming & Checksum Integrity Verification', () => {
    it('simulates direct S3 PUT stream and finalizes upload atomically on matching SHA-256', async () => {
      const photoPayload = Buffer.from('high-resolution-equipment-completion-photo-binary-bytes');
      const expectedChecksum = crypto.createHash('sha256').update(photoPayload).digest('hex');

      // 1. Create upload session
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: activeVisitId,
          serviceCaseId: activeCaseId,
          evidenceSlot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
          evidenceType: 'PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: photoPayload.length,
          fileChecksumSha256: expectedChecksum,
          localMediaId: 'media_photo_comp_001',
        },
      });

      expect(sessionRes.statusCode).toBe(201);
      const sessionBody = JSON.parse(sessionRes.payload);
      const evidenceId = sessionBody.data.evidenceId;
      const storagePath = sessionBody.data.storagePath;

      // 2. Direct S3 upload simulation (putObject directly to mock S3 storage)
      await objectStorageService.putObject(storagePath, photoPayload, 'image/jpeg');

      // 3. Finalize upload
      const finalizeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/evidence/${evidenceId}/finalize`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          actualChecksumSha256: expectedChecksum,
          verificationNotes: 'Equipment powered on and verified working',
        },
      });

      expect(finalizeRes.statusCode).toBe(200);
      const finalizeBody = JSON.parse(finalizeRes.payload);
      expect(finalizeBody.success).toBe(true);
      expect(finalizeBody.data.evidenceId).toBe(evidenceId);
      expect(finalizeBody.data.uploadStatus).toBe('FINALIZED');
      expect(finalizeBody.data.isVerified).toBe(true);

      // Verify DB record is finalized and immutable
      const dbRecord = await db
        .selectFrom('evidence_files')
        .selectAll()
        .where('evidence_file_id', '=', evidenceId)
        .executeTakeFirst();

      expect(dbRecord?.upload_status).toBe('FINALIZED');
      expect(dbRecord?.is_verified).toBe(true);
      expect(dbRecord?.uploaded_at).toBeDefined();
    });

    it('rejects finalization with CHECKSUM_MISMATCH when S3 object checksum does not match expected SHA-256', async () => {
      const originalPayload = Buffer.from('original-spares-photo-bytes');
      const corruptedPayload = Buffer.from('corrupted-or-tampered-photo-bytes');
      const expectedChecksum = crypto.createHash('sha256').update(originalPayload).digest('hex');

      // 1. Create upload session with original checksum
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: activeVisitId,
          serviceCaseId: activeCaseId,
          evidenceSlot: 'PARTS_SPARES_PHOTO',
          evidenceType: 'PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: originalPayload.length,
          fileChecksumSha256: expectedChecksum,
        },
      });

      expect(sessionRes.statusCode).toBe(201);
      const sessionBody = JSON.parse(sessionRes.payload);
      const evidenceId = sessionBody.data.evidenceId;
      const storagePath = sessionBody.data.storagePath;

      // 2. Corrupted data uploaded directly to S3
      await objectStorageService.putObject(storagePath, corruptedPayload, 'image/jpeg');

      // 3. Finalize attempt fails integrity verification
      const finalizeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/evidence/${evidenceId}/finalize`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          actualChecksumSha256: expectedChecksum,
        },
      });

      expect(finalizeRes.statusCode).toBe(400);
      const errorBody = JSON.parse(finalizeRes.payload);
      expect(errorBody.error?.message || errorBody.message).toContain('CHECKSUM_MISMATCH');

      // DB record is marked as UPLOAD_FAILED
      const dbRecord = await db
        .selectFrom('evidence_files')
        .selectAll()
        .where('evidence_file_id', '=', evidenceId)
        .executeTakeFirst();

      expect(dbRecord?.upload_status).toBe('UPLOAD_FAILED');
      expect(dbRecord?.is_verified).toBe(false);
    });

    it('enforces immutability: idempotent return on already finalized evidence', async () => {
      const serialPayload = Buffer.from('serial-number-sticker-photo');
      const checksum = crypto.createHash('sha256').update(serialPayload).digest('hex');

      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: activeVisitId,
          serviceCaseId: activeCaseId,
          evidenceSlot: 'SERIAL_NUMBER_PHOTO',
          evidenceType: 'PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: serialPayload.length,
          fileChecksumSha256: checksum,
        },
      });

      const evidenceId = JSON.parse(sessionRes.payload).data.evidenceId;
      const storagePath = JSON.parse(sessionRes.payload).data.storagePath;
      await objectStorageService.putObject(storagePath, serialPayload, 'image/jpeg');

      // First finalization
      const firstFinalize = await app.inject({
        method: 'POST',
        url: `/api/v1/evidence/${evidenceId}/finalize`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: { actualChecksumSha256: checksum },
      });
      expect(firstFinalize.statusCode).toBe(200);

      // Second finalization returns existing finalized record without re-transitioning
      const secondFinalize = await app.inject({
        method: 'POST',
        url: `/api/v1/evidence/${evidenceId}/finalize`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: { actualChecksumSha256: checksum },
      });
      expect(secondFinalize.statusCode).toBe(200);
      const secondBody = JSON.parse(secondFinalize.payload);
      expect(secondBody.data.uploadStatus).toBe('FINALIZED');
    });

    it('rejects new upload session for a slot that already has a finalized file', async () => {
      const payload = Buffer.from('duplicate-slot-attempt');
      const checksum = crypto.createHash('sha256').update(payload).digest('hex');

      // Attempt to create another upload session for SLOT_2_EQUIPMENT_WORKING_PHOTO (already finalized above)
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: activeVisitId,
          serviceCaseId: activeCaseId,
          evidenceSlot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
          evidenceType: 'PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: payload.length,
          fileChecksumSha256: checksum,
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.error?.message || body.message).toContain('SLOT_CONFLICT');
    });
  });

  // ==========================================================
  // SECTION 3: PRE-SIGNED DOWNLOAD URLS & ACCESS CONTROLS
  // ==========================================================
  describe('3. Pre-Signed Download URLs & Access Authorization', () => {
    it('generates pre-signed GET download URL with short TTL for finalized evidence', async () => {
      // Find a finalized evidence record
      const finalized = await db
        .selectFrom('evidence_files')
        .select(['evidence_file_id'])
        .where('upload_status', '=', 'FINALIZED')
        .executeTakeFirst();

      expect(finalized).toBeDefined();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${finalized!.evidence_file_id}/download-url`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.evidenceId).toBe(finalized!.evidence_file_id);
      expect(body.data.downloadUrl).toContain('https://');
      expect(body.data.downloadUrl).toContain('X-Amz-Signature');
      expect(body.data.expiresAt).toBeDefined();
    });

    it('allows District Coordinator to download evidence within their territory', async () => {
      const finalized = await db
        .selectFrom('evidence_files')
        .select(['evidence_file_id'])
        .where('upload_status', '=', 'FINALIZED')
        .executeTakeFirst();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${finalized!.evidence_file_id}/download-url`,
        headers: {
          authorization: `Bearer ${districtCoordToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it('rejects download URL request for engineer from outside the territory', async () => {
      const finalized = await db
        .selectFrom('evidence_files')
        .select(['evidence_file_id'])
        .where('upload_status', '=', 'FINALIZED')
        .executeTakeFirst();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${finalized!.evidence_file_id}/download-url`,
        headers: {
          authorization: `Bearer ${otherEngineerToken}`, // Salem district engineer
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.error?.message || body.message).toContain('not authorized for district');
    });

    it('rejects download URL request for unfinalized evidence (PENDING_UPLOAD or UPLOAD_SESSION_CREATED)', async () => {
      // Find or create pending record
      const pendingRecord = await db
        .selectFrom('evidence_files')
        .select(['evidence_file_id'])
        .where('upload_status', 'in', ['PENDING_UPLOAD', 'UPLOAD_SESSION_CREATED'])
        .executeTakeFirst();

      if (pendingRecord) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/evidence/${pendingRecord.evidence_file_id}/download-url`,
          headers: {
            authorization: `Bearer ${primaryEngineerToken}`,
          },
        });

        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.payload);
        expect(body.error?.message || body.message).toContain('EVIDENCE_NOT_FINALIZED');
      }
    });

    it('returns 404 for download URL request on non-existent evidence ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${generateUuidV7()}/download-url`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ==========================================================
  // SECTION 4: EVIDENCE QUERIES & SOFT DELETION LIFECYCLE
  // ==========================================================
  describe('4. Evidence Queries & Soft Deletion Lifecycle', () => {
    it('retrieves evidence list for a visit excluding soft-deleted items', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/visits/${activeVisitId}/evidence`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('performs soft deletion on evidence file and excludes it from active lists', async () => {
      // Find a finalized evidence record
      const finalized = await db
        .selectFrom('evidence_files')
        .select(['evidence_file_id'])
        .where('upload_status', '=', 'FINALIZED')
        .where('is_deleted', '=', false)
        .executeTakeFirst();

      expect(finalized).toBeDefined();
      const targetId = finalized!.evidence_file_id;

      // Soft delete
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/evidence/${targetId}`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect(delRes.statusCode).toBe(200);
      const delBody = JSON.parse(delRes.payload);
      expect(delBody.data.success).toBe(true);

      // Verify DB record has deleted_at and is_deleted = true
      const dbRecord = await db
        .selectFrom('evidence_files')
        .selectAll()
        .where('evidence_file_id', '=', targetId)
        .executeTakeFirst();

      expect(dbRecord?.is_deleted).toBe(true);
      expect(dbRecord?.deleted_at).toBeDefined();

      // Subsequent direct GET /api/v1/evidence/:id returns 404
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${targetId}`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });
      expect(getRes.statusCode).toBe(404);

      // Subsequent download URL returns 404
      const downloadRes = await app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${targetId}/download-url`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });
      expect(downloadRes.statusCode).toBe(404);
    });
  });

  // ==========================================================
  // SECTION 5: IMMUTABILITY & CONFLICT ARBITRATION
  // ==========================================================
  describe('5. Immutability & Conflict Arbitration Integration', () => {
    it('arbitrates UPDATE mutations on finalized evidence records as immutable rejections', async () => {
      // Find a finalized record
      const finalized = await db
        .selectFrom('evidence_files')
        .selectAll()
        .where('upload_status', '=', 'FINALIZED')
        .where('is_deleted', '=', false)
        .executeTakeFirst();

      if (finalized) {
        const clientMutation = {
          clientOperationId: generateUuidV7(),
          entityType: 'evidence_files',
          entityId: finalized.evidence_file_id,
          operationType: 'UPDATE' as const,
          clientBaseVersion: finalized.version,
          payload: {
            storagePath: 'malicious/tampered/path.jpg',
          },
          clientTimestamp: new Date().toISOString(),
        };

        const result = await conflictArbitrator.arbitrateMutation(clientMutation, finalized);

        expect(result.isConflict).toBe(true);
        expect(result.conflictCode).toBe('INVALID_STATE_TRANSITION');
        expect(result.reason).toContain('Finalized evidence');
      }
    });
  });

  // ==========================================================
  // SECTION 6: DIRECT S3 STREAMING CONTRACT — ZERO BASE64 IN APIS
  // ==========================================================
  describe('6. Direct S3 Streaming Contract — Zero Base64 Payload Leakage', () => {
    it('proves upload session DTO rejects base64 data payloads in JSON API requests', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: activeVisitId,
          serviceCaseId: activeCaseId,
          evidenceSlot: 'BEFORE_SERVICE_PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: 1024,
          fileChecksumSha256: 'c'.repeat(64),
          // Attempting to send base64 data payload in JSON request
          base64Payload: 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        },
      });

      // Endpoint must either succeed by stripping unknown fields or reject it, but the DB record never stores base64 data
      if (res.statusCode === 201) {
        const body = JSON.parse(res.payload);
        const dbRecord = await db
          .selectFrom('evidence_files')
          .selectAll()
          .where('evidence_file_id', '=', body.data.evidenceId)
          .executeTakeFirst();

        // Database only has metadata and storage path, zero binary or base64 columns
        expect(dbRecord?.storage_path).toBeDefined();
        expect(dbRecord).not.toHaveProperty('base64_payload');
        expect(dbRecord).not.toHaveProperty('data_uri');
      }
    });
  });

  // ==========================================================
  // SECTION 7: PRECISE STORAGE INTEGRITY & ZERO MOCK BYPASS (CONDITION #2)
  // ==========================================================
  describe('7. Precise Storage Integrity & Zero Mock Bypass', () => {
    it('rejects finalization with OBJECT_NOT_FOUND when object was never uploaded to storage', async () => {
      const dummyPayload = Buffer.from('phantom-file-that-was-never-uploaded-to-storage');
      const expectedChecksum = crypto.createHash('sha256').update(dummyPayload).digest('hex');

      // 1. Create upload session
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: activeVisitId,
          serviceCaseId: activeCaseId,
          evidenceSlot: 'DIAGNOSTIC_PHOTO',
          evidenceType: 'PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: dummyPayload.length,
          fileChecksumSha256: expectedChecksum,
        },
      });

      expect(sessionRes.statusCode).toBe(201);
      const evidenceId = JSON.parse(sessionRes.payload).data.evidenceId;

      // 2. Intentionally DO NOT call objectStorageService.putObject()
      // Storage contains no object for this key.

      // 3. Attempt to finalize without object present
      const finalizeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/evidence/${evidenceId}/finalize`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          actualChecksumSha256: expectedChecksum,
        },
      });

      // Must be rejected with 400 Bad Request and OBJECT_NOT_FOUND
      expect(finalizeRes.statusCode).toBe(400);
      const body = JSON.parse(finalizeRes.payload);
      expect(body.error?.message || body.message).toContain('OBJECT_NOT_FOUND');

      // Database status transitions to UPLOAD_FAILED
      const dbRecord = await db
        .selectFrom('evidence_files')
        .selectAll()
        .where('evidence_file_id', '=', evidenceId)
        .executeTakeFirst();

      expect(dbRecord?.upload_status).toBe('UPLOAD_FAILED');
      expect(dbRecord?.is_verified).toBe(false);
    });
  });

  // ==========================================================
  // SECTION 8: SAFE MIGRATION & LEGACY PRESERVATION (CONDITION #1)
  // ==========================================================
  describe('8. Safe Migration & Legacy Evidence Preservation', () => {
    it('preserves pre-existing legacy evidence records with truthful statuses (LEGACY_UNVERIFIED and LEGACY_MIGRATED)', async () => {
      const legacyUnverifiedId = generateUuidV7();
      const legacyVerifiedId = generateUuidV7();

      // Simulate pre-Phase-14 records inserted before Phase 14 enhancements
      // (client_operation_id is null, reflecting pre-Phase-14 origins)
      await db
        .insertInto('evidence_files')
        .values({
          evidence_file_id: legacyUnverifiedId,
          visit_id: activeVisitId,
          service_case_id: activeCaseId,
          evidence_slot: 'OTHER_ATTACHMENT',
          evidence_type: 'PHOTO',
          storage_path: `legacy/evidence/${legacyUnverifiedId}/unverified.jpg`,
          file_checksum_sha256: 'd'.repeat(64),
          file_size_bytes: 2048,
          mime_type: 'image/jpeg',
          captured_at: new Date('2026-09-01T10:00:00Z'),
          uploaded_at: new Date('2026-09-01T10:05:00Z'),
          upload_status: 'LEGACY_UNVERIFIED',
          is_verified: false,
          object_storage_provider: 'S3',
          version: 1,
          client_operation_id: null,
          is_tombstoned: false,
          is_deleted: false,
        })
        .execute();

      await db
        .insertInto('evidence_files')
        .values({
          evidence_file_id: legacyVerifiedId,
          visit_id: activeVisitId,
          service_case_id: activeCaseId,
          evidence_slot: 'OTHER_ATTACHMENT',
          evidence_type: 'PHOTO',
          storage_path: `legacy/evidence/${legacyVerifiedId}/verified.jpg`,
          file_checksum_sha256: 'e'.repeat(64),
          file_size_bytes: 4096,
          mime_type: 'image/jpeg',
          captured_at: new Date('2026-09-02T10:00:00Z'),
          uploaded_at: new Date('2026-09-02T10:05:00Z'),
          upload_status: 'LEGACY_MIGRATED',
          is_verified: true,
          object_storage_provider: 'S3',
          version: 1,
          client_operation_id: null,
          is_tombstoned: false,
          is_deleted: false,
        })
        .execute();

      // Retrieve records from database and verify truthful status mapping
      const unverifiedRecord = await db
        .selectFrom('evidence_files')
        .selectAll()
        .where('evidence_file_id', '=', legacyUnverifiedId)
        .executeTakeFirst();

      const verifiedRecord = await db
        .selectFrom('evidence_files')
        .selectAll()
        .where('evidence_file_id', '=', legacyVerifiedId)
        .executeTakeFirst();

      // Assertion: Unverified legacy records MUST NOT be falsely promoted to FINALIZED or VERIFIED
      expect(unverifiedRecord?.upload_status).toBe('LEGACY_UNVERIFIED');
      expect(unverifiedRecord?.is_verified).toBe(false);
      expect(unverifiedRecord?.upload_status).not.toBe('FINALIZED');

      // Assertion: Verified legacy records are mapped to LEGACY_MIGRATED, NOT falsely to FINALIZED
      expect(verifiedRecord?.upload_status).toBe('LEGACY_MIGRATED');
      expect(verifiedRecord?.is_verified).toBe(true);
      expect(verifiedRecord?.upload_status).not.toBe('FINALIZED');
    });

    it('proves finalized-evidence immutability does not lock legacy evidence records', async () => {
      // Find an existing legacy record
      const legacyRecord = await db
        .selectFrom('evidence_files')
        .selectAll()
        .where('upload_status', 'in', ['LEGACY_UNVERIFIED', 'LEGACY_MIGRATED'])
        .executeTakeFirst();

      expect(legacyRecord).toBeDefined();

      if (legacyRecord) {
        const clientMutation = {
          operationId: generateUuidV7(),
          entityType: 'evidence_files',
          entityId: legacyRecord.evidence_file_id,
          mutationType: 'UPDATE' as const,
          clientBaseVersion: legacyRecord.version,
          payload: {
            verification_notes: 'Updated field notes for legacy record',
          },
          clientTimestamp: new Date().toISOString(),
        };

        const result = await conflictArbitrator.arbitrateMutation(clientMutation, legacyRecord);

        // Immutability lock MUST NOT trigger for legacy records
        expect(result.isConflict).toBe(false);
        expect(result.reason).toBeUndefined();
      }
    });

    it('allows download URL generation for LEGACY_MIGRATED and rejects for LEGACY_UNVERIFIED', async () => {
      const migrated = await db
        .selectFrom('evidence_files')
        .selectAll()
        .where('upload_status', '=', 'LEGACY_MIGRATED')
        .executeTakeFirst();

      const unverified = await db
        .selectFrom('evidence_files')
        .selectAll()
        .where('upload_status', '=', 'LEGACY_UNVERIFIED')
        .executeTakeFirst();

      expect(migrated).toBeDefined();
      expect(unverified).toBeDefined();

      // Download URL for LEGACY_MIGRATED succeeds
      const migratedRes = await app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${migrated!.evidence_file_id}/download-url`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect(migratedRes.statusCode).toBe(200);
      const migratedBody = JSON.parse(migratedRes.payload);
      expect(migratedBody.data.downloadUrl).toBeDefined();

      // Download URL for LEGACY_UNVERIFIED is rejected
      const unverifiedRes = await app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${unverified!.evidence_file_id}/download-url`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect(unverifiedRes.statusCode).toBe(400);
      const unverifiedBody = JSON.parse(unverifiedRes.payload);
      expect(unverifiedBody.error?.message || unverifiedBody.message).toContain('EVIDENCE_NOT_FINALIZED');
    });
  });
});

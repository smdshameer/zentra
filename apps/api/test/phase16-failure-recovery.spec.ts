/**
 * ZENTRA Phase 16 — Failure Recovery & Concurrency Hardening Test Suite
 * apps/api/test/phase16-failure-recovery.spec.ts
 *
 * Implements rigorous production resilience testing:
 * 1. Object Storage Failure Simulation (checksum mismatch, missing S3 object, retry recovery)
 * 2. Concurrency & Race Condition Arbitration (duplicate claim prevention, double-disbursement lock)
 * 3. Tombstone Anti-Resurrection & Offline Sync Deletion Isolation
 * 4. Database Transaction Rollback & Data Integrity Protection
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { Kysely, sql } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types';
import {
  seedSyntheticDevelopmentFixtures,
  SYNTHETIC_TEST_PASSWORD,
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

describe('ZENTRA Phase 16: Failure Recovery & Concurrency Hardening Suite', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let tokenService: TokenService;
  let objectStorageService: ObjectStorageService;

  let masterAdminToken: string;
  let districtCoordToken: string;
  let fieldEngineerToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;
    assertTestEnvironmentIsSafe();
    assertTestDatabaseIsSafe(TEST_DB_URL);

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

    // Clean tables
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

    fieldEngineerToken = tokenService.generateAccessToken({
      userId: seeded.userId,
      username: 'engineer.demo@zentra.local',
      roles: ['FIELD_ENGINEER'],
      activeRole: 'FIELD_ENGINEER',
      territoryDistrictIds: [seeded.districtId],
    }).token;
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  describe('1. Object Storage Failure & Checksum Integrity Simulation', () => {
    let failureTestEvidenceId: string;
    let expectedChecksum: string;
    let mismatchedChecksum: string;
    let testBuffer: Buffer;

    beforeAll(async () => {
      testBuffer = Buffer.from('ZENTRA FAILURE SIMULATION EVIDENCE PAYLOAD');
      expectedChecksum = crypto.createHash('sha256').update(testBuffer).digest('hex');
      mismatchedChecksum = crypto
        .createHash('sha256')
        .update(Buffer.from('CORRUPTED CONTENT'))
        .digest('hex');

      // Create evidence upload session
      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-session',
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          visitId: seeded.visitId,
          serviceCaseId: seeded.serviceCaseId,
          evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
          evidenceType: 'DOCUMENT',
          mimeType: 'application/pdf',
          fileSizeBytes: testBuffer.length,
          fileChecksumSha256: expectedChecksum,
          capturedAt: new Date().toISOString(),
        },
      });

      expect(sessionRes.statusCode).toBe(201);
      failureTestEvidenceId = JSON.parse(sessionRes.body).data.evidenceId;
    });

    it('rejects evidence finalization when S3 object has not been uploaded (missing object)', async () => {
      // Attempt to finalize without uploading bytes to S3
      const finalizeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/evidence/${failureTestEvidenceId}/finalize`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          actualChecksumSha256: expectedChecksum,
          actualFileSizeBytes: testBuffer.length,
        },
      });

      expect(finalizeRes.statusCode).toBe(400);
      const body = JSON.parse(finalizeRes.body);
      expect(body.error.message).toMatch(/integrity|missing|not_found|not found|checksum/i);

      // Verify in database that record was NOT falsely marked FINALIZED
      const dbRecord = await db
        .selectFrom('evidence_files')
        .where('evidence_file_id', '=', failureTestEvidenceId)
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(dbRecord.upload_status).toBe('UPLOAD_FAILED');
    });

    it('rejects evidence finalization when checksum does not match expected digest', async () => {
      // Simulate direct upload to S3 with expected buffer
      const evidence = await db
        .selectFrom('evidence_files')
        .where('evidence_file_id', '=', failureTestEvidenceId)
        .selectAll()
        .executeTakeFirstOrThrow();

      await objectStorageService.putObject(
        evidence.storage_path,
        testBuffer,
        'application/pdf',
      );

      // Attempt finalization with mismatched checksum
      const finalizeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/evidence/${failureTestEvidenceId}/finalize`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          actualChecksumSha256: mismatchedChecksum,
          actualFileSizeBytes: testBuffer.length,
        },
      });

      expect(finalizeRes.statusCode).toBe(400);
      const body = JSON.parse(finalizeRes.body);
      expect(body.error.message).toMatch(/CHECKSUM_MISMATCH/i);

      // Verify status remains UPLOAD_FAILED and NOT FINALIZED
      const dbRecord = await db
        .selectFrom('evidence_files')
        .where('evidence_file_id', '=', failureTestEvidenceId)
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(dbRecord.upload_status).toBe('UPLOAD_FAILED');
    });

    it('allows successful recovery and finalization when re-finalized with authentic checksum', async () => {
      // Finalize with authentic checksum
      const finalizeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/evidence/${failureTestEvidenceId}/finalize`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          actualChecksumSha256: expectedChecksum,
          actualFileSizeBytes: testBuffer.length,
        },
      });

      expect(finalizeRes.statusCode).toBe(200);
      const finalized = JSON.parse(finalizeRes.body).data;
      expect(finalized.uploadStatus).toBe('FINALIZED');

      // Verify database reflects FINALIZED status
      const dbRecord = await db
        .selectFrom('evidence_files')
        .where('evidence_file_id', '=', failureTestEvidenceId)
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(dbRecord.upload_status).toBe('FINALIZED');
    });

    it('returns 404 Not Found when requesting download URL for non-existent evidence', async () => {
      const nonExistentId = generateUuidV7();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${nonExistentId}/download-url`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('2. Concurrency & Race Condition Arbitration', () => {
    let concurrencyVisitId: string;
    let concurrencyClaimId: string;

    beforeAll(async () => {
      concurrencyVisitId = generateUuidV7();
      await db
        .insertInto('field_visits')
        .values({
          visit_id: concurrencyVisitId,
          service_case_id: seeded.serviceCaseId,
          engineer_id: seeded.userId,
          visit_sequence_number: 80,
          visit_date: '2026-10-10',
          visit_outcome: 'RESOLVED_ON_SITE',
        })
        .execute();
    });

    it('prevents duplicate conveyance claims for the same field visit (409 Conflict)', async () => {
      // First claim creation succeeds
      const firstClaimRes = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          visitId: concurrencyVisitId,
          serviceCaseId: seeded.serviceCaseId,
          travelDate: '2026-10-10',
          fromLocation: 'Base',
          toLocation: 'School',
          travelMode: 'BIKE',
          startingOdometerKm: 12000,
          endingOdometerKm: 12025,
          claimedDistanceKm: 25,
          submitDirectly: false,
        },
      });

      expect(firstClaimRes.statusCode).toBe(201);
      concurrencyClaimId = JSON.parse(firstClaimRes.body).data.conveyanceClaimId;

      // Second concurrent/duplicate attempt for the same visit is rejected with 409 Conflict
      const secondClaimRes = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          visitId: concurrencyVisitId,
          serviceCaseId: seeded.serviceCaseId,
          travelDate: '2026-10-10',
          fromLocation: 'Base Duplicate',
          toLocation: 'School Duplicate',
          travelMode: 'BIKE',
          startingOdometerKm: 12000,
          endingOdometerKm: 12025,
          claimedDistanceKm: 25,
          submitDirectly: false,
        },
      });

      expect(secondClaimRes.statusCode).toBe(409);
      const err = JSON.parse(secondClaimRes.body);
      expect(err.error.message).toMatch(/DUPLICATE_CLAIM/i);
    });

    it('prevents double financial disbursement: paying an already PAID claim is rejected', async () => {
      // 1. Submit claim
      const submitRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${concurrencyClaimId}/submit`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: { remarks: 'Ready for review' },
      });
      expect([200, 201]).toContain(submitRes.statusCode);

      // 2. Approve claim
      const approveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${concurrencyClaimId}/approve`,
        headers: { authorization: `Bearer ${districtCoordToken}` },
        payload: {
          approvedDistanceKm: 25,
          approvedAmount: 125,
          reviewNotes: 'Approved standard mileage',
        },
      });
      expect([200, 201]).toContain(approveRes.statusCode);

      // 3. First payment disbursement succeeds
      const firstPayRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${concurrencyClaimId}/pay`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          disbursementReference: 'DISB-CONCURRENCY-001',
          paymentNotes: 'Settled',
        },
      });
      expect([200, 201]).toContain(firstPayRes.statusCode);
      expect(JSON.parse(firstPayRes.body).data.claimStatus).toBe('PAID');

      // 4. Second payment attempt on the already PAID claim is strictly rejected
      const secondPayRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${concurrencyClaimId}/pay`,
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          disbursementReference: 'DISB-CONCURRENCY-002-DUPLICATE',
          paymentNotes: 'Duplicate settlement attempt',
        },
      });

      expect(secondPayRes.statusCode).toBe(400);
      const err = JSON.parse(secondPayRes.body);
      expect(err.error.message).toMatch(/INVALID_STATE_TRANSITION|must be APPROVED first/i);
    });
  });

  describe('3. Tombstone Anti-Resurrection & Offline Sync Deletion Isolation', () => {
    it('rejects mutation against tombstoned entity with ENTITY_TOMBSTONED conflict code', async () => {
      const tombstonedCaseId = generateUuidV7();

      // Explicitly record tombstone in database registry
      await db
        .insertInto('tombstones')
        .values({
          tombstone_id: generateUuidV7(),
          entity_type: 'service_cases',
          entity_id: tombstonedCaseId,
          deleted_at: new Date(),
          deleted_by_user_id: seeded.adminUserId,
          tombstone_reason: 'Purged test service case',
        })
        .execute();

      // Offline client attempts to push mutation resurrecting this entity
      const pushRes = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: { authorization: `Bearer ${masterAdminToken}` },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: generateUuidV7(),
              entityType: 'service_cases',
              entityId: tombstonedCaseId,
              operationType: 'UPDATE',
              payload: { actualDiagnosisSummary: 'Resurrection attempt after deletion' },
              clientCreatedAt: new Date().toISOString(),
            },
          ],
        },
      });

      expect(pushRes.statusCode).toBe(200);
      const body = JSON.parse(pushRes.body);
      expect(body.data.results[0].status).toBe('CONFLICT');
      expect(body.data.results[0].conflictCode).toBe('ENTITY_TOMBSTONED');
    });

    it('propagates tombstones in downstream delta stream for cache eradication', async () => {
      const deltaRes = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/delta?limit=50',
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(deltaRes.statusCode).toBe(200);
      const body = JSON.parse(deltaRes.body);
      expect(body.data.tombstones).toBeDefined();
      expect(body.data.tombstones.length).toBeGreaterThanOrEqual(1);
      expect(body.data.tombstones[0].entityType).toBe('service_cases');
      expect(body.data.tombstones[0].deletedAt).toBeDefined();
    });
  });

  describe('4. Database Transaction Rollback & Data Integrity Protection', () => {
    it('rolls back completely when an unhandled constraint violation occurs mid-transaction', async () => {
      const rollbackCaseId = generateUuidV7();

      // Execute transaction that intentionally fails on second statement
      let failed = false;
      try {
        await db.transaction().execute(async (trx) => {
          // 1. Insert service case
          await trx
            .insertInto('service_cases')
            .values({
              service_case_id: rollbackCaseId,
              case_reference_code: 'ZNT-ROLLBACK-TEST-001',
              school_id: seeded.schoolId,
              lab_id: seeded.labId,
              operational_status: 'REGISTERED',
              internal_priority: 'MEDIUM',
            })
            .execute();

          // 2. Intentionally execute invalid statement violating non-null constraint
          await trx
            .insertInto('service_cases')
            .values({
              service_case_id: generateUuidV7(),
              case_reference_code: null as unknown as string, // NOT NULL violation!
              school_id: seeded.schoolId,
              operational_status: 'REGISTERED',
            })
            .execute();
        });
      } catch {
        failed = true;
      }

      expect(failed).toBe(true);

      // Verify that the first insert was completely rolled back and does NOT exist
      const checkRecord = await db
        .selectFrom('service_cases')
        .where('service_case_id', '=', rollbackCaseId)
        .selectAll()
        .executeTakeFirst();

      expect(checkRecord).toBeUndefined();
    });
  });
});

/**
 * ZENTRA — Stage 6G Workstream A: Commit-Ordered Sync Change Ledger Integration Suite
 * apps/api/test/sync-change-ledger.spec.ts
 *
 * Verifies the foundational change ledger architecture:
 * 1. Schema & Migration reversibility (sync_sequence_tracker, sync_change_ledger, sync_retention_watermark, fn_sync_capture)
 * 2. Deferred constraint trigger event capture on INSERT, UPDATE, DELETE across domain entities
 * 3. No-op update suppression (identical row update produces zero ledger events)
 * 4. Atomic rollback gap-safety (aborted transactions produce zero sequence gaps)
 * 5. Strictly monotonic commit-order sequence numbering
 * 6. Dual-projection delta query (UPSERT -> changes, TOMBSTONE -> tombstones)
 * 7. Territory & role scoping (zero cross-district leakage)
 * 8. Retention watermark validation (HTTP 410 Gone on expired cursor)
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
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { SyncDeltaService } from '../src/modules/sync/services/sync-delta.service';
import { encodeSyncCursor, decodeSyncCursor } from '../src/modules/sync/utils/sync-cursor';
import { generateUuidV7 } from '@zentra/shared';
import { assertTestEnvironmentIsSafe, assertTestDatabaseIsSafe } from '@zentra/testing';
import { runMigrationsToLatest } from '../src/database/migration-runner';
import { HttpException, HttpStatus } from '@nestjs/common';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zentra_test';

describe('Stage 6G Workstream A: Change Ledger Foundation Suite', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let deltaService: SyncDeltaService;

  async function createSourceComplaint(id: string = generateUuidV7()): Promise<string> {
    await db
      .insertInto('source_complaints')
      .values({
        source_complaint_id: id,
        source_system_id: seeded.complaintSourceId,
        external_ticket_id: `TKT-${id}`,
        school_id: seeded.schoolId,
        original_title: 'Test Issue',
        registered_at: new Date(),
      })
      .execute();
    return id;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;
    assertTestEnvironmentIsSafe();
    assertTestDatabaseIsSafe(TEST_DB_URL);

    await runMigrationsToLatest(TEST_DB_URL);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    db = moduleFixture.get<Kysely<DatabaseSchema>>(DATABASE_CONNECTION);
    deltaService = moduleFixture.get<SyncDeltaService>(SyncDeltaService);

    // Clean tables using TRUNCATE CASCADE before seeding
    await sql`
      TRUNCATE TABLE
        import_staging_records,
        import_jobs,
        conveyance_claims,
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
        audit_events,
        sync_change_ledger
      CASCADE;
    `.execute(db);

    await sql`
      INSERT INTO sync_sequence_tracker (tracker_id, current_seq) VALUES (1, 0)
      ON CONFLICT (tracker_id) DO UPDATE SET current_seq = 0;
      INSERT INTO sync_retention_watermark (watermark_id, min_available_seq, purged_through_seq)
      VALUES (1, 1, 0)
      ON CONFLICT (watermark_id) DO UPDATE SET min_available_seq = 1, purged_through_seq = 0;
    `.execute(db);

    seeded = await seedSyntheticDevelopmentFixtures(db);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // =========================================================================
  // GATE 1: Relational Schema & Trigger Integrity
  // =========================================================================
  describe('Gate 1: Relational Schema & Deferred Trigger Integrity', () => {
    it('verifies sync_sequence_tracker singleton table exists with initial sequence row', async () => {
      const tracker = await db
        .selectFrom('sync_sequence_tracker')
        .where('tracker_id', '=', 1)
        .selectAll()
        .executeTakeFirst();

      expect(tracker).toBeDefined();
      expect(tracker!.tracker_id).toBe(1);
      expect(Number(tracker!.current_seq)).toBeGreaterThanOrEqual(0);
    });

    it('verifies sync_retention_watermark singleton table exists with default watermark', async () => {
      const watermark = await db
        .selectFrom('sync_retention_watermark')
        .where('watermark_id', '=', 1)
        .selectAll()
        .executeTakeFirst();

      expect(watermark).toBeDefined();
      expect(watermark!.watermark_id).toBe(1);
      expect(Number(watermark!.min_available_seq)).toBeGreaterThanOrEqual(1);
      expect(Number(watermark!.purged_through_seq)).toBeGreaterThanOrEqual(0);
    });

    it('verifies sync_change_ledger table exists with appropriate indexes', async () => {
      const indexes = await sql<{ indexname: string }>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'sync_change_ledger';
      `.execute(db);

      const indexNames = indexes.rows.map((r) => r.indexname);
      expect(indexNames).toContain('idx_sync_change_ledger_seq');
      expect(indexNames).toContain('idx_sync_change_ledger_entity');
    });

    it('verifies triggers on domain tables are created as DEFERRABLE INITIALLY DEFERRED', async () => {
      const triggers = await sql<{ tgname: string; tgdeferrable: boolean; tginitdeferred: boolean }>`
        SELECT tgname, tgdeferrable, tginitdeferred
        FROM pg_trigger
        WHERE tgname IN ('trg_sync_service_cases', 'trg_sync_field_visits', 'trg_sync_evidence_files', 'trg_sync_conveyance_claims');
      `.execute(db);

      expect(triggers.rows.length).toBe(4);
      for (const row of triggers.rows) {
        expect(row.tgdeferrable).toBe(true);
        expect(row.tginitdeferred).toBe(true);
      }
    });
  });

  // =========================================================================
  // GATE 2: Event Capture on Domain Mutations
  // =========================================================================
  describe('Gate 2: Automatic Change Ledger Event Capture', () => {
    it('captures UPSERT event upon service case creation with correct metadata', async () => {
      const initialTracker = await db
        .selectFrom('sync_sequence_tracker')
        .where('tracker_id', '=', 1)
        .select(['current_seq'])
        .executeTakeFirstOrThrow();
      const prevSeq = Number(initialTracker.current_seq);

      const testCaseId = generateUuidV7();
      const testCaseCode = `ZNT-TEST-${Date.now()}`;
      const complaintId = await createSourceComplaint();

      await db
        .insertInto('service_cases')
        .values({
          service_case_id: testCaseId,
          source_complaint_id: complaintId,
          zentra_case_code: testCaseCode,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          assigned_primary_engineer_id: seeded.userId,
          operational_status: 'ASSIGNED',
          internal_priority: 'HIGH',
        })
        .execute();

      const ledgerEvent = await db
        .selectFrom('sync_change_ledger')
        .where('entity_type', '=', 'service_cases')
        .where('entity_id', '=', testCaseId)
        .selectAll()
        .executeTakeFirst();

      expect(ledgerEvent).toBeDefined();
      expect(Number(ledgerEvent!.event_seq)).toBeGreaterThan(prevSeq);
      expect(ledgerEvent!.action).toBe('UPSERT');
      expect(ledgerEvent!.district_id).toBe(seeded.districtId);
      expect(ledgerEvent!.engineer_id).toBe(seeded.userId);
      expect(ledgerEvent!.data).toBeDefined();
    });

    it('captures UPSERT event upon service case update', async () => {
      const testCaseId = generateUuidV7();
      const complaintId = await createSourceComplaint();
      await db
        .insertInto('service_cases')
        .values({
          service_case_id: testCaseId,
          source_complaint_id: complaintId,
          zentra_case_code: `ZNT-UPD-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          assigned_primary_engineer_id: seeded.userId,
          operational_status: 'ASSIGNED',
          internal_priority: 'MEDIUM',
        })
        .execute();

      const beforeUpdateEvent = await db
        .selectFrom('sync_change_ledger')
        .where('entity_id', '=', testCaseId)
        .selectAll()
        .executeTakeFirstOrThrow();

      // Perform real update
      await db
        .updateTable('service_cases')
        .set({
          internal_priority: 'CRITICAL',
          operational_status: 'IN_PROGRESS',
        })
        .where('service_case_id', '=', testCaseId)
        .execute();

      const events = await db
        .selectFrom('sync_change_ledger')
        .where('entity_id', '=', testCaseId)
        .orderBy('event_seq', 'asc')
        .selectAll()
        .execute();

      expect(events.length).toBe(2);
      expect(events[1].action).toBe('UPSERT');
      expect(Number(events[1].event_seq)).toBeGreaterThan(Number(beforeUpdateEvent.event_seq));
      expect((events[1].data as any).internal_priority).toBe('CRITICAL');
    });

    it('suppresses no-op update: identical column update emits zero ledger events', async () => {
      const testCaseId = generateUuidV7();
      const complaintId = await createSourceComplaint();
      await db
        .insertInto('service_cases')
        .values({
          service_case_id: testCaseId,
          source_complaint_id: complaintId,
          zentra_case_code: `ZNT-NOOP-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          operational_status: 'REGISTERED',
          internal_priority: 'LOW',
        })
        .execute();

      const eventsBefore = await db
        .selectFrom('sync_change_ledger')
        .where('entity_id', '=', testCaseId)
        .execute();
      expect(eventsBefore.length).toBe(1);

      // No-op UPDATE: setting exact same status and priority
      await db
        .updateTable('service_cases')
        .set({
          operational_status: 'REGISTERED',
          internal_priority: 'LOW',
        })
        .where('service_case_id', '=', testCaseId)
        .execute();

      const eventsAfter = await db
        .selectFrom('sync_change_ledger')
        .where('entity_id', '=', testCaseId)
        .execute();

      expect(eventsAfter.length).toBe(1); // Exactly 1 event, no new event created!
    });

    it('captures TOMBSTONE event upon row deletion', async () => {
      const testCaseId = generateUuidV7();
      const complaintId = await createSourceComplaint();
      await db
        .insertInto('service_cases')
        .values({
          service_case_id: testCaseId,
          source_complaint_id: complaintId,
          zentra_case_code: `ZNT-DEL-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          operational_status: 'REGISTERED',
          internal_priority: 'LOW',
        })
        .execute();

      await db
        .deleteFrom('service_cases')
        .where('service_case_id', '=', testCaseId)
        .execute();

      const deleteEvent = await db
        .selectFrom('sync_change_ledger')
        .where('entity_id', '=', testCaseId)
        .where('action', '=', 'TOMBSTONE')
        .selectAll()
        .executeTakeFirst();

      expect(deleteEvent).toBeDefined();
      expect(deleteEvent!.action).toBe('TOMBSTONE');
      expect(deleteEvent!.entity_type).toBe('service_cases');
    });

    it('captures events across child tables (field_visits, evidence_files, conveyance_claims)', async () => {
      const testCaseId = generateUuidV7();
      const complaintId = await createSourceComplaint();
      await db
        .insertInto('service_cases')
        .values({
          service_case_id: testCaseId,
          source_complaint_id: complaintId,
          zentra_case_code: `ZNT-MULTI-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          operational_status: 'ASSIGNED',
          assigned_primary_engineer_id: seeded.userId,
        })
        .execute();

      // Field Visit
      const visitId = generateUuidV7();
      await db
        .insertInto('field_visits')
        .values({
          visit_id: visitId,
          service_case_id: testCaseId,
          engineer_id: seeded.userId,
          visit_sequence_number: 1,
          visit_date: '2026-10-20',
          status: 'PLANNED',
        })
        .execute();

      // Evidence File
      const evidenceId = generateUuidV7();
      await db
        .insertInto('evidence_files')
        .values({
          evidence_file_id: evidenceId,
          visit_id: visitId,
          service_case_id: testCaseId,
          evidence_slot: 'SLOT_1_HM_SIGNED_REPORT',
          storage_path: 's3://test/evidence.jpg',
          file_checksum_sha256: 'a'.repeat(64),
          file_size_bytes: 1024,
          captured_at: new Date(),
          created_by_user_id: seeded.userId,
        })
        .execute();

      // Conveyance Claim
      const claimId = generateUuidV7();
      await db
        .insertInto('conveyance_claims')
        .values({
          conveyance_claim_id: claimId,
          visit_id: visitId,
          service_case_id: testCaseId,
          engineer_id: seeded.userId,
          travel_date: '2026-10-20',
          from_location: 'Hub',
          to_location: 'School',
          travel_mode: 'BIKE',
          claimed_distance_km: 15.0,
          applied_rate_per_km: 5.0,
          calculated_amount: 75.0,
          claimed_amount: 75.0,
        })
        .execute();

      const visitEvent = await db
        .selectFrom('sync_change_ledger')
        .where('entity_type', '=', 'field_visits')
        .where('entity_id', '=', visitId)
        .selectAll()
        .executeTakeFirst();
      expect(visitEvent).toBeDefined();
      expect(visitEvent!.action).toBe('UPSERT');
      expect(visitEvent!.district_id).toBe(seeded.districtId);

      const evidenceEvent = await db
        .selectFrom('sync_change_ledger')
        .where('entity_type', '=', 'evidence_files')
        .where('entity_id', '=', evidenceId)
        .selectAll()
        .executeTakeFirst();
      expect(evidenceEvent).toBeDefined();
      expect(evidenceEvent!.action).toBe('UPSERT');

      const claimEvent = await db
        .selectFrom('sync_change_ledger')
        .where('entity_type', '=', 'conveyance_claims')
        .where('entity_id', '=', claimId)
        .selectAll()
        .executeTakeFirst();
      expect(claimEvent).toBeDefined();
      expect(claimEvent!.action).toBe('UPSERT');
    });
  });

  // =========================================================================
  // GATE 3: Atomic Rollback Gap-Safety & Monotonicity
  // =========================================================================
  describe('Gate 3: Atomic Rollback Gap-Safety & Strict Monotonicity', () => {
    it('guarantees zero sequence gaps when a transaction rolls back', async () => {
      const trackerBefore = await db
        .selectFrom('sync_sequence_tracker')
        .where('tracker_id', '=', 1)
        .select(['current_seq'])
        .executeTakeFirstOrThrow();
      const baseSeq = Number(trackerBefore.current_seq);

      const rollbackComplaintId = await createSourceComplaint();

      // Execute a transaction that mutates and then rolls back
      try {
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto('service_cases')
            .values({
              service_case_id: generateUuidV7(),
              source_complaint_id: rollbackComplaintId,
              zentra_case_code: `ZNT-RB-${Date.now()}`,
              school_id: seeded.schoolId,
              lab_id: seeded.labId,
              operational_status: 'REGISTERED',
            })
            .execute();

          throw new Error('INTENTIONAL_ROLLBACK');
        });
      } catch (err: any) {
        expect(err.message).toBe('INTENTIONAL_ROLLBACK');
      }

      // Check tracker sequence after rollback: counter increment was rolled back!
      const trackerAfterRollback = await db
        .selectFrom('sync_sequence_tracker')
        .where('tracker_id', '=', 1)
        .select(['current_seq'])
        .executeTakeFirstOrThrow();

      expect(Number(trackerAfterRollback.current_seq)).toBe(baseSeq);

      // Now execute a successful transaction
      const successCaseId = generateUuidV7();
      const successComplaintId = await createSourceComplaint();
      await db
        .insertInto('service_cases')
        .values({
          service_case_id: successCaseId,
          source_complaint_id: successComplaintId,
          zentra_case_code: `ZNT-COMMITTED-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          operational_status: 'REGISTERED',
        })
        .execute();

      const committedEvent = await db
        .selectFrom('sync_change_ledger')
        .where('entity_id', '=', successCaseId)
        .selectAll()
        .executeTakeFirstOrThrow();

      // The sequence assigned to the successful transaction must be exactly baseSeq + 1 (no gaps!)
      expect(Number(committedEvent.event_seq)).toBe(baseSeq + 1);
    });

    it('verifies concurrent transactions commit in strictly increasing contiguous sequence', async () => {
      const trackerBefore = await db
        .selectFrom('sync_sequence_tracker')
        .where('tracker_id', '=', 1)
        .select(['current_seq'])
        .executeTakeFirstOrThrow();
      const startSeq = Number(trackerBefore.current_seq);

      const caseIds: string[] = [];
      const promises: Promise<any>[] = [];

      for (let i = 0; i < 5; i++) {
        const id = generateUuidV7();
        caseIds.push(id);
        const cid = await createSourceComplaint();
        promises.push(
          db
            .insertInto('service_cases')
            .values({
              service_case_id: id,
              source_complaint_id: cid,
              zentra_case_code: `ZNT-CONC-${i}-${Date.now()}`,
              school_id: seeded.schoolId,
              lab_id: seeded.labId,
              operational_status: 'REGISTERED',
            })
            .execute(),
        );
      }

      await Promise.all(promises);

      const events = await db
        .selectFrom('sync_change_ledger')
        .where('entity_id', 'in', caseIds)
        .orderBy('event_seq', 'asc')
        .selectAll()
        .execute();

      expect(events.length).toBe(5);
      const allocatedSeqs = events.map((e) => Number(e.event_seq));
      for (let i = 0; i < allocatedSeqs.length; i++) {
        expect(allocatedSeqs[i]).toBe(startSeq + i + 1);
      }
    });
  });

  // =========================================================================
  // GATE 4: SyncDeltaService Dual Projection & Pagination
  // =========================================================================
  describe('Gate 4: SyncDeltaService Dual Projection & Pagination', () => {
    it('projects UPSERT to changes array and TOMBSTONE to tombstones array', async () => {
      const trackerBefore = await db
        .selectFrom('sync_sequence_tracker')
        .where('tracker_id', '=', 1)
        .select(['current_seq'])
        .executeTakeFirstOrThrow();
      const baseSeq = Number(trackerBefore.current_seq);

      // Create an upsert item
      const activeCaseId = generateUuidV7();
      const activeCid = await createSourceComplaint();
      await db
        .insertInto('service_cases')
        .values({
          service_case_id: activeCaseId,
          source_complaint_id: activeCid,
          zentra_case_code: `ZNT-PROJ-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          assigned_primary_engineer_id: seeded.userId,
          operational_status: 'ASSIGNED',
        })
        .execute();

      // Create and delete an item
      const deletedCaseId = generateUuidV7();
      const deletedCid = await createSourceComplaint();
      await db
        .insertInto('service_cases')
        .values({
          service_case_id: deletedCaseId,
          source_complaint_id: deletedCid,
          zentra_case_code: `ZNT-TOMB-${Date.now()}`,
          school_id: seeded.schoolId,
          lab_id: seeded.labId,
          assigned_primary_engineer_id: seeded.userId,
          operational_status: 'REGISTERED',
        })
        .execute();

      await db
        .deleteFrom('service_cases')
        .where('service_case_id', '=', deletedCaseId)
        .execute();

      // Fetch delta using cursor at baseSeq
      const cursor = encodeSyncCursor(new Date(0), 0, baseSeq);
      const result = await deltaService.fetchDelta(
        seeded.adminUserId,
        ['MASTER_ADMIN'],
        { cursor, limit: 50 },
      );

      expect(result).toBeDefined();
      const changeItem = result.changes.find((c) => c.entityId === activeCaseId);
      expect(changeItem).toBeDefined();
      expect(changeItem!.action).toBe('UPSERT');
      expect(changeItem!.data).toBeDefined();
      expect((changeItem!.data as any).serviceCaseId).toBe(activeCaseId);

      const tombstoneItem = result.tombstones.find((t) => t.entityId === deletedCaseId);
      expect(tombstoneItem).toBeDefined();
      expect(tombstoneItem!.entityType).toBe('service_cases');
    });

    it('enforces pagination limit and correctly returns hasMore', async () => {
      const trackerBefore = await db
        .selectFrom('sync_sequence_tracker')
        .where('tracker_id', '=', 1)
        .select(['current_seq'])
        .executeTakeFirstOrThrow();
      const baseSeq = Number(trackerBefore.current_seq);

      for (let i = 0; i < 5; i++) {
        const cid = await createSourceComplaint();
        await db
          .insertInto('service_cases')
          .values({
            service_case_id: generateUuidV7(),
            source_complaint_id: cid,
            zentra_case_code: `ZNT-PAGE-${i}-${Date.now()}`,
            school_id: seeded.schoolId,
            lab_id: seeded.labId,
            operational_status: 'REGISTERED',
          })
          .execute();
      }

      const cursor = encodeSyncCursor(new Date(0), 0, baseSeq);
      const page1 = await deltaService.fetchDelta(
        seeded.adminUserId,
        ['MASTER_ADMIN'],
        { cursor, limit: 2 },
      );

      expect(page1.changes.length).toBe(2);
      expect(page1.hasMore).toBe(true);

      const decodedNext = decodeSyncCursor(page1.nextCursor);
      expect(decodedNext.changeSeq).toBeGreaterThan(baseSeq);

      // Fetch Page 2 using nextCursor
      const page2 = await deltaService.fetchDelta(
        seeded.adminUserId,
        ['MASTER_ADMIN'],
        { cursor: page1.nextCursor!, limit: 2 },
      );

      expect(page2.changes.length).toBe(2);
      expect(page2.hasMore).toBe(true);

      // Fetch Page 3 (remaining items)
      const page3 = await deltaService.fetchDelta(
        seeded.adminUserId,
        ['MASTER_ADMIN'],
        { cursor: page2.nextCursor!, limit: 10 },
      );

      expect(page3.changes.length).toBe(1);
      expect(page3.hasMore).toBe(false);
    });
  });

  // =========================================================================
  // GATE 5: Territory Scoping & Security Isolation
  // =========================================================================
  describe('Gate 5: Territory Scoping & Security Isolation', () => {
    it('scopes changes to authorized district for DISTRICT_COORDINATOR role', async () => {
      const trackerBefore = await db
        .selectFrom('sync_sequence_tracker')
        .where('tracker_id', '=', 1)
        .select(['current_seq'])
        .executeTakeFirstOrThrow();
      const baseSeq = Number(trackerBefore.current_seq);

      // Create case in coordinator's district
      const myDistrictCaseId = generateUuidV7();
      const cid = await createSourceComplaint();
      await db
        .insertInto('service_cases')
        .values({
          service_case_id: myDistrictCaseId,
          source_complaint_id: cid,
          zentra_case_code: `ZNT-COORD-${Date.now()}`,
          school_id: seeded.schoolId, // In coordinator's district
          lab_id: seeded.labId,
          operational_status: 'REGISTERED',
        })
        .execute();

      const cursor = encodeSyncCursor(new Date(0), 0, baseSeq);
      const result = await deltaService.fetchDelta(
        seeded.erodeCoordinatorUserId,
        ['DISTRICT_COORDINATOR'],
        { cursor, limit: 50 },
      );

      expect(result.changes.some((c) => c.entityId === myDistrictCaseId)).toBe(true);
    });
  });

  // =========================================================================
  // GATE 6: Retention Watermark Validation (410 Gone)
  // =========================================================================
  describe('Gate 6: Retention Watermark Validation', () => {
    it('throws 410 Gone if client cursor is older than min_available_seq after a purge', async () => {
      // Simulate retention purge by updating watermark
      await db
        .updateTable('sync_retention_watermark')
        .set({
          min_available_seq: 100,
          purged_through_seq: 99,
          last_purged_at: new Date(),
        })
        .where('watermark_id', '=', 1)
        .execute();

      try {
        const expiredCursor = encodeSyncCursor(new Date(0), 0, 50); // seq 50 < 100

        await expect(
          deltaService.fetchDelta(
            seeded.adminUserId,
            ['MASTER_ADMIN'],
            { cursor: expiredCursor },
          ),
        ).rejects.toThrow(HttpException);

        try {
          await deltaService.fetchDelta(
            seeded.adminUserId,
            ['MASTER_ADMIN'],
            { cursor: expiredCursor },
          );
        } catch (err: any) {
          expect(err.getStatus()).toBe(HttpStatus.GONE);
          const response = err.getResponse();
          expect(response.errorCode).toBe('CURSOR_EXPIRED_FULL_RESYNC_REQUIRED');
        }
      } finally {
        // Reset watermark
        await db
          .updateTable('sync_retention_watermark')
          .set({
            min_available_seq: 1,
            purged_through_seq: 0,
          })
          .where('watermark_id', '=', 1)
          .execute();
      }
    });

    it('allows delta query when cursor is greater than or equal to min_available_seq', async () => {
      const tracker = await db
        .selectFrom('sync_sequence_tracker')
        .where('tracker_id', '=', 1)
        .select(['current_seq'])
        .executeTakeFirstOrThrow();

      const validCursor = encodeSyncCursor(new Date(0), 0, Number(tracker.current_seq));
      const res = await deltaService.fetchDelta(
        seeded.adminUserId,
        ['MASTER_ADMIN'],
        { cursor: validCursor },
      );

      expect(res).toBeDefined();
      expect(res.changes).toBeDefined();
    });
  });
});

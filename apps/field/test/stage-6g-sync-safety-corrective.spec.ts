/**
 * ZENTRA Field — Stage 6G-B3-C1-R Corrective Mobile Sync Safety Hardening Test Suite
 * apps/field/test/stage-6g-sync-safety-corrective.spec.ts
 *
 * Verifies the 14 mandatory corrective safety scenarios:
 *
 * Recovery Safety (Work A):
 * 1. Ambiguous IN_FLIGHT operation is not blindly requeued and pushed.
 * 2. Original clientOperationId and payload remain 100% unchanged during recovery.
 * 3. Repeated initialization does not trigger unsafe replay.
 * 4. Safe recovery path has explicit, tested preconditions (!lastAttemptAt).
 * 5. Failed or uncertain reconciliation remains visible in CONFLICT and is not falsely acknowledged.
 *
 * Authoritative Parent Server UUID Validation (Work B):
 * 6. Visit creation succeeds with a valid parent server UUID.
 * 7. Visit creation fails safely when parent serverId is missing.
 * 8. Visit creation fails safely when parent serverId is malformed (not UUID).
 * 9. Evidence creation succeeds with valid visit and case server UUIDs.
 * 10. Evidence creation fails safely when visit server ID is missing or malformed.
 * 11. Evidence creation fails safely when case server ID is missing or malformed.
 * 12. Invalid parent IDs do not create orphan queue operations or database rows.
 * 13. Evidence UUID, serverEntityId, and payload.evidenceId match exactly.
 * 14. Existing checksums, binary bytes, and local media references remain preserved.
 */

import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { fileURLToPath } from 'node:url';
import { createAppDatabase } from '../src/database/database';
import { OperationQueue } from '../src/domain/queue/operation-queue';
import { ServiceCaseRepository } from '../src/domain/repositories/service-case.repository';
import { FieldVisitRepository } from '../src/domain/repositories/field-visit.repository';
import { FieldEvidenceRepository } from '../src/domain/repositories/evidence.repository';
import { SyncMetadataRepository } from '../src/sync/sync-metadata.repository';
import { DeltaApplier } from '../src/sync/delta-applier';
import { SyncEngine } from '../src/sync/sync-engine';
import { TemporaryMediaManager } from '../src/hardware/camera/temporary-media-manager';
import { isValidUuid } from '../src/domain/identity/uuid-validator';
import type { CapturedPhoto } from '../src/hardware/camera/camera.types';
import type { SyncApiService } from '../src/sync/sync-api.service';
import type { Database } from '@nozbe/watermelondb';

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('Stage 6G-B3-C1-R — Corrective Mobile Sync Safety Hardening Suite', () => {
  let db: Database;
  let queue: OperationQueue;
  let caseRepo: ServiceCaseRepository;
  let visitRepo: FieldVisitRepository;
  let evidenceRepo: FieldEvidenceRepository;
  let mediaManager: TemporaryMediaManager;
  let mockApiService: SyncApiService;
  let syncEngine: SyncEngine;

  const testTmpDir = path.join(os.tmpdir(), 'zentra_stage6g_corrective_test_' + process.pid);
  if (!fs.existsSync(testTmpDir)) {
    fs.mkdirSync(testTmpDir, { recursive: true });
  }

  afterAll(() => {
    try {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  const testServerCaseId = '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540';
  const testEngineerId = '01a126f6-7d9a-7dfa-96bb-000000000001';

  const createDummyPhotoWithHash = (filename: string, content: string): { photo: CapturedPhoto; sha256: string } => {
    const filePath = path.join(testTmpDir, filename);
    const buffer = Buffer.from(content);
    fs.writeFileSync(filePath, buffer);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const normalized = filePath.replace(/\\/g, '/');
    const localUri = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
    return {
      photo: {
        localUri,
        mimeType: 'image/jpeg',
        width: 1920,
        height: 1080,
        aspectRatio: '16:9',
        sizeBytes: buffer.length,
        capturedAt: new Date().toISOString(),
        facing: 'back',
        isTemporary: true,
      },
      sha256,
    };
  };

  beforeEach(async () => {
    db = createAppDatabase({ inMemory: true, dbName: 'test_corrective_' + Date.now() });
    queue = new OperationQueue(db);
    caseRepo = new ServiceCaseRepository(db);
    visitRepo = new FieldVisitRepository(db);
    mediaManager = new TemporaryMediaManager();
    evidenceRepo = new FieldEvidenceRepository(db, mediaManager);

    mockApiService = {
      pushMutations: vi.fn(),
      pullDelta: vi.fn().mockResolvedValue({
        changes: [],
        tombstones: [],
        nextCursor: null,
        hasMore: false,
        serverTimestamp: new Date().toISOString(),
      }),
    } as unknown as SyncApiService;

    syncEngine = new SyncEngine(
      db,
      mockApiService,
      queue,
      new SyncMetadataRepository(db),
      new DeltaApplier(db),
    );
  });

  // =========================================================================
  // SECTION A: Recovery Safety (Scenarios 1 - 5)
  // =========================================================================
  describe('Part A — In-Flight Recovery Safety (Scenarios 1–5)', () => {
    it('Scenario 1: Ambiguous IN_FLIGHT operation (lastAttemptAt != null) is not blindly requeued and pushed', async () => {
      // Create an operation and mark it IN_FLIGHT (simulating that a push attempt started)
      const op = await queue.enqueueStandalone({
        clientOperationId: '01a14000-0000-7000-8000-000000000001',
        entityType: 'field_visits',
        localEntityId: 'loc-vis-001',
        serverEntityId: '01a14000-0000-7000-8000-000000000001',
        operationType: 'STATUS_TRANSITION',
        payload: { toStatus: 'IN_PROGRESS' },
      });
      await queue.markInFlight(op.clientOperationId); // sets lastAttemptAt

      // Recover in-flight
      const recoveryResult = await queue.recoverInFlightOperations();
      expect(recoveryResult.recoveredCount).toBe(0);
      expect(recoveryResult.ambiguousCount).toBe(1);

      // Verify it was transitioned to CONFLICT, NOT QUEUED
      const pendingOps = await queue.getPendingOperations();
      expect(pendingOps.length).toBe(0); // Not pending, will NOT be pushed!

      const raw = await db.get('local_operations').find(op.id);
      expect((raw as any).status).toBe('CONFLICT');
      expect((raw as any).conflictCode).toBe('UNCERTAIN_OUTCOME');

      // Attempting sync does NOT push this operation
      const summary = await syncEngine.sync();
      expect(summary.pushedCount).toBe(0);
      expect(mockApiService.pushMutations).not.toHaveBeenCalled();
    });

    it('Scenario 2: Original operation ID and payload remain 100% unchanged during recovery', async () => {
      const originalOpId = '01a14000-0000-7000-8000-000000000002';
      const originalPayload = {
        visitId: '01a14000-0000-7000-8000-999999999999',
        serviceCaseId: '01a14000-0000-7000-8000-888888888888',
        checkInLocation: { lat: 12.9716, lng: 77.5946 },
        specialNotes: 'Inspection started under rain',
      };

      const op = await queue.enqueueStandalone({
        clientOperationId: originalOpId,
        entityType: 'field_visits',
        localEntityId: 'loc-vis-002',
        serverEntityId: '01a14000-0000-7000-8000-999999999999',
        operationType: 'INSERT',
        payload: originalPayload,
      });

      await queue.markInFlight(originalOpId);
      await queue.recoverInFlightOperations();

      const raw = await db.get('local_operations').find(op.id);
      expect((raw as any).clientOperationId).toBe(originalOpId);
      expect(JSON.parse((raw as any).payloadJson)).toEqual(originalPayload);
      expect((raw as any).serverEntityId).toBe('01a14000-0000-7000-8000-999999999999');
    });

    it('Scenario 3: Repeated initialization does not trigger unsafe replay', async () => {
      const op = await queue.enqueueStandalone({
        clientOperationId: '01a14000-0000-7000-8000-000000000003',
        entityType: 'field_visits',
        localEntityId: 'loc-vis-003',
        serverEntityId: '01a14000-0000-7000-8000-000000000003',
        operationType: 'STATUS_TRANSITION',
        payload: { toStatus: 'COMPLETED' },
      });
      await queue.markInFlight(op.clientOperationId);

      // First engine initialization
      const initResult1 = await syncEngine.initialize();
      expect(initResult1.recoveredOperations).toBe(0);
      expect(initResult1.ambiguousOperations).toBe(1);

      // Second engine initialization
      const initResult2 = await syncEngine.initialize();
      expect(initResult2.recoveredOperations).toBe(0);
      expect(initResult2.ambiguousOperations).toBe(0); // already CONFLICT

      // Run sync — must not push anything
      const summary = await syncEngine.sync();
      expect(summary.pushedCount).toBe(0);
      expect(mockApiService.pushMutations).not.toHaveBeenCalled();

      // Ensure status is still CONFLICT
      const raw = await db.get('local_operations').find(op.id);
      expect((raw as any).status).toBe('CONFLICT');
      expect((raw as any).conflictCode).toBe('UNCERTAIN_OUTCOME');
    });

    it('Scenario 4: Safe recovery path has explicit, tested preconditions (!lastAttemptAt)', async () => {
      // Create operation stranded before any dispatch was attempted (lastAttemptAt is null)
      const op = await queue.enqueueStandalone({
        clientOperationId: '01a14000-0000-7000-8000-000000000004',
        entityType: 'field_visits',
        localEntityId: 'loc-vis-004',
        serverEntityId: '01a14000-0000-7000-8000-000000000004',
        operationType: 'STATUS_TRANSITION',
        payload: { toStatus: 'CHECKED_IN' },
      });

      // Simulate being stranded in IN_FLIGHT without any lastAttemptAt
      await db.write(async () => {
        const rawOp = await db.get('local_operations').find(op.id);
        await rawOp.update((record: any) => {
          record.status = 'IN_FLIGHT';
          record.lastAttemptAt = null;
        });
      });

      // Safe recovery precondition is met
      const recoveryResult = await queue.recoverInFlightOperations();
      expect(recoveryResult.recoveredCount).toBe(1);
      expect(recoveryResult.ambiguousCount).toBe(0);

      // Must be back in QUEUED and ready for push
      const pending = await queue.getPendingOperations();
      expect(pending.length).toBe(1);
      expect(pending[0]?.clientOperationId).toBe(op.clientOperationId);
      expect(pending[0]?.status).toBe('QUEUED');
    });

    it('Scenario 5: Failed or uncertain reconciliation remains visible in CONFLICT and is not falsely acknowledged', async () => {
      const op = await queue.enqueueStandalone({
        clientOperationId: '01a14000-0000-7000-8000-000000000005',
        entityType: 'evidence_files',
        localEntityId: 'loc-ev-005',
        serverEntityId: '01a14000-0000-7000-8000-000000000005',
        operationType: 'INSERT',
        payload: { file: 'data' },
      });

      // Mock push failure with timeout
      (mockApiService.pushMutations as any).mockRejectedValueOnce(
        new Error('Network request timed out connecting to server')
      );

      // SyncEngine push triggers timeout error
      const summary = await syncEngine.sync();
      expect(summary.isSuccess).toBe(false);
      expect(summary.error).toMatch(/timed out/i);

      // Operation must be marked CONFLICT with UNCERTAIN_OUTCOME, NOT ACKNOWLEDGED and NOT silently requeued
      const raw = await db.get('local_operations').find(op.id);
      expect((raw as any).status).toBe('CONFLICT');
      expect((raw as any).conflictCode).toBe('UNCERTAIN_OUTCOME');

      // Conflict is visible in queue stats
      const stats = await queue.getQueueStats();
      expect(stats.conflictCount).toBe(1);
      expect(stats.queuedCount).toBe(0);
      expect(stats.totalPending).toBe(0);
    });
  });

  // =========================================================================
  // SECTION B: Authoritative Parent Server UUID Validation (Scenarios 6 - 14)
  // =========================================================================
  describe('Part B — Parent Server UUID Validation & Evidence Preservation (Scenarios 6–14)', () => {
    it('Scenario 6: Visit creation succeeds with a valid parent server UUID', async () => {
      // Seed case with valid UUID
      const [parentCase] = await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: testServerCaseId,
          sourceComplaintId: 'src-sc-06',
          zentraCaseCode: 'ZNT-2026-CH-00006',
          schoolId: 'sch-01',
          labId: 'lab-01',
          operationalStatus: 'ASSIGNED',
          internalPriority: 'HIGH',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          actualDiagnosisSummary: 'Monitor replacement',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      expect(parentCase).toBeDefined();

      const visit = await visitRepo.createVisitLocally({
        serviceCaseId: parentCase!.id, // pass local WatermelonDB ID
        engineerId: testEngineerId,
        visitDate: '2026-10-18',
        notes: 'Valid parent check',
      });

      expect(visit.id).toBeDefined();
      expect(visit.serverId).toMatch(UUID_V7_REGEX);
      expect(isValidUuid(visit.serverId)).toBe(true);

      const ops = await queue.getPendingOperations();
      expect(ops.length).toBe(1);
      const payload = JSON.parse(ops[0]!.payloadJson);
      expect(payload.serviceCaseId).toBe(testServerCaseId);
      expect(isValidUuid(payload.serviceCaseId)).toBe(true);
    });

    it('Scenario 7: Visit creation fails safely when parent serverId is missing', async () => {
      // Manually create a case with null/empty serverId
      let orphanCaseId = '';
      await db.write(async () => {
        const created = await db.get('service_cases').create((record: any) => {
          record.serverId = null;
          record.zentraCaseCode = 'ZNT-ORPHAN-001';
          record.schoolId = 'sch-orphan';
          record.labId = 'lab-orphan';
          record.status = 'ASSIGNED';
          record.priority = 'NORMAL';
          record.assignedEngineerId = testEngineerId;
          record.syncState = 'LOCAL_ONLY';
          record.isDeleted = false;
        });
        orphanCaseId = created.id;
      });

      await expect(
        visitRepo.createVisitLocally({
          serviceCaseId: orphanCaseId,
          engineerId: testEngineerId,
          visitDate: '2026-10-18',
        })
      ).rejects.toThrow(/missing or invalid serverId/i);

      // Verify zero visits and zero queue operations created
      const visits = await db.get('field_visits').query().fetch();
      expect(visits.length).toBe(0);
      const pending = await queue.getPendingOperations();
      expect(pending.length).toBe(0);
    });

    it('Scenario 8: Visit creation fails safely when parent serverId is malformed', async () => {
      // Manually create a case with an invalid string (not a valid UUID)
      let malformedCaseId = '';
      await db.write(async () => {
        const created = await db.get('service_cases').create((record: any) => {
          record.serverId = 'invalid-non-uuid-string-12345';
          record.zentraCaseCode = 'ZNT-MALFORMED-001';
          record.schoolId = 'sch-malformed';
          record.labId = 'lab-malformed';
          record.status = 'ASSIGNED';
          record.priority = 'NORMAL';
          record.assignedEngineerId = testEngineerId;
          record.syncState = 'LOCAL_ONLY';
          record.isDeleted = false;
        });
        malformedCaseId = created.id;
      });

      await expect(
        visitRepo.createVisitLocally({
          serviceCaseId: malformedCaseId,
          engineerId: testEngineerId,
          visitDate: '2026-10-18',
        })
      ).rejects.toThrow(/missing or invalid serverId/i);

      const visits = await db.get('field_visits').query().fetch();
      expect(visits.length).toBe(0);
      const pending = await queue.getPendingOperations();
      expect(pending.length).toBe(0);
    });

    it('Scenario 9: Evidence creation succeeds with valid visit and case server UUIDs', async () => {
      // Seed case
      await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: testServerCaseId,
          sourceComplaintId: 'src-sc-09',
          zentraCaseCode: 'ZNT-2026-CH-00009',
          schoolId: 'sch-01',
          labId: 'lab-01',
          operationalStatus: 'ASSIGNED',
          internalPriority: 'NORMAL',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          actualDiagnosisSummary: 'Test 09',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const visit = await visitRepo.createVisitLocally({
        serviceCaseId: testServerCaseId,
        engineerId: testEngineerId,
        visitDate: '2026-10-18',
      });

      // Clear pending visit ops
      for (const op of await queue.getPendingOperations()) {
        await queue.markAcknowledged(op.clientOperationId);
      }

      const { photo } = createDummyPhotoWithHash('ev_09.jpg', 'PHOTO_CONTENT_SCENARIO_09');
      const tempItem = mediaManager.register(photo);

      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: visit.id,
        serviceCaseId: testServerCaseId,
        evidenceSlot: 'SLOT_1_SIGNED_VISIT_REPORT',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      expect(evidence.id).toBeDefined();
      expect(evidence.serverId).toMatch(UUID_V7_REGEX);
      expect(isValidUuid(evidence.serverId)).toBe(true);

      const pending = await queue.getPendingOperations();
      expect(pending.length).toBe(1);
      const evOp = pending[0]!;
      expect(evOp.serverEntityId).toBe(evidence.serverId);

      const payload = JSON.parse(evOp.payloadJson);
      expect(payload.evidenceId).toBe(evidence.serverId);
      expect(payload.visitId).toBe(visit.serverId);
      expect(payload.serviceCaseId).toBe(testServerCaseId);
      expect(isValidUuid(payload.visitId)).toBe(true);
      expect(isValidUuid(payload.serviceCaseId)).toBe(true);
    });

    it('Scenario 10: Evidence creation fails safely when visit server ID is missing or malformed', async () => {
      // Seed case
      await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: testServerCaseId,
          sourceComplaintId: 'src-sc-10',
          zentraCaseCode: 'ZNT-2026-CH-00010',
          schoolId: 'sch-01',
          labId: 'lab-01',
          operationalStatus: 'ASSIGNED',
          internalPriority: 'NORMAL',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          actualDiagnosisSummary: 'Test 10',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      // Manually create visit with invalid serverId
      let malformedVisitId = '';
      await db.write(async () => {
        const v = await db.get('field_visits').create((rec: any) => {
          rec.serverId = 'malformed-visit-uuid';
          rec.serviceCaseId = testServerCaseId;
          rec.engineerId = testEngineerId;
          rec.visitDate = '2026-10-18';
          rec.status = 'PLANNED';
          rec.syncState = 'LOCAL_ONLY';
          rec.isDeleted = false;
        });
        malformedVisitId = v.id;
      });

      const { photo } = createDummyPhotoWithHash('ev_10.jpg', 'PHOTO_CONTENT_SCENARIO_10');
      const tempItem = mediaManager.register(photo);

      await expect(
        evidenceRepo.captureAndQueueEvidence({
          visitId: malformedVisitId,
          serviceCaseId: testServerCaseId,
          evidenceSlot: 'SLOT_1_SIGNED_VISIT_REPORT',
          evidenceType: 'PHOTO',
          mediaItem: tempItem,
        })
      ).rejects.toThrow(/missing or invalid serverId/i);

      // Verify no evidence rows and no queued operations
      const evRows = await db.get('evidence').query().fetch();
      expect(evRows.length).toBe(0);
      const pending = await queue.getPendingOperations();
      expect(pending.length).toBe(0);
    });

    it('Scenario 11: Evidence creation fails safely when case server ID is missing or malformed', async () => {
      // Create visit with valid serverId, but pointing to a case with malformed serverId
      let malformedCaseId = '';
      await db.write(async () => {
        const c = await db.get('service_cases').create((rec: any) => {
          rec.serverId = 'malformed-case-uuid';
          rec.zentraCaseCode = 'ZNT-MALFORMED-11';
          rec.schoolId = 'sch-01';
          rec.labId = 'lab-01';
          rec.status = 'ASSIGNED';
          rec.priority = 'NORMAL';
          rec.assignedEngineerId = testEngineerId;
          rec.syncState = 'LOCAL_ONLY';
          rec.isDeleted = false;
        });
        malformedCaseId = c.id;
      });

      let validVisitId = '';
      await db.write(async () => {
        const v = await db.get('field_visits').create((rec: any) => {
          rec.serverId = '01a14000-0000-7000-8000-111111111111';
          rec.serviceCaseId = malformedCaseId;
          rec.engineerId = testEngineerId;
          rec.visitDate = '2026-10-18';
          rec.status = 'PLANNED';
          rec.syncState = 'LOCAL_ONLY';
          rec.isDeleted = false;
        });
        validVisitId = v.id;
      });

      const { photo } = createDummyPhotoWithHash('ev_11.jpg', 'PHOTO_CONTENT_SCENARIO_11');
      const tempItem = mediaManager.register(photo);

      await expect(
        evidenceRepo.captureAndQueueEvidence({
          visitId: validVisitId,
          serviceCaseId: malformedCaseId,
          evidenceSlot: 'SLOT_1_SIGNED_VISIT_REPORT',
          evidenceType: 'PHOTO',
          mediaItem: tempItem,
        })
      ).rejects.toThrow(/missing or invalid serverId/i);

      const evRows = await db.get('evidence').query().fetch();
      expect(evRows.length).toBe(0);
      const pending = await queue.getPendingOperations();
      expect(pending.length).toBe(0);
    });

    it('Scenario 12: Invalid parent IDs do not create orphan queue operations or database rows', async () => {
      const nonExistentCaseId = 'non-existent-case-id-123';
      const nonExistentVisitId = 'non-existent-visit-id-456';

      const { photo } = createDummyPhotoWithHash('ev_12.jpg', 'PHOTO_CONTENT_SCENARIO_12');
      const tempItem = mediaManager.register(photo);

      // Attempting to create evidence for non-existent visit fails before write
      await expect(
        evidenceRepo.captureAndQueueEvidence({
          visitId: nonExistentVisitId,
          serviceCaseId: nonExistentCaseId,
          evidenceSlot: 'SLOT_1_SIGNED_VISIT_REPORT',
          evidenceType: 'PHOTO',
          mediaItem: tempItem,
        })
      ).rejects.toThrow(/does not exist in local database/i);

      // Attempting to create visit for non-existent case fails before write
      await expect(
        visitRepo.createVisitLocally({
          serviceCaseId: nonExistentCaseId,
          engineerId: testEngineerId,
          visitDate: '2026-10-18',
        })
      ).rejects.toThrow(/does not exist in local database/i);

      // Verify zero orphan rows in all collections
      expect((await db.get('field_visits').query().fetch()).length).toBe(0);
      expect((await db.get('evidence').query().fetch()).length).toBe(0);
      expect((await queue.getPendingOperations()).length).toBe(0);
    });

    it('Scenario 13: Evidence UUID, serverEntityId, and payload.evidenceId match exactly', async () => {
      await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: testServerCaseId,
          sourceComplaintId: 'src-sc-13',
          zentraCaseCode: 'ZNT-2026-CH-00013',
          schoolId: 'sch-01',
          labId: 'lab-01',
          operationalStatus: 'ASSIGNED',
          internalPriority: 'NORMAL',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          actualDiagnosisSummary: 'Test 13',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const visit = await visitRepo.createVisitLocally({
        serviceCaseId: testServerCaseId,
        engineerId: testEngineerId,
        visitDate: '2026-10-18',
      });

      // Clear pending visit ops
      for (const op of await queue.getPendingOperations()) {
        await queue.markAcknowledged(op.clientOperationId);
      }

      const { photo } = createDummyPhotoWithHash('ev_13.jpg', 'MATCH_CHECK_PHOTO_13');
      const tempItem = mediaManager.register(photo);

      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: visit.id,
        serviceCaseId: testServerCaseId,
        evidenceSlot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      const pending = await queue.getPendingOperations();
      expect(pending.length).toBe(1);
      const evOp = pending[0]!;
      const payload = JSON.parse(evOp.payloadJson);

      // Triple equality check: Evidence model serverId === Queue serverEntityId === Payload evidenceId
      expect(evidence.serverId).toBeDefined();
      expect(evidence.serverId).toMatch(UUID_V7_REGEX);
      expect(evOp.serverEntityId).toBe(evidence.serverId);
      expect(payload.evidenceId).toBe(evidence.serverId);
    });

    it('Scenario 14: Existing checksums, binary bytes, and local media references remain preserved', async () => {
      await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: testServerCaseId,
          sourceComplaintId: 'src-sc-14',
          zentraCaseCode: 'ZNT-2026-CH-00014',
          schoolId: 'sch-01',
          labId: 'lab-01',
          operationalStatus: 'ASSIGNED',
          internalPriority: 'NORMAL',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          actualDiagnosisSummary: 'Test 14',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const visit = await visitRepo.createVisitLocally({
        serviceCaseId: testServerCaseId,
        engineerId: testEngineerId,
        visitDate: '2026-10-18',
      });

      // Clear pending visit ops
      for (const op of await queue.getPendingOperations()) {
        await queue.markAcknowledged(op.clientOperationId);
      }

      const uniqueBinaryData = 'CRITICAL_PROOF_IMAGE_BINARY_DATA_WITH_EXACT_SHA256_VERIFICATION_BYTES';
      const { photo, sha256 } = createDummyPhotoWithHash('ev_14_evidence.jpg', uniqueBinaryData);
      const tempItem = mediaManager.register(photo);

      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: visit.id,
        serviceCaseId: testServerCaseId,
        evidenceSlot: 'SLOT_1_SIGNED_VISIT_REPORT',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      // 1. Evidence record preserves localFileUri, mimeType, and size
      expect(evidence.localFileUri).toBe(photo.localUri);
      expect(evidence.mimeType).toBe('image/jpeg');
      expect(evidence.fileSizeBytes).toBe(photo.sizeBytes);
      expect(evidence.fileChecksumSha256).toBe(sha256);

      // 2. Queue payload preserves fileChecksumSha256 matching real file bytes
      const pending = await queue.getPendingOperations();
      const payload = JSON.parse(pending[0]!.payloadJson);
      expect(payload.fileChecksumSha256).toBe(sha256);

      // 3. Verify file on disk is bit-for-bit unchanged
      const diskPath = photo.localUri.startsWith('file://')
        ? fileURLToPath(photo.localUri)
        : photo.localUri;
      const rawFileBytes = fs.readFileSync(diskPath);
      const recomputedSha = crypto.createHash('sha256').update(rawFileBytes).digest('hex');
      expect(recomputedSha).toBe(sha256);
      expect(rawFileBytes.toString('utf-8')).toBe(uniqueBinaryData);
    });
  });
});

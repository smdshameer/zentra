/**
 * ZENTRA Field — Stage 6G Mobile Identity & Sync Engine Hardening Test Suite
 * apps/field/test/stage-6g-mobile-hardening.spec.ts
 *
 * Verifies mobile-side hardening implemented in Stage 6G-B3-C1:
 * 1. Stable UUIDv7 assignment and parent case server-ID resolution for newly created visits
 * 2. Stable UUIDv7 assignment and parent visit/case server-ID resolution for captured evidence
 * 3. Evidence push acknowledgment handling (isEvidence) transitioning syncState to SYNCED
 * 4. Stranded IN_FLIGHT recovery in OperationQueue and SyncEngine upon restart/sync
 * 5. Dual-identifier query resolution (local ID and server UUID) for visits and evidence
 */

import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createAppDatabase } from '../src/database/database';
import { OperationQueue } from '../src/domain/queue/operation-queue';
import { ServiceCaseRepository } from '../src/domain/repositories/service-case.repository';
import { FieldVisitRepository } from '../src/domain/repositories/field-visit.repository';
import { FieldEvidenceRepository } from '../src/domain/repositories/evidence.repository';
import { SyncMetadataRepository } from '../src/sync/sync-metadata.repository';
import { DeltaApplier } from '../src/sync/delta-applier';
import { SyncEngine } from '../src/sync/sync-engine';
import { TemporaryMediaManager } from '../src/hardware/camera/temporary-media-manager';
import type { CapturedPhoto } from '../src/hardware/camera/camera.types';
import type { SyncApiService } from '../src/sync/sync-api.service';
import type { Database } from '@nozbe/watermelondb';

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('Stage 6G-B3-C1 — Mobile Identity & Sync Engine Hardening', () => {
  let db: Database;
  let queue: OperationQueue;
  let caseRepo: ServiceCaseRepository;
  let visitRepo: FieldVisitRepository;
  let evidenceRepo: FieldEvidenceRepository;
  let mediaManager: TemporaryMediaManager;
  let mockApiService: SyncApiService;
  let syncEngine: SyncEngine;

  const testTmpDir = path.join(os.tmpdir(), 'zentra_stage6g_hardening_test_' + process.pid);
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

  const createDummyPhoto = (filename = 'photo_1.jpg'): CapturedPhoto => {
    const filePath = path.join(testTmpDir, filename);
    const content = Buffer.from(`TEST_DUMMY_BINARY_DATA_FOR_${filename}`);
    fs.writeFileSync(filePath, content);
    const normalized = filePath.replace(/\\/g, '/');
    const localUri = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
    return {
      localUri,
      mimeType: 'image/jpeg',
      width: 1920,
      height: 1080,
      aspectRatio: '16:9',
      sizeBytes: content.byteLength,
      capturedAt: new Date().toISOString(),
      facing: 'back',
      isTemporary: true,
    };
  };

  const testServerCaseId = '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540';
  const testEngineerId = '01a126f6-7d9a-7dfa-96bb-000000000001';

  beforeEach(async () => {
    db = createAppDatabase({ inMemory: true, dbName: 'test_hardening_' + Date.now() });
    queue = new OperationQueue(db);
    caseRepo = new ServiceCaseRepository(db);
    visitRepo = new FieldVisitRepository(db);
    mediaManager = new TemporaryMediaManager();
    evidenceRepo = new FieldEvidenceRepository(db, mediaManager);

    // Mock API Service for sync engine tests
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
  // SUITE 1: Visit Identity & Parent Case Server ID Resolution
  // =========================================================================
  describe('1. Visit Creation: UUIDv7 & Parent Case Server-ID Resolution', () => {
    it('generates a stable UUIDv7 serverId and binds parent case serverId into operation payload', async () => {
      // Seed service case with authoritative serverId
      const [seededCase] = await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: testServerCaseId,
          sourceComplaintId: 'src-01',
          zentraCaseCode: 'ZNT-2026-CH-00001',
          schoolId: 'sch-01',
          labId: 'lab-01',
          operationalStatus: 'ASSIGNED',
          internalPriority: 'CRITICAL',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          actualDiagnosisSummary: 'Server motherboard failure',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      expect(seededCase).toBeDefined();
      const localCaseId = seededCase!.id; // WatermelonDB 16-char ID

      // Create visit locally using the local case ID
      const visit = await visitRepo.createVisitLocally({
        serviceCaseId: localCaseId,
        engineerId: testEngineerId,
        visitDate: '2026-10-18',
        notes: 'Initial inspection',
      });

      // 1. Visit serverId must be a valid UUIDv7
      expect(visit.serverId).toMatch(UUID_V7_REGEX);
      expect(visit.serviceCaseId).toBe(localCaseId);

      // 2. Local operation queue entry must resolve parent case serverId
      const ops = await queue.getPendingOperations();
      expect(ops.length).toBe(1);
      const visitOp = ops[0]!;
      expect(visitOp.entityType).toBe('field_visits');
      expect(visitOp.serverEntityId).toBe(visit.serverId);
      expect(visitOp.serverEntityId).toMatch(UUID_V7_REGEX);

      // 3. Payload must contain the server UUID, NEVER the local 16-char ID
      const payload = JSON.parse(visitOp.payloadJson);
      expect(payload.serviceCaseId).toBe(testServerCaseId);
      expect(payload.serviceCaseId).toMatch(UUID_REGEX);
      expect(payload.serviceCaseId).not.toBe(localCaseId);

      // 4. Dual ID recall: getVisitsForCase returns visit using both localCaseId and testServerCaseId
      const byLocal = await visitRepo.getVisitsForCase(localCaseId);
      expect(byLocal.length).toBe(1);
      expect(byLocal[0]?.id).toBe(visit.id);

      const byServer = await visitRepo.getVisitsForCase(testServerCaseId);
      expect(byServer.length).toBe(1);
      expect(byServer[0]?.id).toBe(visit.id);
    });

    it('gracefully handles creation when service case serverId is directly supplied', async () => {
      // Seed service case with authoritative serverId first
      await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: testServerCaseId,
          sourceComplaintId: 'src-01',
          zentraCaseCode: 'ZNT-2026-CH-00001',
          schoolId: 'sch-01',
          labId: 'lab-01',
          operationalStatus: 'ASSIGNED',
          internalPriority: 'CRITICAL',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          actualDiagnosisSummary: 'Server motherboard failure',
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

      expect(visit.serverId).toMatch(UUID_V7_REGEX);
      const ops = await queue.getPendingOperations();
      expect(ops.length).toBe(1);
      const payload = JSON.parse(ops[0]!.payloadJson);
      expect(payload.serviceCaseId).toBe(testServerCaseId);
    });
  });

  // =========================================================================
  // SUITE 2: Evidence Identity & Parent Foreign Key Resolution
  // =========================================================================
  describe('2. Evidence Capture: UUIDv7 & Parent Foreign Key Resolution', () => {
    it('assigns UUIDv7 serverId, sets serverEntityId in queue, and binds parent visit/case server UUIDs', async () => {
      // 1. Seed case with server UUID
      const [seededCase] = await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: testServerCaseId,
          sourceComplaintId: 'src-01',
          zentraCaseCode: 'ZNT-2026-CH-00002',
          schoolId: 'sch-01',
          labId: 'lab-01',
          operationalStatus: 'ASSIGNED',
          internalPriority: 'CRITICAL',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          actualDiagnosisSummary: 'Network switch reboot loop',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      const localCaseId = seededCase!.id;

      // 2. Create visit locally
      const visit = await visitRepo.createVisitLocally({
        serviceCaseId: localCaseId,
        engineerId: testEngineerId,
        visitDate: '2026-10-18',
      });
      const localVisitId = visit.id;
      const serverVisitId = visit.serverId;

      // 3. Register dummy photo in TemporaryMediaManager
      const photo = createDummyPhoto('evidence_slot1.jpg');
      const tempItem = mediaManager.register(photo);

      // Clear pending queue from visit creation so evidence queue is isolated
      const initialOps = await queue.getPendingOperations();
      for (const op of initialOps) {
        await queue.markAcknowledged(op.clientOperationId);
      }

      // 4. Capture and queue evidence passing local visit and case IDs
      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: localVisitId,
        serviceCaseId: localCaseId,
        evidenceSlot: 'SLOT_1_SIGNED_VISIT_REPORT',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      // 5. Evidence model checks: serverId must be populated with a valid UUIDv7
      expect(evidence.id).toBeDefined();
      expect(evidence.serverId).toBeDefined();
      expect(evidence.serverId).toMatch(UUID_V7_REGEX);
      expect(evidence.visitId).toBe(localVisitId);
      expect(evidence.serviceCaseId).toBe(localCaseId);
      expect(evidence.syncState).toBe('LOCAL_ONLY');

      // 6. Operation queue checks: serverEntityId must match evidence.serverId
      const pendingOps = await queue.getPendingOperations();
      expect(pendingOps.length).toBe(1);
      const evOp = pendingOps[0]!;
      expect(evOp.entityType).toBe('evidence_files');
      expect(evOp.serverEntityId).toBe(evidence.serverId);
      expect(evOp.serverEntityId).toMatch(UUID_V7_REGEX);

      // 7. Payload checks: evidenceId, visitId, and serviceCaseId must all be server UUIDs
      const payload = JSON.parse(evOp.payloadJson);
      expect(payload.evidenceId).toBe(evidence.serverId);
      expect(payload.evidenceId).toMatch(UUID_V7_REGEX);

      expect(payload.visitId).toBe(serverVisitId);
      expect(payload.visitId).toMatch(UUID_V7_REGEX);
      expect(payload.visitId).not.toBe(localVisitId);

      expect(payload.serviceCaseId).toBe(testServerCaseId);
      expect(payload.serviceCaseId).toMatch(UUID_REGEX);
      expect(payload.serviceCaseId).not.toBe(localCaseId);

      // 8. Dual ID recall: getEvidenceForVisit works with localVisitId and serverVisitId
      const evByLocal = await evidenceRepo.getEvidenceForVisit(localVisitId);
      expect(evByLocal.length).toBe(1);
      expect(evByLocal[0]?.id).toBe(evidence.id);

      const evByServer = await evidenceRepo.getEvidenceForVisit(serverVisitId);
      expect(evByServer.length).toBe(1);
      expect(evByServer[0]?.id).toBe(evidence.id);

      // 9. Dual ID slot recall
      const slotByLocal = await evidenceRepo.getEvidenceForSlot(localVisitId, 'SLOT_1_SIGNED_VISIT_REPORT');
      expect(slotByLocal?.id).toBe(evidence.id);

      const slotByServer = await evidenceRepo.getEvidenceForSlot(serverVisitId, 'SLOT_1_SIGNED_VISIT_REPORT');
      expect(slotByServer?.id).toBe(evidence.id);
    });
  });

  // =========================================================================
  // SUITE 3: Evidence Acknowledgment in SyncEngine (isEvidence)
  // =========================================================================
  describe('3. SyncEngine Evidence Acknowledgment Handling', () => {
    it('advances evidence syncState to SYNCED and sets serverVersion when push is ACCEPTED', async () => {
      // 1. Seed parent case and visit first
      await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: testServerCaseId,
          sourceComplaintId: 'src-01',
          zentraCaseCode: 'ZNT-2026-CH-00003',
          schoolId: 'sch-01',
          labId: 'lab-01',
          operationalStatus: 'ASSIGNED',
          internalPriority: 'CRITICAL',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          actualDiagnosisSummary: 'RAM replacement',
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

      // Clear pending queue from visit creation
      const initOps = await queue.getPendingOperations();
      for (const op of initOps) {
        await queue.markAcknowledged(op.clientOperationId);
      }

      // 2. Create photo and evidence locally
      const photo = createDummyPhoto('evidence_slot2.jpg');
      const tempItem = mediaManager.register(photo);

      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: visit.id,
        serviceCaseId: testServerCaseId,
        evidenceSlot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      expect(evidence.syncState).toBe('LOCAL_ONLY');

      const pending = await queue.getPendingOperations();
      expect(pending.length).toBe(1);
      const clientOpId = pending[0]!.clientOperationId;

      // 3. Mock central API push response with ACCEPTED status
      (mockApiService.pushMutations as any).mockResolvedValueOnce({
        batchId: 'batch-server-01',
        serverTimestamp: new Date().toISOString(),
        results: [
          {
            clientOperationId: clientOpId,
            status: 'ACCEPTED',
            serverVersion: '1',
            serverTimestamp: new Date().toISOString(),
            data: {
              evidenceFileId: evidence.serverId,
              storagePath: 'evidence/prod/photo-01.jpg',
            },
          },
        ],
      });

      // 4. Execute sync
      const summary = await syncEngine.sync();
      expect(summary.pushedCount).toBe(1);
      expect(summary.acknowledgedCount).toBe(1);

      // 5. Verify operation status is ACKNOWLEDGED
      const remainingPending = await queue.getPendingOperations();
      expect(remainingPending.length).toBe(0);

      // 6. Verify EvidenceModel row in WatermelonDB transitioned to SYNCED
      const updatedEvidence = await evidenceRepo.findById(evidence.id);
      expect(updatedEvidence).not.toBeNull();
      expect(updatedEvidence?.syncState).toBe('SYNCED');
      expect(updatedEvidence?.serverVersion).toBe('1');
      expect(updatedEvidence?.storagePath).toBe('evidence/prod/photo-01.jpg');
    });
  });

  // =========================================================================
  // SUITE 4: Stranded IN_FLIGHT Operation Recovery
  // =========================================================================
  describe('4. Stranded IN_FLIGHT Operation Recovery', () => {
    it('recovers unsubmitted IN_FLIGHT operations to QUEUED and ambiguous operations to CONFLICT', async () => {
      // 1. Unsubmitted operation stranded in IN_FLIGHT (lastAttemptAt is null)
      const op1 = await queue.enqueueStandalone({
        clientOperationId: '01a13ac8-6cdc-778c-8593-000000000098',
        entityType: 'field_visits',
        localEntityId: 'local-vis-01',
        serverEntityId: '01a13ac8-6cdc-778c-8593-000000000098',
        operationType: 'STATUS_TRANSITION',
        payload: { toStatus: 'CHECKED_IN' },
      });
      // Simulate stranded without attempt (e.g. state updated directly in DB before network call)
      await db.write(async () => {
        const rawOp = await db.get('local_operations').find(op1.id);
        await rawOp.update((record: any) => {
          record.status = 'IN_FLIGHT';
          record.lastAttemptAt = null;
        });
      });

      // 2. Ambiguous operation stranded in IN_FLIGHT (lastAttemptAt is set)
      const op2 = await queue.enqueueStandalone({
        clientOperationId: '01a13ac8-6cdc-778c-8593-000000000099',
        entityType: 'field_visits',
        localEntityId: 'local-vis-02',
        serverEntityId: '01a13ac8-6cdc-778c-8593-000000000099',
        operationType: 'STATUS_TRANSITION',
        payload: { toStatus: 'CHECKED_IN' },
      });
      await queue.markInFlight(op2.clientOperationId); // sets lastAttemptAt

      // Calling recoverInFlightOperations()
      const result = await queue.recoverInFlightOperations();
      expect(result.recoveredCount).toBe(1);
      expect(result.ambiguousCount).toBe(1);

      // op1 must be back to QUEUED
      const pending = await queue.getPendingOperations();
      expect(pending.length).toBe(1);
      expect(pending[0]?.status).toBe('QUEUED');
      expect(pending[0]?.clientOperationId).toBe(op1.clientOperationId);

      // op2 must be in CONFLICT with UNCERTAIN_OUTCOME
      const rawConflict = await db.get('local_operations').find(op2.id);
      expect((rawConflict as any).status).toBe('CONFLICT');
      expect((rawConflict as any).conflictCode).toBe('UNCERTAIN_OUTCOME');
    });

    it('SyncEngine recovers stranded unsubmitted IN_FLIGHT operations at beginning of sync cycle', async () => {
      // Enqueue an operation and strand it in IN_FLIGHT without attempt (lastAttemptAt == null)
      const op = await queue.enqueueStandalone({
        clientOperationId: '01a13ac8-6cdc-778c-8593-000000000088',
        entityType: 'service_cases',
        localEntityId: 'local-sc-01',
        serverEntityId: testServerCaseId,
        operationType: 'STATUS_TRANSITION',
        payload: { targetStatus: 'VISIT_STARTED' },
      });
      await db.write(async () => {
        const rawOp = await db.get('local_operations').find(op.id);
        await rawOp.update((record: any) => {
          record.status = 'IN_FLIGHT';
          record.lastAttemptAt = null;
        });
      });

      // Mock push response for recovered operation
      (mockApiService.pushMutations as any).mockResolvedValueOnce({
        batchId: 'batch-recovery-01',
        serverTimestamp: new Date().toISOString(),
        results: [
          {
            clientOperationId: op.clientOperationId,
            status: 'ACCEPTED',
            serverVersion: '2',
            serverTimestamp: new Date().toISOString(),
          },
        ],
      });

      // Run sync: it must recover the unsubmitted in-flight op to QUEUED, push it, and acknowledge it
      const summary = await syncEngine.sync();
      expect(summary.pushedCount).toBe(1);
      expect(summary.acknowledgedCount).toBe(1);

      const pendingAfter = await queue.getPendingOperations();
      expect(pendingAfter.length).toBe(0);
    });

    it('SyncEngine halts ambiguous IN_FLIGHT operations fail-closed into CONFLICT', async () => {
      // Enqueue an operation and strand it in IN_FLIGHT with attempt (lastAttemptAt != null)
      const op = await queue.enqueueStandalone({
        clientOperationId: '01a13ac8-6cdc-778c-8593-000000000077',
        entityType: 'service_cases',
        localEntityId: 'local-sc-02',
        serverEntityId: testServerCaseId,
        operationType: 'STATUS_TRANSITION',
        payload: { targetStatus: 'VISIT_STARTED' },
      });
      await queue.markInFlight(op.clientOperationId); // sets lastAttemptAt

      // Run sync: it must isolate ambiguous op into CONFLICT and NOT push it
      const summary = await syncEngine.sync();
      expect(summary.pushedCount).toBe(0);
      expect(mockApiService.pushMutations).not.toHaveBeenCalled();

      const raw = await db.get('local_operations').find(op.id);
      expect((raw as any).status).toBe('CONFLICT');
      expect((raw as any).conflictCode).toBe('UNCERTAIN_OUTCOME');
    });
  });
});

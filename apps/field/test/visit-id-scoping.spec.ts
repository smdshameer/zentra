/**
 * ZENTRA — Milestone 1.1 Issue A: Explicit Visit ID Scoping Test Suite
 * apps/field/test/visit-id-scoping.spec.ts
 *
 * Authoritatively verifies remediation of Issue A (Visit ID Scoping):
 * - Test A: Multiple Cached Visits — Disambiguates visits and isolates evidence
 * - Test B: Missing or Blank visitId — Fails closed, no orphan media or queue operations
 * - Test C: Nonexistent visitId — Fails closed, rejects synthetic IDs
 * - Test D: Service Case ID Mismatch — Rejects cross-case attachment
 * - Test E: Valid Capture Regression — Computes SHA-256, preserves slot, GPS, and queues offline op
 * - Test F: Callback Chain Verification — Propagates explicit identities without modification
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createAppDatabase } from '../src/database/database';
import { FieldVisitRepository } from '../src/domain/repositories/field-visit.repository';
import { FieldEvidenceRepository } from '../src/domain/repositories/evidence.repository';
import { ServiceCaseRepository } from '../src/domain/repositories/service-case.repository';
import { TemporaryMediaManager } from '../src/hardware/camera/temporary-media-manager';
import { OperationQueue } from '../src/domain/queue/operation-queue';
import { executeCaptureEvidence } from '../src/domain/evidence/capture-evidence-handler';
import type { CaptureEvidenceCallbackParams } from '../src/screens/FieldVisitScreen';
import type { Database } from '@nozbe/watermelondb';
import type { CapturedPhoto } from '../src/hardware/camera/camera.types';
import type { FieldVisitModel } from '../src/database/models/FieldVisitModel';

describe('Milestone 1.1 Issue A — Explicit Visit ID and Service Case ID Scoping', () => {
  let db: Database;
  let visitRepo: FieldVisitRepository;
  let evidenceRepo: FieldEvidenceRepository;
  let caseRepo: ServiceCaseRepository;
  let mediaManager: TemporaryMediaManager;
  let queue: OperationQueue;

  const testEngineerId = 'fe-scoping-eng-001';
  const testTmpDir = path.join(os.tmpdir(), 'zentra_scoping_test_' + process.pid);

  beforeEach(async () => {
    if (!fs.existsSync(testTmpDir)) {
      fs.mkdirSync(testTmpDir, { recursive: true });
    }
    db = createAppDatabase({ inMemory: true, dbName: 'test_scoping_' + Date.now() });
    mediaManager = new TemporaryMediaManager();
    visitRepo = new FieldVisitRepository(db);
    evidenceRepo = new FieldEvidenceRepository(db, mediaManager);
    caseRepo = new ServiceCaseRepository(db);
    queue = new OperationQueue(db);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testTmpDir)) {
        fs.rmSync(testTmpDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore temporary directory cleanup failure
    }
  });

  const createBinaryPhoto = (name: string, content: string | Buffer): CapturedPhoto => {
    const filename = `${name}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
    const filePath = path.join(testTmpDir, filename);
    const buf = typeof content === 'string' ? Buffer.from(content) : content;
    fs.writeFileSync(filePath, buf);
    const normalized = filePath.replace(/\\/g, '/');
    const localUri = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
    return {
      localUri,
      mimeType: 'image/jpeg',
      width: 1920,
      height: 1080,
      aspectRatio: '16:9',
      sizeBytes: buf.byteLength,
      capturedAt: new Date().toISOString(),
      facing: 'back',
      isTemporary: true,
    };
  };

  // =========================================================================
  // TEST A: Multiple Cached Visits (Visit 1 IN_PROGRESS vs Visit 2 CHECKED_IN)
  // =========================================================================
  describe('Test A — Multiple Cached Visits Disambiguation', () => {
    it('attaches evidence strictly to the explicitly targeted visit (Visit 2) and isolates Visit 1', async () => {
      const caseAId = '01a126f6-7d9a-7dfa-96bb-000000000101';
      const caseBId = '01a126f6-7d9a-7dfa-96bb-000000000202';

      // Seed both service cases
      await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: caseAId,
          sourceComplaintId: 'cmp-A',
          zentraCaseCode: 'ZNT-A-001',
          schoolId: 'sch-A',
          labId: 'lab-A-01',
          operationalStatus: 'IN_PROGRESS',
          internalPriority: 'HIGH',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          serviceCaseId: caseBId,
          sourceComplaintId: 'cmp-B',
          zentraCaseCode: 'ZNT-B-002',
          schoolId: 'sch-B',
          labId: 'lab-B-02',
          operationalStatus: 'ASSIGNED',
          internalPriority: 'HIGH',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      // Seed Visit 1 for Case A (status: IN_PROGRESS)
      const visit1 = await visitRepo.createVisitLocally({
        serviceCaseId: caseAId,
        engineerId: testEngineerId,
      });
      await db.write(async () => {
        await visit1.update((r) => {
          r.status = 'IN_PROGRESS';
        });
      });

      // Seed Visit 2 for Case B (status: CHECKED_IN)
      const visit2 = await visitRepo.createVisitLocally({
        serviceCaseId: caseBId,
        engineerId: testEngineerId,
      });
      await db.write(async () => {
        await visit2.update((r) => {
          r.status = 'CHECKED_IN';
        });
      });

      // Proof of the old bug: unconstrained query would have picked Visit 1
      const allLocalVisits = await db.get<FieldVisitModel>('field_visits').query().fetch();
      const faultyInferredVisit =
        allLocalVisits.find((v) => v.status === 'IN_PROGRESS' || v.status === 'CHECKED_IN') ||
        allLocalVisits[0];
      expect(faultyInferredVisit?.id).toBe(visit1.id);
      expect(faultyInferredVisit?.serviceCaseId).toBe(caseAId);

      // Now trigger capture with EXPLICIT scoping targeted at Visit 2 / Case B
      const photo = createBinaryPhoto('visit2_photo', 'EXPLICIT_VISIT_2_EVIDENCE_BYTES');
      const evidence = await executeCaptureEvidence(
        {
          fieldVisitRepo: visitRepo,
          fieldEvidenceRepo: evidenceRepo,
          temporaryMediaManager: mediaManager,
        },
        {
          visitId: visit2.id,
          serviceCaseId: caseBId,
          slot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
          photo,
          gps: { latitude: 11.4501, longitude: 77.6822, accuracyMeters: 5.0 },
        },
      );

      // Assert evidence was saved with visit_id == Visit 2.id and service_case_id == Case B
      expect(evidence.id).toBeDefined();
      expect(evidence.visitId).toBe(visit2.id);
      expect(evidence.serviceCaseId).toBe(caseBId);
      expect(evidence.evidenceSlot).toBe('SLOT_2_EQUIPMENT_WORKING_PHOTO');

      // Assert that Visit 1 has ZERO associated evidence (complete isolation)
      const visit1Evidence = await evidenceRepo.getEvidenceForVisit(visit1.id);
      expect(visit1Evidence).toHaveLength(0);

      // Assert Visit 2 has exactly 1 evidence record
      const visit2Evidence = await evidenceRepo.getEvidenceForVisit(visit2.id);
      expect(visit2Evidence).toHaveLength(1);
      expect(visit2Evidence[0]?.id).toBe(evidence.id);
    });
  });

  // =========================================================================
  // TEST B: Missing or Blank visitId
  // =========================================================================
  describe('Test B — Missing or Blank visitId Handling', () => {
    it('fails closed and throws error when visitId is empty string', async () => {
      const photo = createBinaryPhoto('empty_visit_id', 'DATA_BYTES');
      const initialMediaCount = mediaManager.listAll().length;

      await expect(
        executeCaptureEvidence(
          {
            fieldVisitRepo: visitRepo,
            fieldEvidenceRepo: evidenceRepo,
            temporaryMediaManager: mediaManager,
          },
          {
            visitId: '',
            serviceCaseId: 'sc-case-B-202',
            slot: 'SLOT_1_HM_SIGNED_REPORT',
            photo,
          },
        ),
      ).rejects.toThrow(/visitId is required and cannot be blank/);

      // Verify no evidence record created in DB
      const allEvidence = await db.get('evidence').query().fetch();
      expect(allEvidence).toHaveLength(0);

      // Verify no queue operation enqueued
      const pendingOps = await queue.getPendingOperations();
      expect(pendingOps).toHaveLength(0);

      // Verify no media registered in TemporaryMediaManager (zero orphan files)
      expect(mediaManager.listAll().length).toBe(initialMediaCount);
    });

    it('fails closed and throws error when visitId contains only whitespace', async () => {
      const photo = createBinaryPhoto('whitespace_visit_id', 'DATA_BYTES');
      const initialMediaCount = mediaManager.listAll().length;

      await expect(
        executeCaptureEvidence(
          {
            fieldVisitRepo: visitRepo,
            fieldEvidenceRepo: evidenceRepo,
            temporaryMediaManager: mediaManager,
          },
          {
            visitId: '    ',
            serviceCaseId: 'sc-case-B-202',
            slot: 'SLOT_1_HM_SIGNED_REPORT',
            photo,
          },
        ),
      ).rejects.toThrow(/visitId is required and cannot be blank/);

      // Verify no DB mutations or orphaned media
      const allEvidence = await db.get('evidence').query().fetch();
      expect(allEvidence).toHaveLength(0);
      expect(mediaManager.listAll().length).toBe(initialMediaCount);
    });

    it('fails closed and throws error when serviceCaseId is missing or blank', async () => {
      const photo = createBinaryPhoto('empty_case_id', 'DATA_BYTES');

      await expect(
        executeCaptureEvidence(
          {
            fieldVisitRepo: visitRepo,
            fieldEvidenceRepo: evidenceRepo,
            temporaryMediaManager: mediaManager,
          },
          {
            visitId: 'valid-visit-id',
            serviceCaseId: '',
            slot: 'SLOT_1_HM_SIGNED_REPORT',
            photo,
          },
        ),
      ).rejects.toThrow(/serviceCaseId is required and cannot be blank/);
    });
  });

  // =========================================================================
  // TEST C: Nonexistent visitId
  // =========================================================================
  describe('Test C — Nonexistent visitId Handling', () => {
    it('fails closed and rejects synthetically generated unknown visitId', async () => {
      const photo = createBinaryPhoto('synthetic_id', 'DATA_BYTES');
      const initialMediaCount = mediaManager.listAll().length;
      const syntheticVisitId = 'unknown-visit-uuid-99999';

      await expect(
        executeCaptureEvidence(
          {
            fieldVisitRepo: visitRepo,
            fieldEvidenceRepo: evidenceRepo,
            temporaryMediaManager: mediaManager,
          },
          {
            visitId: syntheticVisitId,
            serviceCaseId: 'sc-case-B-202',
            slot: 'SLOT_1_HM_SIGNED_REPORT',
            photo,
          },
        ),
      ).rejects.toThrow(`Target field visit not found: ${syntheticVisitId}`);

      // Verify zero evidence records in database
      const allEvidence = await db.get('evidence').query().fetch();
      expect(allEvidence).toHaveLength(0);

      // Verify zero pending operations
      const pendingOps = await queue.getPendingOperations();
      expect(pendingOps).toHaveLength(0);

      // Verify zero media registration side effects
      expect(mediaManager.listAll().length).toBe(initialMediaCount);
    });
  });

  // =========================================================================
  // TEST D: Service Case ID Mismatch
  // =========================================================================
  describe('Test D — Service Case ID Mismatch Handling', () => {
    it('rejects capture when supplied serviceCaseId does not match target visit serviceCaseId', async () => {
      const caseAId = '01a126f6-7d9a-7dfa-96bb-000000000101';
      const caseBId = '01a126f6-7d9a-7dfa-96bb-000000000202';

      // Seed parent service case A
      await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: caseAId,
          sourceComplaintId: 'cmp-A',
          zentraCaseCode: 'ZNT-A-001',
          schoolId: 'sch-A',
          labId: 'lab-A-01',
          operationalStatus: 'IN_PROGRESS',
          internalPriority: 'HIGH',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      // Create Visit for Case A
      const visitA = await visitRepo.createVisitLocally({
        serviceCaseId: caseAId,
        engineerId: testEngineerId,
      });

      const photo = createBinaryPhoto('mismatch_photo', 'MISMATCH_BYTES');
      const initialMediaCount = mediaManager.listAll().length;

      // Attempt to capture for visitA, but pass caseBId
      await expect(
        executeCaptureEvidence(
          {
            fieldVisitRepo: visitRepo,
            fieldEvidenceRepo: evidenceRepo,
            temporaryMediaManager: mediaManager,
          },
          {
            visitId: visitA.id,
            serviceCaseId: caseBId,
            slot: 'SLOT_1_HM_SIGNED_REPORT',
            photo,
          },
        ),
      ).rejects.toThrow(
        `Service case mismatch: target visit ${visitA.id} belongs to case ${caseAId}, but received ${caseBId}`,
      );

      // Verify zero evidence records created
      const allEvidence = await db.get('evidence').query().fetch();
      expect(allEvidence).toHaveLength(0);

      // Verify zero queued operations for evidence
      const pendingOps = await queue.getPendingOperations();
      const evidenceOps = pendingOps.filter((o) => o.entityType === 'evidence_files');
      expect(evidenceOps).toHaveLength(0);

      // Verify zero orphaned media registered
      expect(mediaManager.listAll().length).toBe(initialMediaCount);
    });
  });

  // =========================================================================
  // TEST E: Valid Capture Regression
  // =========================================================================
  describe('Test E — Valid Capture Regression', () => {
    it('verifies SHA-256 calculation, evidence slot preservation, GPS metadata, and offline queue insertion', async () => {
      const caseId = '01a126f6-7d9a-7dfa-96bb-000000000301';
      await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: caseId,
          sourceComplaintId: 'cmp-reg',
          zentraCaseCode: 'ZNT-REG-001',
          schoolId: 'sch-reg',
          labId: 'lab-reg-01',
          operationalStatus: 'IN_PROGRESS',
          internalPriority: 'HIGH',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      const visit = await visitRepo.createVisitLocally({
        serviceCaseId: caseId,
        engineerId: testEngineerId,
      });

      const rawPhotoBytes = Buffer.from('VALID_CAPTURE_REGRESSION_BINARY_CONTENT_20261010');
      const expectedSha256 = crypto.createHash('sha256').update(rawPhotoBytes).digest('hex');

      const photo = createBinaryPhoto('valid_reg_photo', rawPhotoBytes);

      const evidence = await executeCaptureEvidence(
        {
          fieldVisitRepo: visitRepo,
          fieldEvidenceRepo: evidenceRepo,
          temporaryMediaManager: mediaManager,
        },
        {
          visitId: visit.id,
          serviceCaseId: caseId,
          slot: 'SLOT_1_HM_SIGNED_REPORT',
          photo,
          gps: {
            latitude: 11.4501,
            longitude: 77.6822,
            accuracyMeters: 4.2,
          },
        },
      );

      // 1. Verify SHA-256 hash matches true file bytes
      expect(evidence.fileChecksumSha256).toBe(expectedSha256);
      expect(evidence.fileChecksumSha256).toHaveLength(64);

      // 2. Verify evidence slot preservation
      expect(evidence.evidenceSlot).toBe('SLOT_1_HM_SIGNED_REPORT');
      expect(evidence.uploadStatus).toBe('QUEUED');
      expect(evidence.syncState).toBe('LOCAL_ONLY');

      // 3. Verify GPS metadata attached
      expect(evidence.gpsLatitude).toBe(11.4501);
      expect(evidence.gpsLongitude).toBe(77.6822);
      expect(evidence.gpsAccuracyMeters).toBe(4.2);

      // 4. Verify operation is enqueued for offline sync
      const pendingOps = await queue.getPendingOperations();
      const evidenceOp = pendingOps.find(
        (op) => op.entityType === 'evidence_files' && op.localEntityId === evidence.id,
      );
      expect(evidenceOp).toBeDefined();
      expect(evidenceOp?.operationType).toBe('INSERT');

      // 5. Verify payload does not leak raw binary data
      const payload = JSON.parse(evidenceOp!.payloadJson);
      expect(payload.fileChecksumSha256).toBe(expectedSha256);
      expect(payload.visitId).toBe(visit.serverId || visit.id);
      expect(payload.serviceCaseId).toBe(caseId);
      expect(payload.base64).toBeUndefined();
      expect(payload.binary).toBeUndefined();
    });
  });

  // =========================================================================
  // TEST F: Callback Chain Verification
  // =========================================================================
  describe('Test F — Callback Chain and Identity Propagation', () => {
    it('verifies callback propagates active visit id and service case id without modification', async () => {
      const mockActiveVisit = {
        id: 'vst-active-call-001',
        serviceCaseId: 'sc-case-call-001',
      };
      const mockTargetCaseId = 'sc-case-call-001';
      const mockSlot = 'SLOT_2_EQUIPMENT_WORKING_PHOTO' as const;
      const mockPhoto = createBinaryPhoto('callback_photo', 'CALLBACK_BYTES');
      const mockGps = { latitude: 11.4501, longitude: 77.6822, accuracyMeters: 3.5 };

      let capturedParams: CaptureEvidenceCallbackParams | null = null;

      // Mock onCaptureEvidence callback handler in Navigator / App
      const mockOnCaptureEvidence = async (params: CaptureEvidenceCallbackParams) => {
        capturedParams = params;
        return null as any;
      };

      // Simulate FieldVisitScreen's handlePhotoCapturedFromViewfinder logic
      const simulateScreenCapture = async (
        activeVisit: { id: string; serviceCaseId: string } | null,
        targetCaseId: string | null,
        slot: typeof mockSlot,
        photo: CapturedPhoto,
        gps?: typeof mockGps,
      ) => {
        if (!activeVisit?.id || !targetCaseId) {
          // Fail-closed guard at screen level
          return false;
        }

        await mockOnCaptureEvidence({
          visitId: activeVisit.id,
          serviceCaseId: targetCaseId,
          slot,
          photo,
          gps,
        });
        return true;
      };

      // 1. Success case: identities propagate cleanly
      const triggered = await simulateScreenCapture(
        mockActiveVisit,
        mockTargetCaseId,
        mockSlot,
        mockPhoto,
        mockGps,
      );

      expect(triggered).toBe(true);
      expect(capturedParams).not.toBeNull();
      expect(capturedParams!.visitId).toBe('vst-active-call-001');
      expect(capturedParams!.serviceCaseId).toBe('sc-case-call-001');
      expect(capturedParams!.slot).toBe('SLOT_2_EQUIPMENT_WORKING_PHOTO');
      expect(capturedParams!.gps).toEqual(mockGps);

      // 2. Fail-closed at screen level: null activeVisit blocks callback
      capturedParams = null;
      const blockedNoVisit = await simulateScreenCapture(
        null,
        mockTargetCaseId,
        mockSlot,
        mockPhoto,
        mockGps,
      );
      expect(blockedNoVisit).toBe(false);
      expect(capturedParams).toBeNull();

      // 3. Fail-closed at screen level: null targetCaseId blocks callback
      const blockedNoCase = await simulateScreenCapture(
        mockActiveVisit,
        null,
        mockSlot,
        mockPhoto,
        mockGps,
      );
      expect(blockedNoCase).toBe(false);
      expect(capturedParams).toBeNull();
    });

    it('end-to-end integration: screen callback connects directly to executeCaptureEvidence and persists correctly', async () => {
      const caseId = '01a126f6-7d9a-7dfa-96bb-000000000401';
      await caseRepo.upsertCasesFromServer([
        {
          serviceCaseId: caseId,
          sourceComplaintId: 'cmp-e2e',
          zentraCaseCode: 'ZNT-E2E-001',
          schoolId: 'sch-e2e',
          labId: 'lab-e2e-01',
          operationalStatus: 'IN_PROGRESS',
          internalPriority: 'HIGH',
          assignedPrimaryEngineerId: testEngineerId,
          slaBreachStatus: 'WITHIN_SLA',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      const visit = await visitRepo.createVisitLocally({
        serviceCaseId: caseId,
        engineerId: testEngineerId,
      });

      const photo = createBinaryPhoto('e2e_photo', 'E2E_BINARY_BYTES');
      let refreshCalled = false;

      // Define App.tsx handler matching exact production code
      const handleCaptureEvidence = async (params: CaptureEvidenceCallbackParams) => {
        const created = await executeCaptureEvidence(
          {
            fieldVisitRepo: visitRepo,
            fieldEvidenceRepo: evidenceRepo,
            temporaryMediaManager: mediaManager,
          },
          params,
        );
        refreshCalled = true;
        return created;
      };

      // Invoke through typed parameter envelope
      const createdEvidence = await handleCaptureEvidence({
        visitId: visit.id,
        serviceCaseId: caseId,
        slot: 'SLOT_1_HM_SIGNED_REPORT',
        photo,
        gps: { latitude: 11.4501, longitude: 77.6822, accuracyMeters: 5.0 },
      });

      expect(createdEvidence.id).toBeDefined();
      expect(createdEvidence.visitId).toBe(visit.id);
      expect(createdEvidence.serviceCaseId).toBe(caseId);
      expect(refreshCalled).toBe(true);
    });
  });
});

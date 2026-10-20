/**
 * ZENTRA Field — Stage 6G-B3-C3 Regression Test Suite
 * apps/field/test/stage-6g-evidence-size-remediation.spec.ts
 *
 * Verifies evidence file-size remediation:
 * 1. Automatic physical byte measurement when photo sizeBytes is missing or null
 * 2. Exact match between physical bytes on disk, evidence record, and queued payload
 * 3. Complete absence of hardcoded 102400 (100 KB) fallback values
 * 4. Rejection of invalid, negative, non-integer, or 0-byte media
 * 5. Cryptographic SHA-256 consistency with measured byte length
 * 6. Single disk read optimization via inspectMediaFile
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createAppDatabase } from '../src/database/database';
import { FieldEvidenceRepository } from '../src/domain/repositories/evidence.repository';
import { TemporaryMediaManager } from '../src/hardware/camera/temporary-media-manager';
import { OperationQueue } from '../src/domain/queue/operation-queue';
import type { Database } from '@nozbe/watermelondb';
import type { CapturedPhoto } from '../src/hardware/camera/camera.types';
import { createEvidenceUploadSessionSchema, syncMutationItemSchema } from '@zentra/contracts';

describe('Stage 6G-B3-C3 — Evidence File-Size Remediation & Regression Verification', () => {
  let db: Database;
  let evidenceRepo: FieldEvidenceRepository;
  let mediaManager: TemporaryMediaManager;
  let queue: OperationQueue;

  const testVisitId = '01a13ac8-6cdc-778c-8593-000000000001';
  const testCaseId = '01a126f6-7d9a-7dfa-96bb-000000000001';

  const testTmpDir = path.join(os.tmpdir(), 'zentra_stage6g_c3_test_' + process.pid);
  if (!fs.existsSync(testTmpDir)) {
    fs.mkdirSync(testTmpDir, { recursive: true });
  }

  afterEach(() => {
    try {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  beforeEach(async () => {
    if (!fs.existsSync(testTmpDir)) {
      fs.mkdirSync(testTmpDir, { recursive: true });
    }

    db = createAppDatabase({ inMemory: true, dbName: 'test_c3_' + Date.now() });
    mediaManager = new TemporaryMediaManager();
    evidenceRepo = new FieldEvidenceRepository(db, mediaManager);
    queue = new OperationQueue(db);

    await db.write(async () => {
      await db.get('service_cases').create((rec: any) => {
        rec.serverId = testCaseId;
        rec.sourceComplaintId = 'src-01';
        rec.zentraCaseCode = 'ZNT-2026-EV-C3';
        rec.schoolId = 'sch-01';
        rec.labId = 'lab-01';
        rec.operationalStatus = 'ASSIGNED';
        rec.internalPriority = 'CRITICAL';
        rec.assignedPrimaryEngineerId = 'fe-01';
        rec.slaBreachStatus = 'WITHIN_SLA';
        rec.verificationStatus = 'PENDING_REVIEW';
        rec.isDeleted = false;
        rec.syncState = 'SYNCED';
      });
      await db.get('field_visits').create((rec: any) => {
        rec.serverId = testVisitId;
        rec.serviceCaseId = testCaseId;
        rec.engineerId = 'fe-01';
        rec.visitSequenceNumber = 1;
        rec.visitDate = '2026-10-18';
        rec.status = 'IN_PROGRESS';
        rec.syncState = 'SYNCED';
      });
    });
  });

  const createTestPhotoFile = (filename: string, byteLength: number): { photo: CapturedPhoto; actualBytes: Buffer } => {
    const filePath = path.join(testTmpDir, filename);
    const actualBytes = crypto.randomBytes(byteLength);
    fs.writeFileSync(filePath, actualBytes);

    const normalized = filePath.replace(/\\/g, '/');
    const localUri = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;

    return {
      photo: {
        localUri,
        mimeType: 'image/jpeg',
        width: 1920,
        height: 1080,
        aspectRatio: '16:9',
        // Omitting sizeBytes to accurately simulate ExpoCameraAdapter behavior
        sizeBytes: undefined,
        capturedAt: new Date().toISOString(),
        facing: 'back',
        isTemporary: true,
      },
      actualBytes,
    };
  };

  it('measures physical disk bytes and eliminates hardcoded 102400 fallback when sizeBytes is undefined', async () => {
    // Exact byte size matching device Slot 1 photo (209,200 bytes)
    const exactSlot1Bytes = 209200;
    const { photo, actualBytes } = createTestPhotoFile('slot_1_remediated.jpg', exactSlot1Bytes);
    const expectedHash = crypto.createHash('sha256').update(actualBytes).digest('hex');

    const tempItem = mediaManager.register(photo);
    expect(tempItem.sizeBytes).toBeNull(); // Confirmed null in registry

    const evidence = await evidenceRepo.captureAndQueueEvidence({
      visitId: testVisitId,
      serviceCaseId: testCaseId,
      evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
      evidenceType: 'PHOTO',
      mediaItem: tempItem,
    });

    // 1. Evidence record must record exact physical bytes, NOT 102400
    expect(evidence.fileSizeBytes).toBe(exactSlot1Bytes);
    expect(evidence.fileSizeBytes).not.toBe(102400);
    expect(evidence.fileChecksumSha256).toBe(expectedHash);

    // 2. Queue payload must also record exact physical bytes, NOT 102400
    const pendingOps = await queue.getPendingOperations();
    const op = pendingOps.find((o) => o.localEntityId === evidence.id);
    expect(op).toBeDefined();

    const payload = JSON.parse(op!.payloadJson);
    expect(payload.fileSizeBytes).toBe(exactSlot1Bytes);
    expect(payload.fileSizeBytes).not.toBe(102400);
    expect(payload.fileChecksumSha256).toBe(expectedHash);
  });

  it('accurately captures arbitrary file sizes (e.g. 209,230 bytes matching Slot 2)', async () => {
    const exactSlot2Bytes = 209230;
    const { photo } = createTestPhotoFile('slot_2_remediated.jpg', exactSlot2Bytes);
    const tempItem = mediaManager.register(photo);

    const evidence = await evidenceRepo.captureAndQueueEvidence({
      visitId: testVisitId,
      serviceCaseId: testCaseId,
      evidenceSlot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
      evidenceType: 'PHOTO',
      mediaItem: tempItem,
    });

    expect(evidence.fileSizeBytes).toBe(exactSlot2Bytes);
    expect(evidence.fileSizeBytes).not.toBe(102400);

    const pendingOps = await queue.getPendingOperations();
    const op = pendingOps.find((o) => o.localEntityId === evidence.id);
    const payload = JSON.parse(op!.payloadJson);
    expect(payload.fileSizeBytes).toBe(exactSlot2Bytes);
  });

  it('rejects capture if the target media file is missing from disk', async () => {
    const missingPhoto: CapturedPhoto = {
      localUri: 'file:///non/existent/path/ghost_photo.jpg',
      mimeType: 'image/jpeg',
      width: 1920,
      height: 1080,
      aspectRatio: '16:9',
      sizeBytes: undefined,
      capturedAt: new Date().toISOString(),
      facing: 'back',
      isTemporary: true,
    };
    const tempItem = mediaManager.register(missingPhoto);

    await expect(
      evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
        mediaItem: tempItem,
      }),
    ).rejects.toThrow(/Evidence file not found at local URI/);
  });

  it('rejects capture if the media file is 0 bytes (empty file)', async () => {
    const { photo } = createTestPhotoFile('empty_photo.jpg', 0);
    const tempItem = mediaManager.register(photo);

    await expect(
      evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
        mediaItem: tempItem,
      }),
    ).rejects.toThrow(/empty \(0 bytes\)/);
  });

  it('rejects capture if explicit fileSizeBytes is non-positive or non-integer', async () => {
    const { photo } = createTestPhotoFile('invalid_size.jpg', 1024);
    const tempItem = mediaManager.register(photo);

    await expect(
      evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
        mediaItem: tempItem,
        fileSizeBytes: -50,
      }),
    ).rejects.toThrow(/invalid.*fileSizeBytes/i);

    await expect(
      evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
        mediaItem: tempItem,
        fileSizeBytes: 12.34 as any,
      }),
    ).rejects.toThrow(/invalid.*fileSizeBytes/i);
  });

  it('uses inspectMediaFile to avoid duplicate disk I/O when computing checksum and measuring size', async () => {
    const { photo } = createTestPhotoFile('single_io.jpg', 50000);
    const tempItem = mediaManager.register(photo);

    const readSpy = vi.spyOn(evidenceRepo, 'readLocalFileBytes');

    await evidenceRepo.captureAndQueueEvidence({
      visitId: testVisitId,
      serviceCaseId: testCaseId,
      evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
      mediaItem: tempItem,
    });

    // Exactly 1 read must have occurred for both checksum AND size measurement
    expect(readSpy).toHaveBeenCalledTimes(1);
    readSpy.mockRestore();
  });

  it('verifies repaired evidence payloads comply 100% with @zentra/contracts schemas', () => {
    const repairedOp4Payload = {
      evidenceId: '01a14fbe-5a23-7b1b-b1e9-0355677a4153',
      visitId: '01a13ac8-6cdc-778c-8593-ee170fc4d885',
      serviceCaseId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
      evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
      evidenceType: 'PHOTO',
      localMediaId: 'temp_img_1791989283958_ibrz3ny',
      fileChecksumSha256: 'cae9044c31d9481034c985f7b6fac346aa2733b730089db6667dc6f54dbe39ab',
      fileSizeBytes: 209200,
      mimeType: 'image/jpeg',
      capturedAt: '2026-10-14T14:48:03.906Z',
      uploadStatus: 'QUEUED',
      gpsLatitude: 10.8695078,
      gpsLongitude: 79.786368,
      gpsAccuracyMeters: 20,
    };

    const repairedOp5Payload = {
      evidenceId: '01a14fbe-5a24-768e-b0ac-3af1385542f1',
      visitId: '01a13ac8-6cdc-778c-8593-ee170fc4d885',
      serviceCaseId: '01a126f6-7d9a-7dfa-96bb-d6f4a07fe540',
      evidenceSlot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
      evidenceType: 'PHOTO',
      localMediaId: 'temp_img_1791989420815_v0tpalt',
      fileChecksumSha256: '0bd81d74d792a1f880ddbdeff29cc90ed764dc1d48baca39d01c500007a0a7ac',
      fileSizeBytes: 209230,
      mimeType: 'image/jpeg',
      capturedAt: '2026-10-14T14:50:20.759Z',
      uploadStatus: 'QUEUED',
      gpsLatitude: 10.8695078,
      gpsLongitude: 79.786368,
      gpsAccuracyMeters: 20,
    };

    const op4Validation = createEvidenceUploadSessionSchema.safeParse(repairedOp4Payload);
    expect(op4Validation.success).toBe(true);

    const op5Validation = createEvidenceUploadSessionSchema.safeParse(repairedOp5Payload);
    expect(op5Validation.success).toBe(true);

    const op4Mutation = syncMutationItemSchema.safeParse({
      clientOperationId: '01a13ae2-7e8f-73ad-8cdb-b269cb9f02b9',
      entityType: 'evidence_files',
      entityId: '01a14fbe-5a23-7b1b-b1e9-0355677a4153',
      operationType: 'INSERT',
      payload: repairedOp4Payload,
      clientCreatedAt: new Date().toISOString(),
    });
    expect(op4Mutation.success).toBe(true);

    const op5Mutation = syncMutationItemSchema.safeParse({
      clientOperationId: '01a13ae4-9533-7929-b5a9-6f53e18629dd',
      entityType: 'evidence_files',
      entityId: '01a14fbe-5a24-768e-b0ac-3af1385542f1',
      operationType: 'INSERT',
      payload: repairedOp5Payload,
      clientCreatedAt: new Date().toISOString(),
    });
    expect(op5Mutation.success).toBe(true);
  });

  it('rejects capture if explicit fileSizeBytes contradicts physical media size (e.g. 50,000 vs 209,200) before any persistence', async () => {
    const exactSlot1Bytes = 209200;
    const { photo } = createTestPhotoFile('contradict_explicit.jpg', exactSlot1Bytes);
    const tempItem = mediaManager.register(photo);

    await expect(
      evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
        mediaItem: tempItem,
        fileSizeBytes: 50000,
      }),
    ).rejects.toThrow(/explicit fileSizeBytes \(50000\) contradicts actual physical file size \(209200\)/i);

    // Verify neither evidence record nor queue operation was persisted
    const allEvidence = await db.get('evidence').query().fetch();
    expect(allEvidence.length).toBe(0);

    const pendingOps = await queue.getPendingOperations();
    expect(pendingOps.length).toBe(0);
  });

  it('rejects capture if mediaItem.sizeBytes contradicts physical media size (e.g. 102,400 vs 209,200) before any persistence', async () => {
    const exactSlot1Bytes = 209200;
    const { photo } = createTestPhotoFile('contradict_media_item.jpg', exactSlot1Bytes);
    photo.sizeBytes = 102400; // Simulated stale or inaccurate upstream metadata
    const tempItem = mediaManager.register(photo);

    await expect(
      evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
        mediaItem: tempItem,
      }),
    ).rejects.toThrow(/mediaItem\.sizeBytes \(102400\) contradicts actual physical file size \(209200\)/i);

    // Verify neither evidence record nor queue operation was persisted
    const allEvidence = await db.get('evidence').query().fetch();
    expect(allEvidence.length).toBe(0);

    const pendingOps = await queue.getPendingOperations();
    expect(pendingOps.length).toBe(0);
  });

  it('accepts capture when explicit fileSizeBytes and/or mediaItem.sizeBytes strictly match physical media size', async () => {
    const exactSlot1Bytes = 209200;
    const { photo } = createTestPhotoFile('matching_sizes.jpg', exactSlot1Bytes);
    photo.sizeBytes = exactSlot1Bytes;
    const tempItem = mediaManager.register(photo);

    const evidence = await evidenceRepo.captureAndQueueEvidence({
      visitId: testVisitId,
      serviceCaseId: testCaseId,
      evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
      mediaItem: tempItem,
      fileSizeBytes: exactSlot1Bytes,
    });

    expect(evidence.fileSizeBytes).toBe(exactSlot1Bytes);

    const pendingOps = await queue.getPendingOperations();
    const op = pendingOps.find((o) => o.localEntityId === evidence.id);
    expect(op).toBeDefined();

    const payload = JSON.parse(op!.payloadJson);
    expect(payload.fileSizeBytes).toBe(exactSlot1Bytes);
  });

  it('validates both explicit fileSizeBytes and mediaItem.sizeBytes independently and rejects if either contradicts', async () => {
    const exactSlot1Bytes = 209200;
    const { photo } = createTestPhotoFile('independent_validation.jpg', exactSlot1Bytes);
    photo.sizeBytes = exactSlot1Bytes; // matches
    const tempItem = mediaManager.register(photo);

    // Case 1: mediaItem matches, but explicit fileSizeBytes contradicts
    await expect(
      evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
        mediaItem: tempItem,
        fileSizeBytes: 99999,
      }),
    ).rejects.toThrow(/explicit fileSizeBytes \(99999\) contradicts/i);

    // Case 2: explicit fileSizeBytes matches, but mediaItem contradicts
    photo.sizeBytes = 88888;
    const tempItem2 = mediaManager.register(photo);
    await expect(
      evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
        mediaItem: tempItem2,
        fileSizeBytes: exactSlot1Bytes,
      }),
    ).rejects.toThrow(/mediaItem\.sizeBytes \(88888\) contradicts/i);

    // Assert zero persistence
    const allEvidence = await db.get('evidence').query().fetch();
    expect(allEvidence.length).toBe(0);
    const pendingOps = await queue.getPendingOperations();
    expect(pendingOps.length).toBe(0);
  });

  it('rejects capture if physical file size exceeds maximum allowed limit (15MB)', async () => {
    const { photo } = createTestPhotoFile('oversized.jpg', 100);
    const tempItem = mediaManager.register(photo);

    // Mock inspectMediaFile to simulate a file exceeding 15MB
    const inspectSpy = vi.spyOn(evidenceRepo, 'inspectMediaFile').mockResolvedValueOnce({
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sizeBytes: 16 * 1024 * 1024, // 16MB
    });

    await expect(
      evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
        mediaItem: tempItem,
      }),
    ).rejects.toThrow(/exceeds maximum allowed limit of 15MB/i);

    inspectSpy.mockRestore();

    const allEvidence = await db.get('evidence').query().fetch();
    expect(allEvidence.length).toBe(0);
    const pendingOps = await queue.getPendingOperations();
    expect(pendingOps.length).toBe(0);
  });
});

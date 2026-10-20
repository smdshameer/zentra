/**
 * ZENTRA Field — Field Evidence & Direct S3 Pipeline Unit Test Suite (Phase 14)
 * apps/field/test/field-evidence.spec.ts
 *
 * Verifies mobile-side Evidence Pipeline & Direct S3 Streaming:
 * - Queueing captured evidence from TemporaryMediaManager into WatermelonDB
 * - Preserving SHA-256 checksum and metadata without base64 binary leakage
 * - Direct S3 streaming mock upload with session creation and atomic finalization
 * - Purging local temporary media upon confirmed finalization
 * - Exponential retry tracking on network/S3 upload failures
 * - App restart recovery of pending and failed uploads
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
import type { EvidenceUploadSession } from '@zentra/types';

describe('Phase 14 — Mobile Field Evidence & Direct S3 Streaming', () => {
  let db: Database;
  let evidenceRepo: FieldEvidenceRepository;
  let mediaManager: TemporaryMediaManager;
  let queue: OperationQueue;

  const testVisitId = '01a13ac8-6cdc-778c-8593-000000000001';
  const testCaseId = '01a126f6-7d9a-7dfa-96bb-000000000001';

  const testTmpDir = path.join(os.tmpdir(), 'zentra_field_evidence_test_' + process.pid);
  if (!fs.existsSync(testTmpDir)) {
    fs.mkdirSync(testTmpDir, { recursive: true });
  }

  beforeEach(async () => {
    db = createAppDatabase({ inMemory: true, dbName: 'test_field_evidence_' + Date.now() });
    mediaManager = new TemporaryMediaManager();
    evidenceRepo = new FieldEvidenceRepository(db, mediaManager);
    queue = new OperationQueue(db);

    // Seed parent service case and field visit
    await db.write(async () => {
      await db.get('service_cases').create((rec: any) => {
        rec.serverId = testCaseId;
        rec.sourceComplaintId = 'src-01';
        rec.zentraCaseCode = 'ZNT-2026-EV-001';
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

  describe('1. Evidence Capture & Offline Queueing', () => {
    it('captures photo reference from TemporaryMediaManager and stores queued record in WatermelonDB', async () => {
      const photo = createDummyPhoto('hm_signature.png');
      const tempItem = mediaManager.register(photo);

      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
        evidenceType: 'SIGNATURE',
        mediaItem: tempItem,
        gps: {
          latitude: 11.4501,
          longitude: 77.6822,
          accuracyMeters: 8.5,
        },
      });

      expect(evidence.id).toBeDefined();
      expect(evidence.visitId).toBe(testVisitId);
      expect(evidence.serviceCaseId).toBe(testCaseId);
      expect(evidence.evidenceSlot).toBe('SLOT_1_HM_SIGNED_REPORT');
      expect(evidence.evidenceType).toBe('SIGNATURE');
      expect(evidence.uploadStatus).toBe('QUEUED');
      expect(evidence.syncState).toBe('LOCAL_ONLY');
      expect(evidence.fileChecksumSha256).toHaveLength(64);
      expect(evidence.gpsLatitude).toBe(11.4501);
      expect(evidence.gpsLongitude).toBe(77.6822);

      // Verify Operation Queue does NOT store raw binary or base64 image data
      const queuedOps = await queue.getPendingOperations();
      const evidenceOp = queuedOps.find(
        (op) => op.entityType === 'evidence_files' && op.localEntityId === evidence.id,
      );
      expect(evidenceOp).toBeDefined();
      expect(evidenceOp?.operationType).toBe('INSERT');

      const payload = JSON.parse(evidenceOp!.payloadJson);
      expect(payload.evidenceSlot).toBe('SLOT_1_HM_SIGNED_REPORT');
      expect(payload.fileChecksumSha256).toBe(evidence.fileChecksumSha256);
      expect(payload.fileSizeBytes).toBe(tempItem.sizeBytes);
      // Zero base64 payload
      expect(payload.base64).toBeUndefined();
      expect(payload.dataUri).toBeUndefined();
      expect(payload.binary).toBeUndefined();
    });

    it('retrieves evidence by slot for a visit', async () => {
      const photo = createDummyPhoto('equip_working.jpg');
      const tempItem = mediaManager.register(photo);

      await evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      const found = await evidenceRepo.getEvidenceForSlot(
        testVisitId,
        'SLOT_2_EQUIPMENT_WORKING_PHOTO',
      );
      expect(found).not.toBeNull();
      expect(found?.evidenceSlot).toBe('SLOT_2_EQUIPMENT_WORKING_PHOTO');

      const notFound = await evidenceRepo.getEvidenceForSlot(
        testVisitId,
        'PARTS_SPARES_PHOTO',
      );
      expect(notFound).toBeNull();
    });
  });

  describe('2. Direct S3 Streaming Upload & Server Finalization', () => {
    it('streams binary directly to S3 URL, finalizes on server, and purges temporary media', async () => {
      const photo = createDummyPhoto('completion.jpg');
      const tempItem = mediaManager.register(photo);

      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      expect(mediaManager.get(tempItem.id)).toBeDefined();

      let requestedSession = false;
      let streamedDirectlyToS3 = false;
      let finalizedOnServer = false;

      const mockSession: EvidenceUploadSession = {
        evidenceId: 'srv-evidence-001',
        uploadSessionId: 'sess-001',
        presignedUploadUrl: 'https://zentra-evidence-test.s3.ap-south-1.amazonaws.com/cases/upload',
        storagePath: `cases/${testCaseId}/visits/${testVisitId}/evidence_comp.jpg`,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        maxFileSizeBytes: 1024 * 1024 * 25,
        expectedChecksumSha256: evidence.fileChecksumSha256,
      };

      const mockFetch = async (url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const urlStr = url.toString();
        if (urlStr.includes('/evidence/upload-session')) {
          requestedSession = true;
          return {
            ok: true,
            status: 201,
            json: async () => ({
              success: true,
              data: mockSession,
            }),
          } as Response;
        }

        if (urlStr.includes('/finalize')) {
          finalizedOnServer = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                evidenceId: 'srv-evidence-001',
                uploadStatus: 'FINALIZED',
              },
            }),
          } as Response;
        }

        return { ok: false, status: 404, json: async () => ({}) } as Response;
      };

      const result = await evidenceRepo.executeDirectUpload(evidence.id, {
        apiBaseUrl: 'http://localhost:3000',
        authToken: 'test-jwt',
        fetchFn: mockFetch as any,
        uploader: async (presignedUrl, localUri, mimeType) => {
          streamedDirectlyToS3 = true;
          expect(presignedUrl).toBe(mockSession.presignedUploadUrl);
          expect(localUri).toBe(tempItem.localUri);
          expect(mimeType).toBe('image/jpeg');
          return true;
        },
      });

      expect(result.status).toBe('FINALIZED');
      expect(result.serverEvidenceId).toBe('srv-evidence-001');
      expect(requestedSession).toBe(true);
      expect(streamedDirectlyToS3).toBe(true);
      expect(finalizedOnServer).toBe(true);

      // Verify local record is updated to FINALIZED and SYNCED
      const updatedEvidence = await evidenceRepo.getEvidenceForSlot(
        testVisitId,
        'SLOT_2_EQUIPMENT_WORKING_PHOTO',
      );
      expect(updatedEvidence?.uploadStatus).toBe('FINALIZED');
      expect(updatedEvidence?.syncState).toBe('SYNCED');
      expect(updatedEvidence?.storagePath).toBe(mockSession.storagePath);
      expect(updatedEvidence?.uploadedAt).toBeDefined();

      // Verify temporary media item was purged to reclaim mobile disk space
      expect(mediaManager.get(tempItem.id)).toBeUndefined();
    });

    it('streams true binary bytes (not URI string) to S3 via default fetch PUT when options.uploader is omitted', async () => {
      const rawImageBytes = Buffer.from('GENUINE_BINARY_JPEG_IMAGE_PAYLOAD_EVIDENCE_1234567890');
      const photo = createDummyPhoto('default_upload_binary.jpg');
      // Overwrite dummy photo with known content
      let filePath = photo.localUri;
      if (filePath.startsWith('file://')) {
        filePath = new URL(photo.localUri).pathname;
        if (process.platform === 'win32' && filePath.startsWith('/')) {
          filePath = filePath.slice(1);
        }
      }
      fs.writeFileSync(filePath, rawImageBytes);
      photo.sizeBytes = rawImageBytes.byteLength;

      const tempItem = mediaManager.register(photo);

      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      const mockSession: EvidenceUploadSession = {
        evidenceId: 'srv-evidence-binary-001',
        uploadSessionId: 'sess-bin-001',
        presignedUploadUrl: 'https://zentra-evidence-test.s3.ap-south-1.amazonaws.com/cases/binary.jpg',
        storagePath: `cases/${testCaseId}/visits/${testVisitId}/binary.jpg`,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        maxFileSizeBytes: 1024 * 1024 * 25,
        expectedChecksumSha256: evidence.fileChecksumSha256,
      };

      let putRequestCalled = false;
      let capturedPutBody: any = null;
      let capturedPutHeaders: Record<string, string> = {};

      const mockFetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = url.toString();
        if (urlStr.includes('/upload-session')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              success: true,
              data: mockSession,
            }),
          } as Response;
        }

        if (urlStr.includes('zentra-evidence-test.s3.ap-south-1.amazonaws.com')) {
          putRequestCalled = true;
          capturedPutBody = init?.body;
          capturedPutHeaders = (init?.headers as Record<string, string>) || {};
          return {
            ok: true,
            status: 200,
          } as Response;
        }

        if (urlStr.includes('/finalize')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                evidenceId: 'srv-evidence-binary-001',
                uploadStatus: 'FINALIZED',
              },
            }),
          } as Response;
        }

        return { ok: false, status: 404 } as Response;
      };

      // Call executeDirectUpload WITHOUT options.uploader
      const result = await evidenceRepo.executeDirectUpload(evidence.id, {
        apiBaseUrl: 'http://localhost:3000',
        authToken: 'test-jwt',
        fetchFn: mockFetch as any,
      });

      expect(result.status).toBe('FINALIZED');
      expect(result.serverEvidenceId).toBe('srv-evidence-binary-001');
      expect(putRequestCalled).toBe(true);

      // Verify that the PUT body is a real binary Blob
      expect(capturedPutBody).toBeInstanceOf(Blob);
      const putBlob = capturedPutBody as Blob;
      expect(putBlob.size).toBe(rawImageBytes.byteLength);

      // Verify content is actual binary bytes and NOT the URI string
      const arrayBuffer = await putBlob.arrayBuffer();
      const receivedBuffer = Buffer.from(arrayBuffer);
      expect(receivedBuffer.equals(rawImageBytes)).toBe(true);

      // Explicit negative assertion: Body does NOT equal the localFileUri string
      expect(receivedBuffer.toString('utf8')).not.toBe(evidence.localFileUri);
      expect(receivedBuffer.length).not.toBe(evidence.localFileUri.length);

      // Verify checksum of received payload matches expected SHA-256
      const receivedSha256 = crypto.createHash('sha256').update(receivedBuffer).digest('hex');
      expect(receivedSha256).toBe(evidence.fileChecksumSha256);

      // Verify MIME type header preserved
      expect(capturedPutHeaders['Content-Type']).toBe('image/jpeg');

      // Verify DB record status finalized and temp media purged
      const updatedEvidence = await evidenceRepo.findById(evidence.id);
      expect(updatedEvidence?.uploadStatus).toBe('FINALIZED');
      expect(updatedEvidence?.syncState).toBe('SYNCED');
      expect(mediaManager.get(tempItem.id)).toBeUndefined();
    });

    it('fails closed and does NOT issue PUT request when evidence file is missing from disk', async () => {
      const photo = createDummyPhoto('missing_file.jpg');
      const tempItem = mediaManager.register(photo);

      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'DIAGNOSTIC_PHOTO',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      // Delete the file from disk to simulate missing file
      let localPath = photo.localUri;
      if (localPath.startsWith('file://')) {
        localPath = new URL(localPath).pathname;
        if (process.platform === 'win32' && localPath.startsWith('/')) {
          localPath = localPath.slice(1);
        }
      }
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
      }

      let putRequestCalled = false;
      const mockFetch = async (url: RequestInfo | URL): Promise<Response> => {
        const urlStr = url.toString();
        if (urlStr.includes('/upload-session')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              success: true,
              data: {
                evidenceId: 'srv-missing',
                uploadSessionId: 'sess-missing',
                presignedUploadUrl: 'https://zentra-evidence-test.s3.ap-south-1.amazonaws.com/missing.jpg',
                storagePath: 'missing.jpg',
                expiresAt: new Date(Date.now() + 900000).toISOString(),
                maxFileSizeBytes: 1024 * 1024,
                expectedChecksumSha256: 'abc',
              },
            }),
          } as Response;
        }

        if (urlStr.includes('zentra-evidence-test.s3.ap-south-1.amazonaws.com')) {
          putRequestCalled = true;
          return { ok: true, status: 200 } as Response;
        }

        return { ok: false, status: 404 } as Response;
      };

      const result = await evidenceRepo.executeDirectUpload(evidence.id, {
        apiBaseUrl: 'http://localhost:3000',
        authToken: 'test-jwt',
        fetchFn: mockFetch as any,
      });

      expect(result.status).toBe('UPLOAD_FAILED');
      expect(result.error).toContain('not found at local URI');
      expect(putRequestCalled).toBe(false);

      const failedRecord = await evidenceRepo.findById(evidence.id);
      expect(failedRecord?.uploadStatus).toBe('UPLOAD_FAILED');
      expect(failedRecord?.retryCount).toBe(1);
    });

    it('fails closed and does NOT issue PUT request when evidence file is empty (0 bytes)', async () => {
      const photo = createDummyPhoto('empty_file.jpg');
      const tempItem = mediaManager.register(photo);

      // Capture evidence with normal content first
      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'DIAGNOSTIC_PHOTO',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      // Truncate file to 0 bytes
      let localPath = photo.localUri;
      if (localPath.startsWith('file://')) {
        localPath = new URL(localPath).pathname;
        if (process.platform === 'win32' && localPath.startsWith('/')) {
          localPath = localPath.slice(1);
        }
      }
      fs.writeFileSync(localPath, Buffer.alloc(0));

      let putRequestCalled = false;
      const mockFetch = async (url: RequestInfo | URL): Promise<Response> => {
        const urlStr = url.toString();
        if (urlStr.includes('/upload-session')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              success: true,
              data: {
                evidenceId: 'srv-empty',
                uploadSessionId: 'sess-empty',
                presignedUploadUrl: 'https://zentra-evidence-test.s3.ap-south-1.amazonaws.com/empty.jpg',
                storagePath: 'empty.jpg',
                expiresAt: new Date(Date.now() + 900000).toISOString(),
                maxFileSizeBytes: 1024 * 1024,
                expectedChecksumSha256: 'abc',
              },
            }),
          } as Response;
        }

        if (urlStr.includes('zentra-evidence-test.s3.ap-south-1.amazonaws.com')) {
          putRequestCalled = true;
          return { ok: true, status: 200 } as Response;
        }

        return { ok: false, status: 404 } as Response;
      };

      const result = await evidenceRepo.executeDirectUpload(evidence.id, {
        apiBaseUrl: 'http://localhost:3000',
        authToken: 'test-jwt',
        fetchFn: mockFetch as any,
      });

      expect(result.status).toBe('UPLOAD_FAILED');
      expect(result.error).toContain('is empty (0 bytes)');
      expect(putRequestCalled).toBe(false);

      const failedRecord = await evidenceRepo.findById(evidence.id);
      expect(failedRecord?.uploadStatus).toBe('UPLOAD_FAILED');
      expect(failedRecord?.retryCount).toBe(1);
    });

    it('rejects upload before PUT transfer if file size on disk does not match recorded metadata', async () => {
      const originalBytes = Buffer.from('EXACT_100_BYTES_PAYLOAD_PADDING_FOR_FILE_SIZE_VALIDATION_TEST_1234567890_PADDING_MORE_AND_MORE_CHARS_99');
      const photo = createDummyPhoto('size_mismatch.jpg');
      let localPath = photo.localUri;
      if (localPath.startsWith('file://')) {
        localPath = new URL(localPath).pathname;
        if (process.platform === 'win32' && localPath.startsWith('/')) {
          localPath = localPath.slice(1);
        }
      }
      fs.writeFileSync(localPath, originalBytes);
      photo.sizeBytes = originalBytes.byteLength;

      const tempItem = mediaManager.register(photo);

      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'DIAGNOSTIC_PHOTO',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      // Now alter file on disk to have different byte length
      fs.writeFileSync(localPath, Buffer.from('SHORT_CHANGED_CONTENT'));

      let putRequestCalled = false;
      const mockFetch = async (url: RequestInfo | URL): Promise<Response> => {
        const urlStr = url.toString();
        if (urlStr.includes('/upload-session')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              success: true,
              data: {
                evidenceId: 'srv-size-mismatch',
                uploadSessionId: 'sess-size',
                presignedUploadUrl: 'https://zentra-evidence-test.s3.ap-south-1.amazonaws.com/size.jpg',
                storagePath: 'size.jpg',
                expiresAt: new Date(Date.now() + 900000).toISOString(),
                maxFileSizeBytes: 1024 * 1024,
                expectedChecksumSha256: 'abc',
              },
            }),
          } as Response;
        }

        if (urlStr.includes('zentra-evidence-test.s3.ap-south-1.amazonaws.com')) {
          putRequestCalled = true;
          return { ok: true, status: 200 } as Response;
        }

        return { ok: false, status: 404 } as Response;
      };

      const result = await evidenceRepo.executeDirectUpload(evidence.id, {
        apiBaseUrl: 'http://localhost:3000',
        authToken: 'test-jwt',
        fetchFn: mockFetch as any,
      });

      expect(result.status).toBe('UPLOAD_FAILED');
      expect(result.error).toContain('Evidence file size mismatch');
      expect(putRequestCalled).toBe(false);

      const failedRecord = await evidenceRepo.findById(evidence.id);
      expect(failedRecord?.uploadStatus).toBe('UPLOAD_FAILED');
      expect(failedRecord?.retryCount).toBe(1);
    });

    it('tracks retry count and marks UPLOAD_FAILED when direct S3 stream fails', async () => {
      const photo = createDummyPhoto('spares.jpg');
      const tempItem = mediaManager.register(photo);

      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'PARTS_SPARES_PHOTO',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      const mockSession: EvidenceUploadSession = {
        evidenceId: 'srv-evidence-002',
        uploadSessionId: 'sess-002',
        presignedUploadUrl: 'https://zentra-evidence-test.s3.ap-south-1.amazonaws.com/fail',
        storagePath: `cases/${testCaseId}/visits/${testVisitId}/spares.jpg`,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        maxFileSizeBytes: 1024 * 1024 * 25,
        expectedChecksumSha256: evidence.fileChecksumSha256,
      };

      const mockFetch = async (_url: RequestInfo | URL): Promise<Response> => {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: mockSession,
          }),
        } as Response;
      };

      const result = await evidenceRepo.executeDirectUpload(evidence.id, {
        apiBaseUrl: 'http://localhost:3000',
        authToken: 'test-jwt',
        fetchFn: mockFetch as any,
        uploader: async () => {
          // Simulate network failure during binary PUT
          return false;
        },
      });

      expect(result.status).toBe('UPLOAD_FAILED');
      expect(result.error).toContain('Direct S3 upload PUT transfer failed');

      const failedRecord = await evidenceRepo.getEvidenceForSlot(
        testVisitId,
        'PARTS_SPARES_PHOTO',
      );
      expect(failedRecord?.uploadStatus).toBe('UPLOAD_FAILED');
      expect(failedRecord?.retryCount).toBe(1);
      expect(failedRecord?.lastError).toContain('Direct S3 upload PUT transfer failed');
      // Temporary media item is NOT purged so it can be retried
      expect(mediaManager.get(tempItem.id)).toBeDefined();
    });
  });

  describe('3. Offline Queue Recovery & Batch Processing', () => {
    it('recovers pending and failed uploads on app restart', async () => {
      const photo1 = createDummyPhoto('diag_1.jpg');
      const item1 = mediaManager.register(photo1);
      const photo2 = createDummyPhoto('diag_2.jpg');
      const item2 = mediaManager.register(photo2);

      await evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'DIAGNOSTIC_PHOTO',
        mediaItem: item1,
      });

      const second = await evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'OTHER_ATTACHMENT',
        mediaItem: item2,
      });

      // Mark second as failed
      await evidenceRepo.markUploadFailed(second.id, 'Connection reset by peer');

      // Query pending uploads across the app
      const pendingList = await evidenceRepo.getPendingUploads();
      expect(pendingList).toHaveLength(2);
      expect(pendingList.map((e) => e.uploadStatus)).toEqual(
        expect.arrayContaining(['QUEUED', 'UPLOAD_FAILED']),
      );
    });

    it('processes all pending uploads in batch with retryPendingUploads', async () => {
      const photo = createDummyPhoto('serial.jpg');
      const item = mediaManager.register(photo);

      await evidenceRepo.captureAndQueueEvidence({
        visitId: testVisitId,
        serviceCaseId: testCaseId,
        evidenceSlot: 'SERIAL_NUMBER_PHOTO',
        mediaItem: item,
      });

      let uploadCount = 0;
      const mockFetch = async (url: RequestInfo | URL): Promise<Response> => {
        const urlStr = url.toString();
        if (urlStr.includes('/upload-session')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              success: true,
              data: {
                evidenceId: 'srv-evidence-003',
                uploadSessionId: 'sess-003',
                presignedUploadUrl: 'https://zentra-evidence-test.s3.ap-south-1.amazonaws.com/serial',
                storagePath: 'serial.jpg',
                expiresAt: new Date(Date.now() + 900000).toISOString(),
                maxFileSizeBytes: 1024 * 1024,
                expectedChecksumSha256: 'a'.repeat(64),
              },
            }),
          } as Response;
        }

        if (urlStr.includes('/finalize')) {
          uploadCount++;
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true }),
          } as Response;
        }

        return { ok: false, status: 404 } as any;
      };

      const result = await evidenceRepo.retryPendingUploads({
        apiBaseUrl: 'http://localhost:3000',
        authToken: 'test-jwt',
        fetchFn: mockFetch as any,
        uploader: async () => true,
      });

      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
      expect(uploadCount).toBe(1);

      // Pending queue should now be empty
      const remainingPending = await evidenceRepo.getPendingUploads();
      expect(remainingPending).toHaveLength(0);
    });
  });
});

/**
 * ZENTRA Field — Platform File Reader & Evidence Regression Test Suite
 * apps/field/test/file-reader.spec.ts
 *
 * Verifies:
 * - Missing, null, or empty URI fails closed
 * - Unreadable or non-existent file URI fails closed
 * - Zero-byte (empty) file fails closed
 * - Binary file reading returns exact Uint8Array byte sequence
 * - Cryptographic SHA-256 computation over actual file bytes
 * - Upload byte equality and payload integrity
 * - File-size mismatch rejection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { readLocalFileBytes } from '../src/domain/repositories/file-reader';
import { FieldEvidenceRepository } from '../src/domain/repositories/evidence.repository';
import { TemporaryMediaManager } from '../src/hardware/camera/temporary-media-manager';
import { createAppDatabase } from '../src/database/database';
import type { Database } from '@nozbe/watermelondb';
import type { CapturedPhoto } from '../src/hardware/camera/camera.types';

describe('Platform File Reader & Evidence Integrity (Regression Suite)', () => {
  let db: Database;
  let mediaManager: TemporaryMediaManager;
  let evidenceRepo: FieldEvidenceRepository;
  const testTmpDir = path.join(os.tmpdir(), 'zentra_file_reader_test_' + process.pid);

  beforeEach(() => {
    if (!fs.existsSync(testTmpDir)) {
      fs.mkdirSync(testTmpDir, { recursive: true });
    }
    db = createAppDatabase({ inMemory: true, dbName: 'test_file_reader_' + Date.now() });
    mediaManager = new TemporaryMediaManager();
    evidenceRepo = new FieldEvidenceRepository(db, mediaManager);
  });

  afterEach(() => {
    if (fs.existsSync(testTmpDir)) {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    }
  });

  const createTestFile = (filename: string, content: Buffer | string): string => {
    const filePath = path.join(testTmpDir, filename);
    fs.writeFileSync(filePath, content);
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
  };

  describe('1. Platform File Reader Fail-Closed Boundary Checks', () => {
    it('fails closed when localUri is empty string', async () => {
      await expect(readLocalFileBytes('')).rejects.toThrow(
        'Cannot read file: local URI is missing or empty',
      );
    });

    it('fails closed when localUri is only whitespace', async () => {
      await expect(readLocalFileBytes('   ')).rejects.toThrow(
        'Cannot read file: local URI is missing or empty',
      );
    });

    it('fails closed when file does not exist on disk (unreadable URI)', async () => {
      const missingUri = 'file:///path/to/completely/nonexistent_file_12345.jpg';
      await expect(readLocalFileBytes(missingUri)).rejects.toThrow(
        'Evidence file not found at local URI',
      );
    });

    it('fails closed when file exists but is 0 bytes (empty data)', async () => {
      const emptyUri = createTestFile('empty_sample.bin', Buffer.alloc(0));
      await expect(readLocalFileBytes(emptyUri)).rejects.toThrow(
        'is empty (0 bytes)',
      );
    });

    it('reads exact physical binary bytes from disk into Uint8Array', async () => {
      const rawPayload = Buffer.from('ZENTRA_PHYSICAL_BINARY_PAYLOAD_TEST_DATA_9876543210');
      const validUri = createTestFile('valid_payload.bin', rawPayload);

      const bytes = await readLocalFileBytes(validUri);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.byteLength).toBe(rawPayload.byteLength);
      expect(Buffer.from(bytes).equals(rawPayload)).toBe(true);
    });
  });

  describe('2. SHA-256 Checksum Correctness & Web Crypto Integrity', () => {
    it('computes exact cryptographic SHA-256 hex digest matching Node crypto', async () => {
      const rawContent = Buffer.from('ZENTRA_EVIDENCE_IMAGE_SAMPLE_BYTES_FOR_SHA256_VERIFICATION');
      const fileUri = createTestFile('evidence_photo.jpg', rawContent);

      const photo: CapturedPhoto = {
        localUri: fileUri,
        mimeType: 'image/jpeg',
        width: 1920,
        height: 1080,
        aspectRatio: '16:9',
        sizeBytes: rawContent.byteLength,
        capturedAt: new Date().toISOString(),
        facing: 'back',
        isTemporary: true,
      };
      const tempItem = mediaManager.register(photo);

      const computedHash = await evidenceRepo.computeChecksum(tempItem);
      const expectedHash = crypto.createHash('sha256').update(rawContent).digest('hex');

      expect(computedHash).toHaveLength(64);
      expect(computedHash).toBe(expectedHash);
    });

    it('fails closed when computing checksum on missing or unreadable file', async () => {
      const photo: CapturedPhoto = {
        localUri: 'file:///path/to/missing_checksum_target.jpg',
        mimeType: 'image/jpeg',
        width: 1920,
        height: 1080,
        aspectRatio: '16:9',
        sizeBytes: 1000,
        capturedAt: new Date().toISOString(),
        facing: 'back',
        isTemporary: true,
      };
      const tempItem = mediaManager.register(photo);

      await expect(evidenceRepo.computeChecksum(tempItem)).rejects.toThrow(
        'Evidence file not found at local URI',
      );
    });
  });

  describe('3. Upload Byte Equality & File-Size Mismatch Rejection', () => {
    const parentCaseServerId = '01a126f6-7d9a-7dfa-96bb-000000000099';
    const parentVisitServerId = '01a126f6-7d9a-7dfa-96bb-000000000088';

    const seedParentRecords = async () => {
      await db.write(async () => {
        await db.get('service_cases').create((rec: any) => {
          rec.serverId = parentCaseServerId;
          rec.zentraCaseCode = 'ZNT-TEST-001';
          rec.schoolId = 'sch-1';
          rec.labId = 'lab-1';
          rec.status = 'ASSIGNED';
          rec.priority = 'NORMAL';
          rec.assignedEngineerId = '01a126f6-7d9a-7dfa-96bb-000000000001';
          rec.syncState = 'LOCAL_ONLY';
          rec.isDeleted = false;
        });
        await db.get('field_visits').create((rec: any) => {
          rec.serverId = parentVisitServerId;
          rec.serviceCaseId = parentCaseServerId;
          rec.engineerId = '01a126f6-7d9a-7dfa-96bb-000000000001';
          rec.visitDate = '2026-10-18';
          rec.status = 'PLANNED';
          rec.syncState = 'LOCAL_ONLY';
          rec.isDeleted = false;
        });
      });
    };

    it('rejects direct upload when file size on disk does not match recorded metadata', async () => {
      await seedParentRecords();
      const initialBytes = crypto.randomBytes(500);
      const fileUri = createTestFile('mismatched_photo.jpg', initialBytes);

      const photo: CapturedPhoto = {
        localUri: fileUri,
        mimeType: 'image/jpeg',
        width: 1920,
        height: 1080,
        aspectRatio: '16:9',
        sizeBytes: 500,
        capturedAt: new Date().toISOString(),
        facing: 'back',
        isTemporary: true,
      };
      const tempItem = mediaManager.register(photo);

      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: parentVisitServerId,
        serviceCaseId: parentCaseServerId,
        evidenceSlot: 'SLOT_1_HM_SIGNED_REPORT',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      // Alter file on disk after capture to simulate disk corruption or alteration prior to upload
      const alteredBytes = Buffer.from('TEN_BYTES!');
      fs.writeFileSync(path.join(testTmpDir, 'mismatched_photo.jpg'), alteredBytes);

      let putCalled = false;
      const mockFetch = async (url: RequestInfo | URL): Promise<Response> => {
        const urlStr = url.toString();
        if (urlStr.includes('/upload-session')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              success: true,
              data: {
                evidenceId: 'srv-mismatch',
                uploadSessionId: 'sess-mismatch',
                presignedUploadUrl: 'https://s3.example.com/mismatch.jpg',
                storagePath: 'mismatch.jpg',
                expiresAt: new Date(Date.now() + 900000).toISOString(),
                maxFileSizeBytes: 1024 * 1024,
                expectedChecksumSha256: evidence.fileChecksumSha256,
              },
            }),
          } as Response;
        }
        if (urlStr.includes('s3.example.com')) {
          putCalled = true;
          return { ok: true, status: 200 } as Response;
        }
        return { ok: false, status: 404 } as Response;
      };

      const result = await evidenceRepo.executeDirectUpload(evidence.id, {
        apiBaseUrl: 'http://localhost:3000',
        authToken: 'test-token',
        fetchFn: mockFetch as any,
      });

      expect(result.status).toBe('UPLOAD_FAILED');
      expect(result.error).toContain('Evidence file size mismatch: expected 500 bytes, but read 10 bytes');
      expect(putCalled).toBe(false);
    });

    it('verifies upload payload bytes are identical to disk bytes without mutation', async () => {
      await seedParentRecords();
      const payloadBytes = Buffer.from('BINARY_IMAGE_DATA_BYTES_VERIFYING_ZERO_BASE64_MUTATION');
      const fileUri = createTestFile('exact_photo.jpg', payloadBytes);

      const photo: CapturedPhoto = {
        localUri: fileUri,
        mimeType: 'image/jpeg',
        width: 1920,
        height: 1080,
        aspectRatio: '16:9',
        sizeBytes: payloadBytes.byteLength,
        capturedAt: new Date().toISOString(),
        facing: 'back',
        isTemporary: true,
      };
      const tempItem = mediaManager.register(photo);

      const evidence = await evidenceRepo.captureAndQueueEvidence({
        visitId: parentVisitServerId,
        serviceCaseId: parentCaseServerId,
        evidenceSlot: 'SLOT_2_EQUIPMENT_WORKING_PHOTO',
        evidenceType: 'PHOTO',
        mediaItem: tempItem,
      });

      let capturedPutBlob: Blob | null = null;
      const mockFetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = url.toString();
        if (urlStr.includes('/upload-session')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              success: true,
              data: {
                evidenceId: 'srv-exact',
                uploadSessionId: 'sess-exact',
                presignedUploadUrl: 'https://s3.example.com/exact.jpg',
                storagePath: 'exact.jpg',
                expiresAt: new Date(Date.now() + 900000).toISOString(),
                maxFileSizeBytes: 1024 * 1024,
                expectedChecksumSha256: evidence.fileChecksumSha256,
              },
            }),
          } as Response;
        }
        if (urlStr.includes('s3.example.com')) {
          capturedPutBlob = init?.body as Blob;
          return { ok: true, status: 200 } as Response;
        }
        if (urlStr.includes('/finalize')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { evidenceId: 'srv-exact', uploadStatus: 'FINALIZED' },
            }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      };

      const result = await evidenceRepo.executeDirectUpload(evidence.id, {
        apiBaseUrl: 'http://localhost:3000',
        authToken: 'test-token',
        fetchFn: mockFetch as any,
      });

      expect(result.status).toBe('FINALIZED');
      expect(capturedPutBlob).not.toBeNull();
      const arrayBuffer = await capturedPutBlob!.arrayBuffer();
      const receivedBuffer = Buffer.from(arrayBuffer);
      expect(receivedBuffer.equals(payloadBytes)).toBe(true);
    });
  });
});

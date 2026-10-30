import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'stream';
import { ObjectStorageService } from '../src/modules/evidence/services/object-storage.service';

describe('ObjectStorageService — AWS SDK Presigner Integration Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Presigned Upload (PUT) URL Generation with AWS SDK', () => {
    it('generates standard AWS SigV4 query-authenticated PUT URL with virtual-host style', async () => {
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      process.env.S3_BUCKET_NAME = 'zentra-staging-evidence';
      process.env.S3_REGION = 'ap-south-1';
      process.env.S3_ACCESS_KEY = 'AKIA_STAGING_TEST_KEY_ID';
      process.env.S3_SECRET_KEY = 'SEC_STAGING_TEST_SECRET_KEY_CHARS';
      delete process.env.S3_ENDPOINT;
      delete process.env.S3_FORCE_PATH_STYLE;

      const storage = new ObjectStorageService();
      const result = await storage.generatePresignedUploadUrl({
        environment: 'staging',
        serviceCaseId: '01912345-0000-7000-8000-000000000001',
        visitId: '01912345-0000-7000-8000-000000000002',
        evidenceId: '01912345-0000-7000-8000-000000000003',
        filename: 'panel_photo.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 2048,
        expectedChecksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        expiresInSeconds: 600,
      });

      expect(result.uploadSessionId).toBeDefined();
      expect(result.objectKey).toBe('evidence/staging/01912345-0000-7000-8000-000000000001/01912345-0000-7000-8000-000000000002/01912345-0000-7000-8000-000000000003/panel_photo.jpg');

      const url = new URL(result.presignedUrl);
      expect(url.hostname).toBe('zentra-staging-evidence.s3.ap-south-1.amazonaws.com');
      expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(url.searchParams.get('X-Amz-Credential')).toContain('AKIA_STAGING_TEST_KEY_ID');
      expect(url.searchParams.get('X-Amz-Credential')).toContain('/ap-south-1/s3/aws4_request');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates path-style URL when S3_FORCE_PATH_STYLE=true and custom S3_ENDPOINT is set', async () => {
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      process.env.S3_BUCKET_NAME = 'zentra-staging-evidence';
      process.env.S3_REGION = 'auto';
      process.env.S3_ACCESS_KEY = 'R2_ACCESS_KEY_IDENTIFIER';
      process.env.S3_SECRET_KEY = 'R2_SECRET_KEY_HEX_32CHARS_LONG';
      process.env.S3_ENDPOINT = 'https://accountid123.r2.cloudflarestorage.com';
      process.env.S3_FORCE_PATH_STYLE = 'true';

      const storage = new ObjectStorageService();
      const result = await storage.generatePresignedUploadUrl({
        environment: 'staging',
        serviceCaseId: 'case-alpha',
        visitId: 'visit-beta',
        evidenceId: 'ev-gamma',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 4096,
        expectedChecksumSha256: 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
      });

      const url = new URL(result.presignedUrl);
      expect(url.hostname).toBe('accountid123.r2.cloudflarestorage.com');
      // Path-style: URL path begins with /bucket_name/object_key
      expect(url.pathname.startsWith('/zentra-staging-evidence/evidence/staging/case-alpha/visit-beta/ev-gamma/report.pdf')).toBe(true);
      expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('sanitizes filename and encodes special characters safely', async () => {
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      process.env.S3_BUCKET_NAME = 'zentra-staging-evidence';
      process.env.S3_REGION = 'ap-south-1';
      process.env.S3_ACCESS_KEY = 'AKIA_VALID_KEY';
      process.env.S3_SECRET_KEY = 'SEC_VALID_KEY_HEX_CHARS';

      const storage = new ObjectStorageService();
      const result = await storage.generatePresignedUploadUrl({
        environment: 'staging',
        serviceCaseId: '01912345-case',
        visitId: '01912345-visit',
        evidenceId: '01912345-ev',
        filename: '../../../etc/passwd.dangerous name!.png',
        mimeType: 'image/png',
        fileSizeBytes: 1024,
        expectedChecksumSha256: 'aabbccdd',
      });

      // Filename must be sanitized to strip path traversal and special characters
      expect(result.objectKey).not.toContain('..');
      expect(result.objectKey).toContain('passwd.dangerous_name_.png');
      expect(result.presignedUrl).toContain('passwd.dangerous_name_.png');
    });
  });

  describe('2. Presigned Download (GET) URL Generation with AWS SDK', () => {
    it('generates standard AWS SigV4 query-authenticated GET URL', async () => {
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      process.env.S3_BUCKET_NAME = 'zentra-staging-evidence';
      process.env.S3_REGION = 'ap-south-1';
      process.env.S3_ACCESS_KEY = 'AKIA_STAGING_TEST_KEY_ID';
      process.env.S3_SECRET_KEY = 'SEC_STAGING_TEST_SECRET_KEY_CHARS';

      const storage = new ObjectStorageService();
      const result = await storage.generatePresignedDownloadUrl({
        objectKey: 'evidence/staging/case1/visit1/ev1/photo.jpg',
        expiresInSeconds: 300,
      });

      const url = new URL(result.downloadUrl);
      expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      expect(result.expiresAt).toBeDefined();
    });
  });

  describe('3. Offline / In-Memory Mock Fallback Preservation', () => {
    it('falls back to local mock signed URL and testStorage in test environment without credentials', async () => {
      process.env.APP_ENV = 'test';
      delete process.env.S3_ACCESS_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.S3_SECRET_KEY;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      process.env.S3_BUCKET_NAME = 'zentra-evidence-test';

      const storage = new ObjectStorageService();
      expect(storage.hasTestStorage()).toBe(true);

      const presigned = await storage.generatePresignedUploadUrl({
        environment: 'dev',
        serviceCaseId: 'c1',
        visitId: 'v1',
        evidenceId: 'e1',
        filename: 'mock.jpg',
        mimeType: 'image/jpeg',
        fileSizeBytes: 512,
        expectedChecksumSha256: 'mockhash',
      });

      expect(presigned.presignedUrl).toContain('uploadSessionId=');

      // Put object into in-memory storage
      const buffer = Buffer.from('test binary content');
      const putResult = await storage.putObject(presigned.objectKey, buffer, 'image/jpeg');
      expect(putResult.objectKey).toBe(presigned.objectKey);

      // Verify integrity against in-memory storage
      const integrity = await storage.verifyObjectIntegrity(
        presigned.objectKey,
        putResult.checksumSha256,
        buffer.length,
      );
      expect(integrity.valid).toBe(true);
      expect(integrity.actualChecksum).toBe(putResult.checksumSha256);
    });

    it('returns OBJECT_NOT_FOUND when object does not exist in in-memory testStorage', async () => {
      process.env.APP_ENV = 'test';
      delete process.env.S3_ACCESS_KEY;
      delete process.env.S3_SECRET_KEY;

      const storage = new ObjectStorageService();
      const integrity = await storage.verifyObjectIntegrity(
        'evidence/dev/nonexistent/file.jpg',
        'expected_hash',
        1024,
      );

      expect(integrity.valid).toBe(false);
      expect(integrity.error).toContain('OBJECT_NOT_FOUND');
    });
  });

  describe('4. Fail-Closed Staging & Production Security Guards', () => {
    it('throws S3_FAIL_CLOSED_ERROR when credentials are missing in staging', () => {
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      delete process.env.S3_ACCESS_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.S3_SECRET_KEY;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      process.env.S3_BUCKET_NAME = 'zentra-staging-evidence';

      expect(() => new ObjectStorageService()).toThrow(/S3_FAIL_CLOSED_ERROR/);
    });

    it('throws S3_FAIL_CLOSED_ERROR when bucket is invalid/local in production', () => {
      process.env.APP_ENV = 'production';
      process.env.NODE_ENV = 'production';
      process.env.S3_ACCESS_KEY = 'AKIA_VALID_KEY';
      process.env.S3_SECRET_KEY = 'SEC_VALID_KEY';
      process.env.S3_BUCKET_NAME = 'zentra-local-evidence';

      expect(() => new ObjectStorageService()).toThrow(/S3_FAIL_CLOSED_ERROR/);
    });

    it('rejects in-memory putObject in staging even if attempted', async () => {
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      process.env.S3_ACCESS_KEY = 'AKIA_VALID_KEY';
      process.env.S3_SECRET_KEY = 'SEC_VALID_KEY';
      process.env.S3_BUCKET_NAME = 'zentra-staging-evidence';

      const storage = new ObjectStorageService();
      await expect(
        storage.putObject('key', Buffer.from('data')),
      ).rejects.toThrow(/S3_FAIL_CLOSED_ERROR/);
    });
  });

  describe('5. SEC-01: Rigorous Error Handling & HTTP 403 Access Denied Distinction', () => {
    function createStagingStorageWithMockClient() {
      process.env.APP_ENV = 'staging';
      process.env.NODE_ENV = 'production';
      process.env.S3_ACCESS_KEY = 'AKIA_STAGING_TEST_ACCESS_KEY';
      process.env.S3_SECRET_KEY = 'SEC_STAGING_TEST_SECRET_KEY_CHARS';
      process.env.S3_BUCKET_NAME = 'zentra-staging-evidence';
      process.env.S3_REGION = 'ap-south-1';

      const storage = new ObjectStorageService();
      const mockSend = vi.fn();
      (storage as any).s3Client = { send: mockSend };
      return { storage, mockSend };
    }

    it('returns null on genuine HTTP 404 / NotFound (mapped to OBJECT_NOT_FOUND)', async () => {
      const { storage, mockSend } = createStagingStorageWithMockClient();

      mockSend.mockRejectedValueOnce({
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });

      const headResult = await storage.headObject('evidence/staging/case1/visit1/ev1/photo.jpg');
      expect(headResult).toBeNull();

      // Integrity verification maps null to OBJECT_NOT_FOUND
      mockSend.mockRejectedValueOnce({
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });
      const integrity = await storage.verifyObjectIntegrity(
        'evidence/staging/case1/visit1/ev1/photo.jpg',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        1024,
      );
      expect(integrity.valid).toBe(false);
      expect(integrity.error).toContain('OBJECT_NOT_FOUND');
    });

    it('throws S3_ACCESS_DENIED on HTTP 403 without masking as OBJECT_NOT_FOUND', async () => {
      const { storage, mockSend } = createStagingStorageWithMockClient();

      mockSend.mockRejectedValueOnce({
        name: 'AccessDenied',
        message: 'Access Denied to S3 bucket',
        $metadata: { httpStatusCode: 403 },
      });

      // Must throw S3_ACCESS_DENIED, NOT return null
      await expect(
        storage.headObject('evidence/staging/case1/visit1/ev1/photo.jpg'),
      ).rejects.toThrow(/S3_ACCESS_DENIED/);

      // Verify no credentials or secret keys are leaked in the error message
      try {
        mockSend.mockRejectedValueOnce({
          name: 'AccessDenied',
          message: 'Access Denied to S3 bucket',
          $metadata: { httpStatusCode: 403 },
        });
        await storage.headObject('evidence/staging/case1/visit1/ev1/photo.jpg');
      } catch (err: any) {
        expect(err.message).not.toContain('AKIA_STAGING_TEST_ACCESS_KEY');
        expect(err.message).not.toContain('SEC_STAGING_TEST_SECRET_KEY_CHARS');
        expect(err.message).toContain('S3_ACCESS_DENIED');
      }
    });

    it('throws STORAGE_COMMUNICATION_ERROR on HTTP 500 / network failure without masking as OBJECT_NOT_FOUND', async () => {
      const { storage, mockSend } = createStagingStorageWithMockClient();

      mockSend.mockRejectedValueOnce({
        name: 'InternalError',
        message: 'S3 Internal Service Error',
        $metadata: { httpStatusCode: 500 },
      });

      await expect(
        storage.headObject('evidence/staging/case1/visit1/ev1/photo.jpg'),
      ).rejects.toThrow(/STORAGE_COMMUNICATION_ERROR/);
    });

    it('throws STORAGE_STREAM_READ_ERROR on stream interruption during SHA-256 calculation', async () => {
      const { storage, mockSend } = createStagingStorageWithMockClient();

      // HeadObject succeeds with no ChecksumSHA256 header (forcing stream fallback)
      mockSend.mockResolvedValueOnce({
        ContentLength: 2048,
        ContentType: 'image/jpeg',
        LastModified: new Date(),
      });

      // Stream emits error midway
      const faultyStream = new Readable({
        read() {
          this.destroy(new Error('Connection reset by peer'));
        },
      });

      mockSend.mockResolvedValueOnce({
        Body: faultyStream,
      });

      await expect(
        storage.headObject('evidence/staging/case1/visit1/ev1/photo.jpg'),
      ).rejects.toThrow(/STORAGE_STREAM_READ_ERROR/);
    });

    it('validates integrity directly from ChecksumSHA256 header when present', async () => {
      const { storage, mockSend } = createStagingStorageWithMockClient();

      const expectedSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const base64Sha256 = Buffer.from(expectedSha256, 'hex').toString('base64');

      mockSend.mockResolvedValueOnce({
        ContentLength: 1024,
        ContentType: 'image/jpeg',
        LastModified: new Date(),
        ChecksumSHA256: base64Sha256,
      });

      const integrity = await storage.verifyObjectIntegrity(
        'evidence/staging/case1/visit1/ev1/photo.jpg',
        expectedSha256,
        1024,
      );

      expect(integrity.valid).toBe(true);
      expect(integrity.actualChecksum).toBe(expectedSha256);
      expect(integrity.actualSizeBytes).toBe(1024);
      // Only 1 HeadObject call made; computeRemoteObjectSha256 was bypassed!
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});

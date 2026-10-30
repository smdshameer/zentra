/**
 * ZENTRA — S3 Object Storage Service (Phase 14)
 * apps/api/src/modules/evidence/services/object-storage.service.ts
 *
 * Provides S3-compatible object storage integration:
 * - Deterministic, server-controlled object key generation
 * - Path traversal prevention & filename sanitization
 * - Short-lived pre-signed upload URLs (PUT) with strict Content-Type
 * - Short-lived pre-signed download URLs (GET) with authorization
 * - Cryptographic SHA-256 upload integrity verification
 * - Environment bucket isolation & test-safety guardrails (no production writes in tests)
 * - In-memory / local test mock storage adapter for deterministic offline/unit testing
 */

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as path from 'path';
import type { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DEFAULT_PRESIGNED_EXPIRATION_SECONDS,
  DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES,
  type EvidenceMimeType,
} from '@zentra/contracts';

export interface GenerateUploadUrlParams {
  environment: string;
  serviceCaseId: string;
  visitId: string;
  evidenceId: string;
  filename: string;
  mimeType: EvidenceMimeType;
  fileSizeBytes: number;
  expectedChecksumSha256: string;
  expiresInSeconds?: number;
}

export interface PresignedUploadUrlResult {
  uploadSessionId: string;
  presignedUrl: string;
  objectKey: string;
  expiresAt: string;
  maxSizeBytes: number;
  expectedChecksumSha256: string;
}

export interface GenerateDownloadUrlParams {
  objectKey: string;
  expiresInSeconds?: number;
}

export interface PresignedDownloadUrlResult {
  downloadUrl: string;
  expiresAt: string;
}

export interface ObjectMetadata {
  objectKey: string;
  contentLength: number;
  contentType: string;
  checksumSha256: string;
  lastModified: Date;
}

export interface IntegrityCheckResult {
  valid: boolean;
  actualChecksum?: string;
  expectedChecksum: string;
  actualSizeBytes?: number;
  expectedSizeBytes: number;
  error?: string;
}

@Injectable()
export class ObjectStorageService {
  private readonly appEnv: string;
  private readonly bucketName: string;
  private readonly region: string;
  private readonly endpoint?: string;
  private readonly accessKeyId?: string;
  private readonly secretAccessKey?: string;
  private readonly forcePathStyle: boolean;
  private readonly hasIamRoleCredentials: boolean;
  private readonly isTestEnvironment: boolean;
  private readonly s3Client?: S3Client;
  private readonly logger = new Logger(ObjectStorageService.name);

  /**
   * In-memory mock storage registry for automated tests and offline development ONLY.
   *
   * LIFECYCLE & PROCESS SCOPING NOTICE (Gate 6B-7M / SEC-EVID-TEST-01):
   * This registry is an instance-local, volatile in-memory Map allocated per
   * ObjectStorageService instance in Node.js process heap memory.
   *
   * KEY ARCHITECTURAL CONSTRAINTS:
   * 1. Instance-Scoped: Each `new ObjectStorageService()` maintains its own independent
   *    in-memory map. Data stored via `putObject` on instance A is NOT visible to instance B.
   * 2. Volatile Lifecycle: Does NOT persist across Node.js process restarts, container restarts,
   *    or separate execution contexts (e.g. separate CLI / audit scripts).
   * 3. Test Contract Semantics: Successful verification (`verifyObjectIntegrity`) against this
   *    adapter proves cryptographic payload integrity and pre-finalization checks ONLY within
   *    the active process/instance lifetime. It does NOT assert or guarantee cross-process or
   *    durable cloud object availability.
   * 4. Production Boundary: In staging and production (`APP_ENV=staging|production`), this map
   *    is strictly `null` and direct in-memory storage is fail-closed prohibited.
   * 5. Persistent Storage Phase: Cross-process durable storage verification requires an S3-compatible
   *    backend (or persistent filesystem mock), deferred to future infrastructure phases.
   */
  private readonly testStorage: Map<
    string,
    { buffer: Buffer; contentType: string; checksumSha256: string; updatedAt: Date }
  > | null = null;

  constructor() {
    this.appEnv = process.env.APP_ENV || 'local';
    this.isTestEnvironment =
      this.appEnv === 'test' ||
      process.env.NODE_ENV === 'test' ||
      process.env.VITEST === 'true';

    // Support both canonical project S3_* config and standard AWS SDK AWS_* variables
    this.bucketName =
      process.env.S3_BUCKET_NAME ||
      process.env.AWS_S3_BUCKET ||
      (this.isTestEnvironment ? 'zentra-evidence-test' : 'zentra-local-evidence');

    this.region = process.env.S3_REGION || process.env.AWS_REGION || 'ap-south-1';
    this.endpoint = process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT;
    this.accessKeyId = process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
    this.secretAccessKey = process.env.S3_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    this.forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

    // Detect AWS IAM Task Role / Container Credentials (e.g. ECS Fargate)
    this.hasIamRoleCredentials = Boolean(
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
        process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
        process.env.AWS_WEB_IDENTITY_TOKEN_FILE,
    );

    const isStagingOrProd = this.appEnv === 'staging' || this.appEnv === 'production';

    const hasValidCredentials =
      (Boolean(this.accessKeyId) && Boolean(this.secretAccessKey)) ||
      this.hasIamRoleCredentials;

    if (isStagingOrProd) {
      // 1. FAIL-CLOSED GATE FOR STAGING & PRODUCTION:
      // Mandatory bucket name check: cannot be empty or dev/local default
      const isInvalidBucket =
        !this.bucketName ||
        this.bucketName === 'zentra-local-evidence' ||
        this.bucketName.includes('dev') ||
        this.bucketName.includes('local') ||
        this.bucketName.includes('mock');

      if (isInvalidBucket) {
        throw new Error(
          `S3_FAIL_CLOSED_ERROR: Mandatory S3 bucket configuration missing or invalid for environment "${this.appEnv}". Bucket: "${this.bucketName}".`,
        );
      }

      // Mandatory credentials check: must have real static keys or IAM task role
      if (!hasValidCredentials) {
        throw new Error(
          `S3_FAIL_CLOSED_ERROR: Mandatory S3 credentials missing for environment "${this.appEnv}". ` +
            `Real S3 credentials (S3_ACCESS_KEY/S3_SECRET_KEY or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY) ` +
            `or an AWS IAM task role are strictly required. Mock fallback is prohibited in staging and production.`,
        );
      }

      // In staging/production, in-memory testStorage is strictly prohibited
      this.testStorage = null;
    } else if (this.isTestEnvironment) {
      if (this.bucketName.includes('prod') && !this.bucketName.includes('test')) {
        throw new Error(
          `PRODUCTION_SAFETY_VIOLATION: Test environment cannot use production bucket "${this.bucketName}".`,
        );
      }
      this.testStorage = new Map();
    } else {
      // Local development
      this.testStorage = new Map();
    }

    if (hasValidCredentials) {
      const clientConfig: S3ClientConfig = {
        region: this.region,
        forcePathStyle: this.forcePathStyle,
      };

      if (this.endpoint) {
        clientConfig.endpoint = this.endpoint;
      }

      if (this.accessKeyId && this.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        };
      }

      this.s3Client = new S3Client(clientConfig);
    }
  }

  /**
   * Sanitizes input filename and validates file extension to prevent path traversal attacks.
   */
  sanitizeFilename(filename: string, mimeType: EvidenceMimeType): string {
    const basename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = path.extname(basename).toLowerCase();

    const allowedExtensions: Record<EvidenceMimeType, string[]> = {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'application/pdf': ['.pdf'],
    };

    const validExtensions = allowedExtensions[mimeType] || ['.jpg'];
    if (ext && validExtensions.includes(ext)) {
      return basename;
    }

    // Default fallback extension based on mimeType
    const defaultExt = validExtensions[0] || '.jpg';
    return `${basename.replace(/\.[^/.]+$/, '')}${defaultExt}`;
  }

  /**
   * Generates a deterministic, server-controlled object key.
   * Format: evidence/{environment}/{serviceCaseId}/{visitId}/{evidenceId}/{sanitizedFilename}
   */
  generateObjectKey(
    environment: string,
    serviceCaseId: string,
    visitId: string,
    evidenceId: string,
    sanitizedFilename: string,
  ): string {
    // Strictly prevent path traversal or injection
    const cleanEnv = environment.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || 'dev';
    const cleanCaseId = serviceCaseId.replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanVisitId = visitId.replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanEvidenceId = evidenceId.replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanFilename = path.basename(sanitizedFilename);

    return `evidence/${cleanEnv}/${cleanCaseId}/${cleanVisitId}/${cleanEvidenceId}/${cleanFilename}`;
  }

  /**
   * Generates a short-lived pre-signed upload URL for direct S3-compatible PUT.
   */
  async generatePresignedUploadUrl(
    params: GenerateUploadUrlParams,
  ): Promise<PresignedUploadUrlResult> {
    const uploadSessionId = crypto.randomUUID();
    const expiresInSeconds =
      params.expiresInSeconds || DEFAULT_PRESIGNED_EXPIRATION_SECONDS;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    const sanitizedFilename = this.sanitizeFilename(params.filename, params.mimeType);
    const objectKey = this.generateObjectKey(
      params.environment,
      params.serviceCaseId,
      params.visitId,
      params.evidenceId,
      sanitizedFilename,
    );

    let presignedUrl: string;

    if (this.appEnv === 'staging' || this.appEnv === 'production') {
      if (!this.s3Client) {
        throw new Error(
          `S3_FAIL_CLOSED_ERROR: Real S3 signing credentials unavailable in ${this.appEnv}. Mock signing prohibited.`,
        );
      }

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
        ContentType: params.mimeType,
      });

      presignedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresInSeconds,
      });
    } else {
      // In test/development mode:
      if (this.s3Client) {
        const command = new PutObjectCommand({
          Bucket: this.bucketName,
          Key: objectKey,
          ContentType: params.mimeType,
        });

        presignedUrl = await getSignedUrl(this.s3Client, command, {
          expiresIn: expiresInSeconds,
        });
      } else {
        // In-memory / Test Mode Mock Signed URL
        const signature = crypto
          .createHmac('sha256', 'zentra-test-signing-secret')
          .update(`PUT\n${this.bucketName}\n${objectKey}\n${expiresAt}`)
          .digest('hex');

        const baseUrl = this.endpoint || `https://${this.bucketName}.s3.${this.region}.amazonaws.com`;
        presignedUrl = `${baseUrl}/${objectKey}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=${expiresInSeconds}&X-Amz-Signature=${signature}&uploadSessionId=${uploadSessionId}`;
      }
    }

    return {
      uploadSessionId,
      presignedUrl,
      objectKey,
      expiresAt,
      maxSizeBytes: DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES,
      expectedChecksumSha256: params.expectedChecksumSha256,
    };
  }

  /**
   * Generates a short-lived pre-signed download URL for authorized viewing.
   */
  async generatePresignedDownloadUrl(
    params: GenerateDownloadUrlParams,
  ): Promise<PresignedDownloadUrlResult> {
    const expiresInSeconds =
      params.expiresInSeconds || DEFAULT_PRESIGNED_EXPIRATION_SECONDS;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    let downloadUrl: string;

    if (this.appEnv === 'staging' || this.appEnv === 'production') {
      if (!this.s3Client) {
        throw new Error(
          `S3_FAIL_CLOSED_ERROR: Real S3 signing credentials unavailable in ${this.appEnv}. Mock signing prohibited.`,
        );
      }

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: params.objectKey,
      });

      downloadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresInSeconds,
      });
    } else {
      if (this.s3Client) {
        const command = new GetObjectCommand({
          Bucket: this.bucketName,
          Key: params.objectKey,
        });

        downloadUrl = await getSignedUrl(this.s3Client, command, {
          expiresIn: expiresInSeconds,
        });
      } else {
        const signature = crypto
          .createHmac('sha256', 'zentra-test-signing-secret')
          .update(`GET\n${this.bucketName}\n${params.objectKey}\n${expiresAt}`)
          .digest('hex');

        const baseUrl = this.endpoint || `https://${this.bucketName}.s3.${this.region}.amazonaws.com`;
        downloadUrl = `${baseUrl}/${params.objectKey}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=${expiresInSeconds}&X-Amz-Signature=${signature}`;
      }
    }

    return {
      downloadUrl,
      expiresAt,
    };
  }

  /**
   * Directly stores a file buffer in the storage registry (Used for testing & direct streaming verification).
   *
   * Note: Stores into the instance-local `testStorage` Map. This data is volatile and exists only
   * for the lifetime of this specific ObjectStorageService instance in process memory.
   */
  async putObject(
    objectKey: string,
    buffer: Buffer,
    contentType: string = 'image/jpeg',
  ): Promise<ObjectMetadata> {
    if (this.appEnv === 'staging' || this.appEnv === 'production') {
      throw new Error(
        `S3_FAIL_CLOSED_ERROR: Direct in-memory putObject/testStorage is strictly prohibited in ${this.appEnv}. Real S3 streaming must be used.`,
      );
    }

    if (!this.testStorage) {
      throw new Error('S3_FAIL_CLOSED_ERROR: testStorage is not initialized.');
    }

    const checksumSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    this.testStorage.set(objectKey, {
      buffer,
      contentType,
      checksumSha256,
      updatedAt: new Date(),
    });

    return {
      objectKey,
      contentLength: buffer.length,
      contentType,
      checksumSha256,
      lastModified: new Date(),
    };
  }

  /**
   * Retrieves object metadata (HeadObject equivalent).
   * In production mode with S3 credentials: queries S3 via signed AWS SigV4 HEAD/GET requests.
   * In test/in-memory mode: queries the internal instance-scoped testStorage registry.
   * Returns null if the object does not exist in this instance's registry.
   */
  async headObject(objectKey: string): Promise<ObjectMetadata | null> {
    if (this.appEnv === 'staging' || this.appEnv === 'production') {
      return this.executeS3Head(objectKey);
    }

    if (this.isTestEnvironment || !this.accessKeyId || !this.secretAccessKey) {
      if (!this.testStorage) {
        return null;
      }
      const item = this.testStorage.get(objectKey);
      if (!item) {
        return null;
      }

      return {
        objectKey,
        contentLength: item.buffer.length,
        contentType: item.contentType,
        checksumSha256: item.checksumSha256,
        lastModified: item.updatedAt,
      };
    }

    return this.executeS3Head(objectKey);
  }

  /**
   * Returns whether in-memory testStorage is instantiated.
   */
  hasTestStorage(): boolean {
    return this.testStorage !== null;
  }

  /**
   * Executes HeadObject query against remote S3-compatible storage.
   */
  private async executeS3Head(objectKey: string): Promise<ObjectMetadata | null> {
    if (!this.s3Client) return null;

    let res;
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      });

      res = await this.s3Client.send(command);
    } catch (err: any) {
      // 1. Genuine missing object: only 404 / NotFound / NoSuchKey returns null
      if (
        err?.name === 'NotFound' ||
        err?.name === 'NoSuchKey' ||
        err?.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }

      // 2. Authorization / Permission failure: HTTP 403
      if (
        err?.$metadata?.httpStatusCode === 403 ||
        err?.name === 'AccessDenied' ||
        err?.name === 'Forbidden'
      ) {
        this.logger.error(`S3 Access Denied (HTTP 403) accessing object '${objectKey}' in bucket '${this.bucketName}'`);
        throw new Error(
          `S3_ACCESS_DENIED: Access denied when reading storage object '${objectKey}'. Check storage permissions and credentials.`,
        );
      }

      // 3. Transient network or storage communication failures (e.g. 5xx, timeout, socket hangup)
      this.logger.error(`S3 HeadObject communication failure for '${objectKey}': ${err.message}`);
      throw new Error(
        `STORAGE_COMMUNICATION_ERROR: Storage communication error when querying object '${objectKey}'.`,
      );
    }

    const contentLength = res.ContentLength ?? 0;
    const contentType = res.ContentType || 'application/octet-stream';
    const lastModified = res.LastModified || new Date();

    // AWS S3 returns ChecksumSHA256 as Base64 when uploaded with SHA-256 checksum
    const s3ChecksumBase64 = res.ChecksumSHA256;
    let checksumSha256 = '';

    if (s3ChecksumBase64) {
      checksumSha256 = Buffer.from(s3ChecksumBase64, 'base64').toString('hex');
    } else {
      // Fallback: stream object bytes and compute SHA-256 directly
      // This is outside the HeadObject catch block so stream/read errors do not masquerade as missing objects
      checksumSha256 = await this.computeRemoteObjectSha256(objectKey);
    }

    return {
      objectKey,
      contentLength,
      contentType,
      checksumSha256,
      lastModified,
    };
  }

  /**
   * Streams remote object bytes and computes SHA-256 digest when ChecksumSHA256 is absent.
   */
  private async computeRemoteObjectSha256(objectKey: string): Promise<string> {
    if (!this.s3Client) {
      throw new Error(`S3_FAIL_CLOSED_ERROR: S3 client not initialized for checksum calculation.`);
    }

    let res;
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      });

      res = await this.s3Client.send(command);
    } catch (err: any) {
      if (
        err?.$metadata?.httpStatusCode === 403 ||
        err?.name === 'AccessDenied' ||
        err?.name === 'Forbidden'
      ) {
        this.logger.error(`S3 Access Denied (HTTP 403) streaming object '${objectKey}' for checksum calculation`);
        throw new Error(
          `S3_ACCESS_DENIED: Access denied when reading storage object stream for '${objectKey}'.`,
        );
      }
      this.logger.error(`S3 GetObject failure for '${objectKey}': ${err.message}`);
      throw new Error(
        `STORAGE_COMMUNICATION_ERROR: Failed to retrieve object stream for '${objectKey}'.`,
      );
    }

    if (!res.Body) {
      throw new Error(`STORAGE_STREAM_READ_ERROR: S3 GET returned empty body stream for '${objectKey}'.`);
    }

    const hash = crypto.createHash('sha256');
    const stream = res.Body as Readable;

    try {
      for await (const chunk of stream) {
        hash.update(chunk);
      }
    } catch (streamErr: any) {
      if (typeof stream.destroy === 'function') {
        stream.destroy(streamErr);
      }
      this.logger.error(`Storage stream read error for '${objectKey}': ${streamErr.message}`);
      throw new Error(
        `STORAGE_STREAM_READ_ERROR: Stream read interrupted during checksum calculation for '${objectKey}'.`,
      );
    }

    return hash.digest('hex');
  }

  /**
   * Verifies object presence and cryptographic SHA-256 upload integrity.
   * Rejects finalization if checksum mismatches or object is not found.
   * NEVER provides mock fallback: objects not found in storage are rejected with OBJECT_NOT_FOUND.
   *
   * In test mode, this verifies against this specific service instance's in-memory storage registry.
   * Verification passing confirms in-process payload integrity prior to database finalization,
   * but does not imply cross-process persistence.
   */
  async verifyObjectIntegrity(
    objectKey: string,
    expectedChecksumSha256: string,
    expectedSizeBytes: number,
  ): Promise<IntegrityCheckResult> {
    const metadata = await this.headObject(objectKey);

    if (!metadata) {
      return {
        valid: false,
        actualChecksum: '',
        expectedChecksum: expectedChecksumSha256,
        actualSizeBytes: 0,
        expectedSizeBytes,
        error: `OBJECT_NOT_FOUND: Object '${objectKey}' does not exist in storage bucket '${this.bucketName}'`,
      };
    }

    if (metadata.checksumSha256.toLowerCase() !== expectedChecksumSha256.toLowerCase()) {
      return {
        valid: false,
        actualChecksum: metadata.checksumSha256,
        expectedChecksum: expectedChecksumSha256,
        actualSizeBytes: metadata.contentLength,
        expectedSizeBytes,
        error: `CHECKSUM_MISMATCH: Uploaded object SHA-256 (${metadata.checksumSha256}) does not match expected checksum (${expectedChecksumSha256})`,
      };
    }

    if (expectedSizeBytes > 0 && metadata.contentLength !== expectedSizeBytes) {
      return {
        valid: false,
        actualChecksum: metadata.checksumSha256,
        expectedChecksum: expectedChecksumSha256,
        actualSizeBytes: metadata.contentLength,
        expectedSizeBytes,
        error: `SIZE_MISMATCH: Uploaded object size (${metadata.contentLength} bytes) does not match expected size (${expectedSizeBytes} bytes)`,
      };
    }

    return {
      valid: true,
      actualChecksum: metadata.checksumSha256,
      expectedChecksum: expectedChecksumSha256,
      actualSizeBytes: metadata.contentLength,
      expectedSizeBytes,
    };
  }

  /**
   * Clears the in-memory test storage (used during test teardown).
   */
  clearTestStorage(): void {
    this.testStorage?.clear();
  }

  getBucketName(): string {
    return this.bucketName;
  }
}

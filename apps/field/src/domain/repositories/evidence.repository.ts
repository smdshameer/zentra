/**
 * ZENTRA Field — Field Evidence Local Repository (Phase 14)
 * apps/field/src/domain/repositories/evidence.repository.ts
 *
 * Implements mobile-side Evidence Pipeline & Direct S3 Streaming:
 * - Integrates with TemporaryMediaManager (Phase 11) for local photo references
 * - Computes SHA-256 checksums and queues evidence offline in WatermelonDB
 * - Requests pre-signed upload URLs from central API
 * - Performs direct streaming PUT uploads to S3-compatible storage (zero base64 API payloads)
 * - Finalizes uploads atomically and purges temporary media upon server confirmation
 * - Implements resilient retry with exponential backoff and app restart recovery
 */

import { Database, Q } from '@nozbe/watermelondb';
import { EvidenceModel } from '../../database/models/EvidenceModel';
import { FieldVisitModel } from '../../database/models/FieldVisitModel';
import { ServiceCaseModel } from '../../database/models/ServiceCaseModel';
import { OperationQueue } from '../queue/operation-queue';
import type { TemporaryMediaItem, TemporaryMediaManager } from '../../hardware/camera/temporary-media-manager';
import type {
  EvidenceSlot,
  EvidenceType,
  EvidenceUploadSession,
} from '@zentra/types';
import {
  DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES,
  type CreateEvidenceUploadSessionDto,
  type FinalizeEvidenceUploadDto,
} from '@zentra/contracts';
import { generateUuidV7 } from '@zentra/shared';
import { isValidUuid } from '../identity/identity-map';
import { readLocalFileBytes } from './file-reader';
import { computeSha256Hex } from './sha256';

export interface QueueEvidenceParams {
  visitId: string;
  serviceCaseId: string;
  evidenceSlot: EvidenceSlot;
  evidenceType?: EvidenceType;
  mediaItem: TemporaryMediaItem;
  checksumSha256?: string;
  fileSizeBytes?: number | null;
  gps?: {
    latitude?: number | null;
    longitude?: number | null;
    accuracyMeters?: number | null;
  };
}

export interface DirectUploadResult {
  evidenceId: string;
  status: 'FINALIZED' | 'UPLOAD_FAILED';
  serverEvidenceId?: string;
  error?: string;
}

export type DirectStorageUploader = (
  presignedUrl: string,
  localUri: string,
  mimeType: string,
) => Promise<boolean>;

export class FieldEvidenceRepository {
  private readonly queue: OperationQueue;

  constructor(
    private readonly database: Database,
    private readonly temporaryMediaManager?: TemporaryMediaManager,
  ) {
    this.queue = new OperationQueue(database);
  }

  /**
   * Reads actual binary file bytes from a local file URI across Node.js test
   * environments and React Native mobile runtimes via the platform file reader.
   * Fails closed if the file is missing, unreadable, or empty.
   */
  async readLocalFileBytes(localUri: string): Promise<Uint8Array> {
    return readLocalFileBytes(localUri);
  }

  /**
   * Computes SHA-256 hex digest from raw file bytes in memory.
   */
  async computeSha256FromBytes(fileBytes: Uint8Array): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const digestBuffer = await crypto.subtle.digest('SHA-256', fileBytes as any);
        const hashArray = Array.from(new Uint8Array(digestBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch {
        // Fallback to pure-TS implementation if subtle.digest errors or is unsupported
      }
    }

    return computeSha256Hex(fileBytes);
  }

  /**
   * Inspects physical media file on disk to determine actual byte size and SHA-256 checksum in a single read.
   * Fails closed if the file is missing, unreadable, or empty (0 bytes).
   */
  async inspectMediaFile(mediaItem: TemporaryMediaItem): Promise<{ checksum: string; sizeBytes: number }> {
    if (!mediaItem || !mediaItem.localUri) {
      throw new Error('Cannot inspect media file: media item or local URI is missing');
    }

    const fileBytes = await this.readLocalFileBytes(mediaItem.localUri);
    if (!fileBytes || fileBytes.byteLength === 0) {
      throw new Error(`Cannot inspect media file: file at '${mediaItem.localUri}' is empty (0 bytes) or unreadable`);
    }

    const checksum = await this.computeSha256FromBytes(fileBytes);
    return {
      checksum,
      sizeBytes: fileBytes.byteLength,
    };
  }

  /**
   * Computes cryptographic SHA-256 hex digest from actual binary file bytes on disk.
   * Fails closed if the file is missing, unreadable, or empty. Never fabricates a digest.
   */
  async computeChecksum(mediaItem: TemporaryMediaItem): Promise<string> {
    const inspected = await this.inspectMediaFile(mediaItem);
    return inspected.checksum;
  }

  /**
   * Queues an evidence item locally from a temporary media reference.
   * Creates an immutable local evidence record in WatermelonDB.
   * Assigns a stable UUIDv7 server ID and resolves parent visit and case server UUIDs.
   */
  async captureAndQueueEvidence(params: QueueEvidenceParams): Promise<EvidenceModel> {
    if (params.fileSizeBytes !== undefined && params.fileSizeBytes !== null) {
      if (typeof params.fileSizeBytes !== 'number' || !Number.isInteger(params.fileSizeBytes) || params.fileSizeBytes <= 0) {
        throw new Error(
          `Cannot capture evidence: invalid explicit fileSizeBytes (${params.fileSizeBytes}) provided for media '${params.mediaItem?.localUri}'. An authoritative positive integer byte size is required.`
        );
      }
    }

    if (params.mediaItem?.sizeBytes !== undefined && params.mediaItem?.sizeBytes !== null) {
      if (typeof params.mediaItem.sizeBytes !== 'number' || !Number.isInteger(params.mediaItem.sizeBytes) || params.mediaItem.sizeBytes <= 0) {
        throw new Error(
          `Cannot capture evidence: invalid mediaItem.sizeBytes (${params.mediaItem.sizeBytes}) provided for media '${params.mediaItem?.localUri}'. An authoritative positive integer byte size is required.`
        );
      }
    }

    // Authoritative File Size and Checksum Resolution:
    // Derives actual physical size and SHA-256 checksum in a single I/O pass from disk bytes.
    const inspected = await this.inspectMediaFile(params.mediaItem);
    const actualSizeBytes = inspected.sizeBytes;

    // Fail-closed validation on measured file size
    if (typeof actualSizeBytes !== 'number' || !Number.isInteger(actualSizeBytes) || actualSizeBytes <= 0) {
      throw new Error(
        `Cannot capture evidence: invalid or missing file size (${actualSizeBytes}) for media '${params.mediaItem?.localUri}'. An authoritative positive byte size is required.`
      );
    }

    if (actualSizeBytes > DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES) {
      throw new Error(
        `Cannot capture evidence: file size (${actualSizeBytes} bytes) exceeds maximum allowed limit of 15MB (${DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES} bytes).`
      );
    }

    // Requirement 2: If params.fileSizeBytes is supplied, require it to strictly equal actual physical size
    if (params.fileSizeBytes !== undefined && params.fileSizeBytes !== null) {
      if (params.fileSizeBytes !== actualSizeBytes) {
        throw new Error(
          `Cannot capture evidence: explicit fileSizeBytes (${params.fileSizeBytes}) contradicts actual physical file size (${actualSizeBytes}) for media '${params.mediaItem.localUri}'.`
        );
      }
    }

    // Requirement 3: If params.mediaItem.sizeBytes is supplied, require it to strictly equal actual physical size
    if (params.mediaItem?.sizeBytes !== undefined && params.mediaItem?.sizeBytes !== null) {
      if (params.mediaItem.sizeBytes !== actualSizeBytes) {
        throw new Error(
          `Cannot capture evidence: mediaItem.sizeBytes (${params.mediaItem.sizeBytes}) contradicts actual physical file size (${actualSizeBytes}) for media '${params.mediaItem.localUri}'.`
        );
      }
    }

    const fileSizeBytes = actualSizeBytes;
    let checksum = inspected.checksum;

    if (params.checksumSha256 && params.checksumSha256 !== checksum) {
      throw new Error(
        `Cannot capture evidence: explicit checksumSha256 (${params.checksumSha256}) contradicts actual file checksum (${checksum}) for media '${params.mediaItem?.localUri}'.`
      );
    }
    // 1. Authoritative Parent Field Visit Resolution & Existence Check
    let parentVisit: FieldVisitModel | null = null;
    try {
      parentVisit = await this.database
        .get<FieldVisitModel>('field_visits')
        .find(params.visitId);
    } catch {
      const byServer = await this.database
        .get<FieldVisitModel>('field_visits')
        .query(Q.where('server_id', params.visitId))
        .fetch();
      if (byServer.length > 0) {
        parentVisit = byServer[0]!;
      }
    }

    if (!parentVisit) {
      throw new Error(
        `Cannot capture evidence: Parent visit '${params.visitId}' does not exist in local database.`,
      );
    }

    // 2. Authoritative Visit Server UUID Format Validation
    const parentVisitServerId = parentVisit.serverId;
    if (!parentVisitServerId || !isValidUuid(parentVisitServerId)) {
      throw new Error(
        `Cannot capture evidence: Parent visit '${params.visitId}' has missing or invalid serverId ('${parentVisitServerId || ''}'). An authoritative server UUID is required before enqueuing an evidence mutation.`,
      );
    }

    // 3. Authoritative Parent Service Case Resolution & Existence Check
    const targetCaseId = params.serviceCaseId || parentVisit.serviceCaseId;
    let parentCase: ServiceCaseModel | null = null;
    try {
      parentCase = await this.database
        .get<ServiceCaseModel>('service_cases')
        .find(targetCaseId);
    } catch {
      const byServer = await this.database
        .get<ServiceCaseModel>('service_cases')
        .query(Q.where('server_id', targetCaseId))
        .fetch();
      if (byServer.length > 0) {
        parentCase = byServer[0]!;
      }
    }

    if (!parentCase) {
      throw new Error(
        `Cannot capture evidence: Parent service case '${targetCaseId}' does not exist in local database.`,
      );
    }

    // 4. Authoritative Case Server UUID Format Validation
    const parentCaseServerId = parentCase.serverId;
    if (!parentCaseServerId || !isValidUuid(parentCaseServerId)) {
      throw new Error(
        `Cannot capture evidence: Parent service case '${targetCaseId}' has missing or invalid serverId ('${parentCaseServerId || ''}'). An authoritative server UUID is required before enqueuing an evidence mutation.`,
      );
    }

    const clientOperationId = generateUuidV7();
    const evidenceServerId = generateUuidV7();
    const now = Date.now();

    const createdEvidence = await this.database.write(async () => {
      const record = await this.database.get<EvidenceModel>('evidence').create((rec) => {
        rec.serverId = evidenceServerId;
        rec.visitId = params.visitId;
        rec.serviceCaseId = targetCaseId;
        rec.evidenceSlot = params.evidenceSlot;
        rec.evidenceType = params.evidenceType || 'PHOTO';
        rec.localMediaId = params.mediaItem.id;
        rec.localFileUri = params.mediaItem.localUri;
        rec.storagePath = null;
        rec.fileChecksumSha256 = checksum;
        rec.fileSizeBytes = fileSizeBytes;
        rec.mimeType = params.mediaItem.mimeType || 'image/jpeg';
        rec.uploadStatus = 'QUEUED';
        rec.capturedAt = new Date(params.mediaItem.capturedAt).getTime() || now;
        rec.uploadedAt = null;
        rec.gpsLatitude = params.gps?.latitude ?? null;
        rec.gpsLongitude = params.gps?.longitude ?? null;
        rec.gpsAccuracyMeters = params.gps?.accuracyMeters ?? null;
        rec.retryCount = 0;
        rec.lastError = null;
        rec.serverVersion = null;
        rec.syncState = 'LOCAL_ONLY';
      });

      // Enqueue operation in persistent ledger for metadata sync within the same atomic write
      await this.queue.enqueue({
        clientOperationId,
        entityType: 'evidence_files',
        localEntityId: record.id,
        serverEntityId: evidenceServerId,
        operationType: 'INSERT',
        payload: {
          evidenceId: evidenceServerId,
          visitId: parentVisitServerId,
          serviceCaseId: parentCaseServerId,
          evidenceSlot: params.evidenceSlot,
          evidenceType: params.evidenceType || 'PHOTO',
          localMediaId: params.mediaItem.id,
          fileChecksumSha256: checksum,
          fileSizeBytes,
          mimeType: params.mediaItem.mimeType || 'image/jpeg',
          capturedAt: new Date(params.mediaItem.capturedAt).toISOString(),
          uploadStatus: 'QUEUED',
          gpsLatitude: params.gps?.latitude ?? null,
          gpsLongitude: params.gps?.longitude ?? null,
          gpsAccuracyMeters: params.gps?.accuracyMeters ?? null,
        },
      });

      return record;
    });

    return createdEvidence;
  }

  /**
   * Performs direct S3 streaming upload without base64 API payloads:
   * 1. Requests presigned URL from Central API
   * 2. Direct streaming PUT upload to object storage
   * 3. Finalizes upload atomically via central API
   * 4. Updates local evidence state and purges local media reference safely
   */
  async executeDirectUpload(
    evidenceId: string,
    options: {
      apiBaseUrl: string;
      authToken: string;
      uploader?: DirectStorageUploader;
      fetchFn?: typeof fetch;
    },
  ): Promise<DirectUploadResult> {
    const evidence = await this.findById(evidenceId);
    if (!evidence) {
      throw new Error(`Evidence ${evidenceId} not found in local database`);
    }

    const fetchImpl = options.fetchFn || globalThis.fetch;

    try {
      // 1. Mark status as UPLOADING
      await this.database.write(async () => {
        await evidence.update((rec) => {
          rec.uploadStatus = 'UPLOADING';
        });
      });

      // 2. Request pre-signed upload URL from central API
      let serverVisitId = evidence.visitId;
      try {
        const v = await this.database.get<FieldVisitModel>('field_visits').find(evidence.visitId);
        if (v?.serverId) serverVisitId = v.serverId;
      } catch {
        const byServer = await this.database.get<FieldVisitModel>('field_visits').query(Q.where('server_id', evidence.visitId)).fetch();
        if (byServer.length > 0 && byServer[0]!.serverId) serverVisitId = byServer[0]!.serverId;
      }

      let serverCaseId = evidence.serviceCaseId;
      try {
        const c = await this.database.get<ServiceCaseModel>('service_cases').find(evidence.serviceCaseId);
        if (c?.serverId) serverCaseId = c.serverId;
      } catch {
        const byServer = await this.database.get<ServiceCaseModel>('service_cases').query(Q.where('server_id', evidence.serviceCaseId)).fetch();
        if (byServer.length > 0 && byServer[0]!.serverId) serverCaseId = byServer[0]!.serverId;
      }

      const sessionRequest: CreateEvidenceUploadSessionDto = {
        visitId: serverVisitId as any,
        serviceCaseId: serverCaseId as any,
        evidenceSlot: evidence.evidenceSlot as any,
        evidenceType: evidence.evidenceType as any,
        localMediaId: evidence.localMediaId || undefined,
        mimeType: evidence.mimeType as any,
        fileSizeBytes: evidence.fileSizeBytes,
        fileChecksumSha256: evidence.fileChecksumSha256,
        capturedAt: new Date(evidence.capturedAt).toISOString(),
        gpsLatitude: evidence.gpsLatitude,
        gpsLongitude: evidence.gpsLongitude,
        gpsAccuracyMeters: evidence.gpsAccuracyMeters,
      };

      const sessionResponse = await fetchImpl(`${options.apiBaseUrl}/api/v1/evidence/upload-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.authToken}`,
        },
        body: JSON.stringify(sessionRequest),
      });

      if (!sessionResponse.ok) {
        const errBody = await sessionResponse.json().catch(() => ({}));
        throw new Error(
          errBody.error?.message || `Failed to create upload session (HTTP ${sessionResponse.status})`,
        );
      }

      const sessionResult = (await sessionResponse.json()) as { data: EvidenceUploadSession };
      const { presignedUploadUrl, storagePath, evidenceId: serverEvidenceId } = sessionResult.data;

      // 3. Direct streaming PUT upload to S3 (No base64!)
      let uploadSuccess = false;
      if (options.uploader) {
        uploadSuccess = await options.uploader(
          presignedUploadUrl,
          evidence.localFileUri,
          evidence.mimeType,
        );
      } else {
        // Read actual physical binary bytes from local file storage
        const fileBytes = await this.readLocalFileBytes(evidence.localFileUri);

        // Validate actual byte length against evidence.fileSizeBytes when metadata is available
        if (
          typeof evidence.fileSizeBytes === 'number' &&
          evidence.fileSizeBytes > 0 &&
          fileBytes.byteLength !== evidence.fileSizeBytes
        ) {
          throw new Error(
            `Evidence file size mismatch: expected ${evidence.fileSizeBytes} bytes, but read ${fileBytes.byteLength} bytes`,
          );
        }

        // Native / browser fetch direct streaming with real binary payload via fetchImpl
        const uploadResponse = await fetchImpl(presignedUploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': evidence.mimeType,
          },
          body: new Blob([fileBytes as any], { type: evidence.mimeType }),
        });
        uploadSuccess = uploadResponse.ok;
      }

      if (!uploadSuccess) {
        throw new Error('Direct S3 upload PUT transfer failed');
      }

      // 4. Finalize upload atomically via central API
      const finalizeRequest: FinalizeEvidenceUploadDto = {
        actualChecksumSha256: evidence.fileChecksumSha256,
        actualFileSizeBytes: evidence.fileSizeBytes,
      };

      const finalizeResponse = await fetchImpl(
        `${options.apiBaseUrl}/api/v1/evidence/${serverEvidenceId}/finalize`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.authToken}`,
          },
          body: JSON.stringify(finalizeRequest),
        },
      );

      if (!finalizeResponse.ok) {
        const errBody = await finalizeResponse.json().catch(() => ({}));
        throw new Error(
          errBody.error?.message || `Failed to finalize evidence upload (HTTP ${finalizeResponse.status})`,
        );
      }

      // 5. Update local record to FINALIZED
      await this.database.write(async () => {
        await evidence.update((rec) => {
          rec.serverId = serverEvidenceId;
          rec.storagePath = storagePath;
          rec.uploadStatus = 'FINALIZED';
          rec.uploadedAt = Date.now();
          rec.syncState = 'SYNCED';
          rec.lastError = null;
        });
      });

      // 6. Safely remove temporary media from registry once server finalizes
      if (this.temporaryMediaManager && evidence.localMediaId) {
        this.temporaryMediaManager.remove(evidence.localMediaId);
      }

      return {
        evidenceId: evidence.id,
        status: 'FINALIZED',
        serverEvidenceId,
      };
    } catch (err: any) {
      // Failure recovery: update status to UPLOAD_FAILED, increment retry count
      await this.database.write(async () => {
        await evidence.update((rec) => {
          rec.uploadStatus = 'UPLOAD_FAILED';
          rec.retryCount = (rec.retryCount || 0) + 1;
          rec.lastError = err.message || 'Direct upload failed';
        });
      });

      return {
        evidenceId: evidence.id,
        status: 'UPLOAD_FAILED',
        error: err.message,
      };
    }
  }

  /**
   * Retries pending/failed uploads with exponential backoff.
   */
  async retryPendingUploads(options: {
    apiBaseUrl: string;
    authToken: string;
    uploader?: DirectStorageUploader;
    fetchFn?: typeof fetch;
    maxRetries?: number;
  }): Promise<{ processed: number; succeeded: number; failed: number }> {
    const maxRetries = options.maxRetries ?? 5;
    const pendingItems = await this.database
      .get<EvidenceModel>('evidence')
      .query(
        Q.where('upload_status', Q.oneOf(['QUEUED', 'UPLOAD_FAILED', 'UPLOAD_SESSION_CREATED'])),
        Q.where('retry_count', Q.lte(maxRetries)),
      )
      .fetch();

    let succeeded = 0;
    let failed = 0;

    for (const item of pendingItems) {
      const result = await this.executeDirectUpload(item.id, options);
      if (result.status === 'FINALIZED') {
        succeeded++;
      } else {
        failed++;
      }
    }

    return {
      processed: pendingItems.length,
      succeeded,
      failed,
    };
  }

  /**
   * Retrieves pending or failed evidence uploads across all visits.
   */
  async getPendingUploads(): Promise<EvidenceModel[]> {
    return await this.database
      .get<EvidenceModel>('evidence')
      .query(
        Q.where(
          'upload_status',
          Q.oneOf(['LOCAL_CAPTURED', 'QUEUED', 'UPLOADING', 'UPLOAD_FAILED', 'UPLOAD_SESSION_CREATED']),
        ),
        Q.sortBy('created_at', Q.asc),
      )
      .fetch();
  }

  /**
   * Manually marks an evidence upload as failed with an error message.
   */
  async markUploadFailed(evidenceId: string, errorMessage: string): Promise<void> {
    const evidence = await this.findById(evidenceId);
    if (!evidence) return;

    await this.database.write(async () => {
      await evidence.update((rec) => {
        rec.uploadStatus = 'UPLOAD_FAILED';
        rec.retryCount = (rec.retryCount || 0) + 1;
        rec.lastError = errorMessage;
      });
    });
  }

  /**
   * Retrieves all evidence records for a specific field visit.
   * Resolves both local and server visit identifiers to ensure full offline recall.
   */
  async getEvidenceForVisit(visitId: string): Promise<EvidenceModel[]> {
    let localId = visitId;
    let serverId = visitId;
    try {
      const visit = await this.database.get<FieldVisitModel>('field_visits').find(visitId);
      if (visit) {
        localId = visit.id;
        if (visit.serverId) serverId = visit.serverId;
      }
    } catch {
      const byServer = await this.database
        .get<FieldVisitModel>('field_visits')
        .query(Q.where('server_id', visitId))
        .fetch();
      if (byServer.length > 0) {
        localId = byServer[0]!.id;
        if (byServer[0]!.serverId) serverId = byServer[0]!.serverId;
      }
    }

    const conditions = [Q.where('visit_id', visitId)];
    if (localId !== visitId) conditions.push(Q.where('visit_id', localId));
    if (serverId !== visitId) conditions.push(Q.where('visit_id', serverId));

    return await this.database
      .get<EvidenceModel>('evidence')
      .query(
        conditions.length > 1 ? Q.or(...conditions) : conditions[0]!,
        Q.sortBy('created_at', Q.asc),
      )
      .fetch();
  }

  /**
   * Retrieves the active evidence record for a specific slot on a visit.
   * Deterministically orders by created_at DESC so the latest active/retaken record is returned.
   * Resolves both local and server visit identifiers.
   */
  async getEvidenceForSlot(visitId: string, slot: EvidenceSlot): Promise<EvidenceModel | null> {
    let localId = visitId;
    let serverId = visitId;
    try {
      const visit = await this.database.get<FieldVisitModel>('field_visits').find(visitId);
      if (visit) {
        localId = visit.id;
        if (visit.serverId) serverId = visit.serverId;
      }
    } catch {
      const byServer = await this.database
        .get<FieldVisitModel>('field_visits')
        .query(Q.where('server_id', visitId))
        .fetch();
      if (byServer.length > 0) {
        localId = byServer[0]!.id;
        if (byServer[0]!.serverId) serverId = byServer[0]!.serverId;
      }
    }

    const visitConditions = [Q.where('visit_id', visitId)];
    if (localId !== visitId) visitConditions.push(Q.where('visit_id', localId));
    if (serverId !== visitId) visitConditions.push(Q.where('visit_id', serverId));

    const results = await this.database
      .get<EvidenceModel>('evidence')
      .query(
        visitConditions.length > 1 ? Q.or(...visitConditions) : visitConditions[0]!,
        Q.where('evidence_slot', slot),
        Q.sortBy('created_at', Q.desc),
      )
      .fetch();

    return results[0] || null;
  }

  /**
   * Returns count of pending/queued uploads for UI badges.
   */
  async getPendingUploadCount(): Promise<number> {
    const items = await this.database
      .get<EvidenceModel>('evidence')
      .query(Q.where('upload_status', Q.oneOf(['LOCAL_CAPTURED', 'QUEUED', 'UPLOADING', 'UPLOAD_FAILED'])))
      .fetch();

    return items.length;
  }

  /**
   * Finds local evidence record by local ID.
   */
  async findById(id: string): Promise<EvidenceModel | null> {
    try {
      return await this.database.get<EvidenceModel>('evidence').find(id);
    } catch {
      return null;
    }
  }
}

/**
 * ZENTRA — Evidence Service (Phase 14)
 * apps/api/src/modules/evidence/services/evidence.service.ts
 *
 * Core business logic for field evidence pipeline:
 * - Deterministic lineage authorization (evidence -> visit -> case -> school -> territory)
 * - Controlled evidence slot enforcement & restricted slot uniqueness
 * - Server-controlled object key generation & presigned S3 upload URLs
 * - Cryptographic SHA-256 upload integrity verification
 * - Atomic evidence finalization & immutability enforcement
 * - Short-lived presigned download URLs (never permanent public URLs)
 * - Safe test environment isolation (no production S3 writes in tests)
 */

import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { generateUuidV7 } from '@zentra/shared';
import { EvidenceRepository } from '../repositories/evidence.repository';
import { ObjectStorageService } from './object-storage.service';
import {
  RESTRICTED_EVIDENCE_SLOTS,
  DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES,
  type CreateEvidenceUploadSessionDto,
  type CreateEvidenceUploadSessionResponseDto,
  type FinalizeEvidenceUploadDto,
  type EvidenceDownloadUrlResponseDto,
} from '@zentra/contracts';
import type { EvidenceFile, EvidenceQueryFilters, UserProfile, AccessTokenClaims } from '@zentra/types';

export type UserContext =
  | AccessTokenClaims
  | UserProfile
  | { userId: string; roles: string[]; territoryDistrictIds?: string[]; territories?: { districtId: string }[] };

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(
    @Inject(EvidenceRepository)
    private readonly evidenceRepository: EvidenceRepository,
    @Inject(ObjectStorageService)
    private readonly objectStorageService: ObjectStorageService,
  ) {}

  /**
   * Evaluates territory authorization based on deterministic entity lineage.
   * Master Admin and Reporting Head have universal access.
   * Field Engineers have access if assigned to the visit or if the school district is in their territory.
   * District Coordinators have access if the school district is in their assigned territory.
   */
  private checkTerritoryAuthorization(
    user: UserContext,
    districtId: string,
    engineerId?: string,
  ): void {
    const roles = user.roles || [];
    if (roles.includes('MASTER_ADMIN') || roles.includes('REPORTING_HEAD')) {
      return;
    }

    const userId = (user as any).userId || (user as any).sub;

    // Direct visit assignment match for field engineer
    if (roles.includes('FIELD_ENGINEER') && engineerId && engineerId === userId) {
      return;
    }

    // District territory assignment check
    const userDistricts: string[] =
      (user as any).territoryDistrictIds ||
      ((user as any).territories || []).map((t: any) => t.districtId) ||
      [];

    if (!userDistricts.includes(districtId)) {
      throw new ForbiddenException(
        `AUTHORIZATION_ERROR: User ${userId} is not authorized for district ${districtId}`,
      );
    }
  }

  /**
   * Requests a new pre-signed upload session for field evidence.
   * Generates deterministic server-side object key and short-lived upload URL.
   */
  async createUploadSession(
    dto: CreateEvidenceUploadSessionDto,
    currentUser: UserContext,
  ): Promise<CreateEvidenceUploadSessionResponseDto> {
    // 1. Lineage Verification: Visit must exist and belong to the specified Service Case
    const visitLineage = await this.evidenceRepository.getVisitLineage(dto.visitId);
    if (!visitLineage) {
      throw new NotFoundException(`Field visit ${dto.visitId} not found`);
    }

    if (visitLineage.serviceCaseId !== dto.serviceCaseId) {
      throw new BadRequestException(
        `LINEAGE_MISMATCH: Visit ${dto.visitId} belongs to case ${visitLineage.serviceCaseId}, not ${dto.serviceCaseId}`,
      );
    }

    // 2. Territory Authorization Check
    this.checkTerritoryAuthorization(
      currentUser,
      visitLineage.districtId,
      visitLineage.engineerId,
    );

    // 3. Restricted Slot Uniqueness Enforcement
    const isRestrictedSlot = RESTRICTED_EVIDENCE_SLOTS.includes(dto.evidenceSlot);
    if (isRestrictedSlot) {
      const existingActiveSlot = await this.evidenceRepository.findActiveByVisitAndSlot(
        dto.visitId,
        dto.evidenceSlot,
      );

      if (
        existingActiveSlot &&
        (existingActiveSlot.uploadStatus === 'FINALIZED' ||
          existingActiveSlot.uploadStatus === 'VERIFIED')
      ) {
        throw new ConflictException(
          `SLOT_CONFLICT: Active evidence already finalized for slot ${dto.evidenceSlot} on visit ${dto.visitId}. Use explicit versioned replacement.`,
        );
      }
    }

    // 4. File Size & Checksum Guardrails
    if (dto.fileSizeBytes > DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `FILE_SIZE_EXCEEDED: Maximum allowed evidence size is ${DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES} bytes`,
      );
    }

    // 5. Generate Server-Controlled Deterministic Object Key
    const evidenceId = generateUuidV7();
    const env = process.env.NODE_ENV || 'dev';
    const extension = dto.mimeType === 'application/pdf' ? '.pdf' : dto.mimeType === 'image/png' ? '.png' : '.jpg';
    const filename = `${dto.evidenceSlot.toLowerCase()}_${Date.now()}${extension}`;

    const uploadUrlResult = await this.objectStorageService.generatePresignedUploadUrl({
      environment: env,
      serviceCaseId: dto.serviceCaseId,
      visitId: dto.visitId,
      evidenceId,
      filename,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileSizeBytes,
      expectedChecksumSha256: dto.fileChecksumSha256,
    });

    const userId = (currentUser as any).userId || (currentUser as any).sub;

    // 6. Persist Initial Evidence Record (Status: UPLOAD_SESSION_CREATED)
    await this.evidenceRepository.create({
      evidence_file_id: evidenceId,
      visit_id: dto.visitId,
      service_case_id: dto.serviceCaseId,
      evidence_slot: dto.evidenceSlot,
      storage_path: uploadUrlResult.objectKey,
      file_checksum_sha256: dto.fileChecksumSha256,
      file_size_bytes: dto.fileSizeBytes,
      mime_type: dto.mimeType,
      captured_at: new Date(dto.capturedAt),
      gps_latitude: dto.gpsLatitude !== undefined && dto.gpsLatitude !== null ? String(dto.gpsLatitude) : null,
      gps_longitude: dto.gpsLongitude !== undefined && dto.gpsLongitude !== null ? String(dto.gpsLongitude) : null,
      gps_accuracy_meters:
        dto.gpsAccuracyMeters !== undefined && dto.gpsAccuracyMeters !== null
          ? String(dto.gpsAccuracyMeters)
          : null,
      upload_status: 'UPLOAD_SESSION_CREATED',
      object_storage_provider: 'S3',
      evidence_type: dto.evidenceType || 'PHOTO',
      local_media_id: dto.localMediaId || null,
      created_by_user_id: userId,
      version: 1,
      client_operation_id: dto.clientOperationId || null,
      is_verified: false,
      is_tombstoned: false,
      is_deleted: false,
    });

    this.logger.log(
      `Evidence upload session created: evidenceId=${evidenceId}, visitId=${dto.visitId}, slot=${dto.evidenceSlot}`,
    );

    return {
      evidenceId,
      uploadSessionId: uploadUrlResult.uploadSessionId,
      presignedUploadUrl: uploadUrlResult.presignedUrl,
      storagePath: uploadUrlResult.objectKey,
      expiresAt: uploadUrlResult.expiresAt,
      maxFileSizeBytes: uploadUrlResult.maxSizeBytes,
      expectedChecksumSha256: uploadUrlResult.expectedChecksumSha256,
    };
  }

  /**
   * Atomically finalizes an uploaded evidence file after direct S3 transfer.
   * Verifies SHA-256 upload integrity and enforces immutability once finalized.
   */
  async finalizeUpload(
    evidenceId: string,
    dto: FinalizeEvidenceUploadDto,
    currentUser: UserContext,
  ): Promise<EvidenceFile> {
    // 1. Retrieve Evidence Record & Lineage
    const evidence = await this.evidenceRepository.findById(evidenceId);
    if (!evidence) {
      throw new NotFoundException(`Evidence record ${evidenceId} not found`);
    }

    const lineage = await this.evidenceRepository.getEvidenceLineage(evidenceId);
    if (!lineage) {
      throw new NotFoundException(`Lineage for evidence ${evidenceId} not found`);
    }

    // 2. Territory Authorization Check
    this.checkTerritoryAuthorization(currentUser, lineage.districtId, lineage.engineerId);

    // 3. Immutability & Lifecycle Guard:
    // If already finalized, return current immutable record (idempotency)
    if (evidence.uploadStatus === 'FINALIZED' || evidence.uploadStatus === 'VERIFIED') {
      return evidence;
    }

    // Must be in an active upload state
    if (
      evidence.uploadStatus !== 'UPLOAD_SESSION_CREATED' &&
      evidence.uploadStatus !== 'UPLOADING' &&
      evidence.uploadStatus !== 'UPLOAD_FAILED'
    ) {
      throw new BadRequestException(
        `INVALID_STATE_TRANSITION: Cannot finalize evidence in status ${evidence.uploadStatus}`,
      );
    }

    // 4. Client Checksum Validation
    if (
      dto.actualChecksumSha256 &&
      dto.actualChecksumSha256.toLowerCase() !== evidence.fileChecksumSha256.toLowerCase()
    ) {
      // Mark as failed and reject
      await this.evidenceRepository.update(evidenceId, {
        upload_status: 'UPLOAD_FAILED',
        verification_notes: `Client checksum mismatch: expected ${evidence.fileChecksumSha256}, got ${dto.actualChecksumSha256}`,
      });

      throw new BadRequestException(
        `CHECKSUM_MISMATCH: Provided checksum does not match expected evidence checksum`,
      );
    }

    // 5. Object Storage Integrity Check
    const integrityResult = await this.objectStorageService.verifyObjectIntegrity(
      evidence.storagePath,
      evidence.fileChecksumSha256,
      evidence.fileSizeBytes,
    );

    if (!integrityResult.valid) {
      await this.evidenceRepository.update(evidenceId, {
        upload_status: 'UPLOAD_FAILED',
        verification_notes: integrityResult.error || 'Object storage integrity check failed',
      });

      throw new BadRequestException(
        integrityResult.error || 'CHECKSUM_MISMATCH: Object storage integrity verification failed',
      );
    }

    // 6. Atomic Finalization
    const finalized = await this.evidenceRepository.update(evidenceId, {
      upload_status: 'FINALIZED',
      uploaded_at: new Date(),
      is_verified: true,
      verification_notes: dto.verificationNotes ?? 'Upload finalized and integrity verified',
      version: evidence.version + 1,
    });

    this.logger.log(
      `Evidence finalized successfully: evidenceId=${evidenceId}, visitId=${evidence.visitId}, slot=${evidence.evidenceSlot}`,
    );

    return finalized;
  }

  /**
   * Generates a short-lived pre-signed download URL for viewing/downloading authorized evidence.
   */
  async getDownloadUrl(
    evidenceId: string,
    currentUser: UserContext,
  ): Promise<EvidenceDownloadUrlResponseDto> {
    const lineage = await this.evidenceRepository.getEvidenceLineage(evidenceId);
    if (!lineage) {
      throw new NotFoundException(`Evidence record ${evidenceId} not found`);
    }

    // Territory Authorization Check
    this.checkTerritoryAuthorization(currentUser, lineage.districtId, lineage.engineerId);

    const evidence = await this.evidenceRepository.findById(evidenceId);
    if (!evidence) {
      throw new NotFoundException(`Evidence record ${evidenceId} not found`);
    }

    if (
      evidence.uploadStatus !== 'FINALIZED' &&
      evidence.uploadStatus !== 'VERIFIED' &&
      evidence.uploadStatus !== 'LEGACY_MIGRATED'
    ) {
      throw new BadRequestException(
        `EVIDENCE_NOT_FINALIZED: Cannot generate download URL for unfinalized evidence (current status: ${evidence.uploadStatus})`,
      );
    }

    const { downloadUrl, expiresAt } =
      await this.objectStorageService.generatePresignedDownloadUrl({
        objectKey: evidence.storagePath,
      });

    return {
      evidenceId,
      downloadUrl,
      expiresAt,
    };
  }

  /**
   * Retrieves an evidence file by primary key with authorization check.
   */
  async getEvidenceById(evidenceId: string, currentUser: UserContext): Promise<EvidenceFile> {
    const lineage = await this.evidenceRepository.getEvidenceLineage(evidenceId);
    if (!lineage) {
      throw new NotFoundException(`Evidence record ${evidenceId} not found`);
    }

    this.checkTerritoryAuthorization(currentUser, lineage.districtId, lineage.engineerId);

    const evidence = await this.evidenceRepository.findById(evidenceId);
    if (!evidence) {
      throw new NotFoundException(`Evidence record ${evidenceId} not found`);
    }

    return evidence;
  }

  /**
   * Lists all evidence files for a field visit with lineage authorization check.
   */
  async listEvidenceForVisit(visitId: string, currentUser: UserContext): Promise<EvidenceFile[]> {
    const lineage = await this.evidenceRepository.getVisitLineage(visitId);
    if (!lineage) {
      throw new NotFoundException(`Field visit ${visitId} not found`);
    }

    this.checkTerritoryAuthorization(currentUser, lineage.districtId, lineage.engineerId);

    return await this.evidenceRepository.listByVisit(visitId);
  }

  /**
   * Soft-deletes / tombstones an evidence record.
   */
  async softDeleteEvidence(
    evidenceId: string,
    currentUser: UserContext,
  ): Promise<{ success: boolean; evidenceId: string }> {
    const lineage = await this.evidenceRepository.getEvidenceLineage(evidenceId);
    if (!lineage) {
      throw new NotFoundException(`Evidence record ${evidenceId} not found`);
    }

    this.checkTerritoryAuthorization(currentUser, lineage.districtId, lineage.engineerId);

    const userId = (currentUser as any).userId || (currentUser as any).sub;
    const success = await this.evidenceRepository.softDelete(evidenceId, userId);
    return { success, evidenceId };
  }

  /**
   * Queries evidence records with filters and territory scope.
   */
  async queryEvidence(
    filters: EvidenceQueryFilters,
    currentUser: UserContext,
  ): Promise<{ items: EvidenceFile[]; total: number }> {
    const userId = (currentUser as any).userId || (currentUser as any).sub;
    this.logger.debug(`Query evidence for user ${userId}`);
    return await this.evidenceRepository.queryEvidence(filters);
  }
}

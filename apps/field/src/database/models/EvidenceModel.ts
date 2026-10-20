/**
 * ZENTRA Field — Evidence Local Model (Phase 14)
 * apps/field/src/database/models/EvidenceModel.ts
 *
 * Models field evidence files (Slot 1 HM signed report, Slot 2 equipment working photo, etc.)
 * Tracks local media reference, direct S3 upload lifecycle, SHA-256 checksum, and sync state.
 */

import { Model } from '@nozbe/watermelondb';
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators';
import type { LocalSyncState } from './ServiceCaseModel';
import type { EvidenceUploadStatus, EvidenceSlot, EvidenceType } from '@zentra/types';

export class EvidenceModel extends Model {
  static table = 'evidence';

  @text('server_id') serverId?: string | null;
  @text('visit_id') visitId!: string;
  @text('service_case_id') serviceCaseId!: string;
  @text('evidence_slot') evidenceSlot!: EvidenceSlot;
  @text('evidence_type') evidenceType!: EvidenceType;
  @text('local_media_id') localMediaId?: string | null;
  @text('local_file_uri') localFileUri!: string;
  @text('storage_path') storagePath?: string | null;
  @text('file_checksum_sha256') fileChecksumSha256!: string;
  @field('file_size_bytes') fileSizeBytes!: number;
  @text('mime_type') mimeType!: string;
  @text('upload_status') uploadStatus!: EvidenceUploadStatus;
  @field('captured_at') capturedAt!: number;
  @field('uploaded_at') uploadedAt?: number | null;
  @field('gps_latitude') gpsLatitude?: number | null;
  @field('gps_longitude') gpsLongitude?: number | null;
  @field('gps_accuracy_meters') gpsAccuracyMeters?: number | null;
  @field('retry_count') retryCount!: number;
  @text('last_error') lastError?: string | null;
  @text('server_version') serverVersion?: string | null;
  @text('sync_state') syncState!: LocalSyncState;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;

  get isFinalized(): boolean {
    return this.uploadStatus === 'FINALIZED' || this.uploadStatus === 'VERIFIED';
  }

  get isPendingUpload(): boolean {
    return (
      this.uploadStatus === 'LOCAL_CAPTURED' ||
      this.uploadStatus === 'QUEUED' ||
      this.uploadStatus === 'UPLOAD_FAILED' ||
      this.uploadStatus === 'UPLOAD_SESSION_CREATED' ||
      this.uploadStatus === 'UPLOADING'
    );
  }
}

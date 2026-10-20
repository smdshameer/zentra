/**
 * ZENTRA — Evidence Repository (Phase 14)
 * apps/api/src/modules/evidence/repositories/evidence.repository.ts
 *
 * Database access for Evidence records with transactional execution,
 * slot uniqueness validation, and lineage queries for territory authorization.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, Transaction, Selectable, Insertable, Updateable, sql } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema, EvidenceFilesTable } from '../../../database/database.types';
import type { EvidenceFile, EvidenceQueryFilters } from '@zentra/types';

export interface EvidenceLineageInfo {
  evidenceId: string;
  visitId: string;
  serviceCaseId: string;
  schoolId: string;
  districtId: string;
  createdByUserId: string | null;
  engineerId: string;
}

export interface VisitLineageInfo {
  visitId: string;
  serviceCaseId: string;
  schoolId: string;
  districtId: string;
  engineerId: string;
}

@Injectable()
export class EvidenceRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  /**
   * Maps database row to canonical EvidenceFile domain entity.
   */
  private mapToDomain(row: Selectable<EvidenceFilesTable>): EvidenceFile {
    return {
      evidenceId: row.evidence_file_id,
      visitId: row.visit_id,
      serviceCaseId: row.service_case_id,
      evidenceSlot: row.evidence_slot,
      evidenceType: row.evidence_type,
      localMediaId: row.local_media_id ?? null,
      storagePath: row.storage_path,
      objectStorageProvider: row.object_storage_provider,
      mimeType: row.mime_type,
      fileSizeBytes: Number(row.file_size_bytes),
      fileChecksumSha256: row.file_checksum_sha256,
      capturedAt:
        row.captured_at instanceof Date
          ? row.captured_at.toISOString()
          : new Date(row.captured_at).toISOString(),
      uploadedAt: row.uploaded_at
        ? row.uploaded_at instanceof Date
          ? row.uploaded_at.toISOString()
          : new Date(row.uploaded_at).toISOString()
        : null,
      uploadStatus: row.upload_status as any,
      gpsLatitude: row.gps_latitude !== null ? Number(row.gps_latitude) : null,
      gpsLongitude: row.gps_longitude !== null ? Number(row.gps_longitude) : null,
      gpsAccuracyMeters:
        row.gps_accuracy_meters !== null ? Number(row.gps_accuracy_meters) : null,
      isVerified: row.is_verified,
      verificationNotes: row.verification_notes ?? null,
      createdByUserId: row.created_by_user_id ?? null,
      version: row.version ?? 1,
      clientOperationId: row.client_operation_id ?? null,
      isTombstoned: row.is_tombstoned,
      isDeleted: row.is_deleted,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString(),
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : new Date(row.updated_at).toISOString(),
    };
  }

  /**
   * Inserts a new evidence file record.
   */
  async create(
    data: Insertable<EvidenceFilesTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<EvidenceFile> {
    const client = trx || this.db;
    const row = await client
      .insertInto('evidence_files')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapToDomain(row);
  }

  /**
   * Retrieves an evidence file by primary key.
   */
  async findById(evidenceId: string): Promise<EvidenceFile | null> {
    const row = await this.db
      .selectFrom('evidence_files')
      .selectAll()
      .where('evidence_file_id', '=', evidenceId)
      .where('is_deleted', '=', false)
      .executeTakeFirst();

    return row ? this.mapToDomain(row) : null;
  }

  /**
   * Checks if an active, non-tombstoned evidence file already exists for a restricted slot in a visit.
   */
  async findActiveByVisitAndSlot(
    visitId: string,
    evidenceSlot: string,
  ): Promise<EvidenceFile | null> {
    const row = await this.db
      .selectFrom('evidence_files')
      .selectAll()
      .where('visit_id', '=', visitId)
      .where('evidence_slot', '=', evidenceSlot)
      .where('is_deleted', '=', false)
      .where('is_tombstoned', '=', false)
      .executeTakeFirst();

    return row ? this.mapToDomain(row) : null;
  }

  /**
   * Lists all active evidence files for a field visit.
   */
  async listByVisit(visitId: string): Promise<EvidenceFile[]> {
    const rows = await this.db
      .selectFrom('evidence_files')
      .selectAll()
      .where('visit_id', '=', visitId)
      .where('is_deleted', '=', false)
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map((r) => this.mapToDomain(r));
  }

  /**
   * Lists all active evidence files for a service case across all visits.
   */
  async listByCase(serviceCaseId: string): Promise<EvidenceFile[]> {
    const rows = await this.db
      .selectFrom('evidence_files')
      .selectAll()
      .where('service_case_id', '=', serviceCaseId)
      .where('is_deleted', '=', false)
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map((r) => this.mapToDomain(r));
  }

  /**
   * Queries evidence files with pagination and filtering.
   */
  async queryEvidence(
    filters: EvidenceQueryFilters,
  ): Promise<{ items: EvidenceFile[]; total: number }> {
    let query = this.db
      .selectFrom('evidence_files')
      .selectAll()
      .where('is_deleted', '=', false);

    if (filters.visitId) {
      query = query.where('visit_id', '=', filters.visitId);
    }
    if (filters.serviceCaseId) {
      query = query.where('service_case_id', '=', filters.serviceCaseId);
    }
    if (filters.evidenceSlot) {
      query = query.where('evidence_slot', '=', filters.evidenceSlot);
    }
    if (filters.uploadStatus) {
      query = query.where('upload_status', '=', filters.uploadStatus);
    }

    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const [rows, countResult] = await Promise.all([
      query.orderBy('created_at', 'desc').limit(limit).offset(offset).execute(),
      this.db
        .selectFrom('evidence_files')
        .select(sql<number>`count(*)`.as('total'))
        .where('is_deleted', '=', false)
        .$if(!!filters.visitId, (qb) => qb.where('visit_id', '=', filters.visitId!))
        .$if(!!filters.serviceCaseId, (qb) =>
          qb.where('service_case_id', '=', filters.serviceCaseId!),
        )
        .$if(!!filters.evidenceSlot, (qb) =>
          qb.where('evidence_slot', '=', filters.evidenceSlot!),
        )
        .$if(!!filters.uploadStatus, (qb) =>
          qb.where('upload_status', '=', filters.uploadStatus!),
        )
        .executeTakeFirst(),
    ]);

    return {
      items: rows.map((r) => this.mapToDomain(r)),
      total: Number(countResult?.total || 0),
    };
  }

  /**
   * Updates an evidence record by ID.
   */
  async update(
    evidenceId: string,
    updates: Updateable<EvidenceFilesTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<EvidenceFile> {
    const client = trx || this.db;
    const row = await client
      .updateTable('evidence_files')
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where('evidence_file_id', '=', evidenceId)
      .where('is_deleted', '=', false)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapToDomain(row);
  }

  /**
   * Soft-deletes / tombstones an evidence record.
   */
  async softDelete(
    evidenceId: string,
    deletedByUserId?: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<boolean> {
    const client = trx || this.db;
    const result = await client
      .updateTable('evidence_files')
      .set({
        is_deleted: true,
        is_tombstoned: true,
        deleted_at: new Date(),
        deleted_by_user_id: deletedByUserId ?? null,
        updated_at: new Date(),
      })
      .where('evidence_file_id', '=', evidenceId)
      .where('is_deleted', '=', false)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  /**
   * Retrieves deterministic lineage for an evidence record:
   * Evidence -> Field Visit -> Service Case -> School -> District
   */
  async getEvidenceLineage(evidenceId: string): Promise<EvidenceLineageInfo | null> {
    const row = await this.db
      .selectFrom('evidence_files as ef')
      .innerJoin('field_visits as fv', 'fv.visit_id', 'ef.visit_id')
      .innerJoin('service_cases as sc', 'sc.service_case_id', 'ef.service_case_id')
      .innerJoin('schools as s', 's.school_id', 'sc.school_id')
      .select([
        'ef.evidence_file_id as evidenceId',
        'ef.visit_id as visitId',
        'ef.service_case_id as serviceCaseId',
        'ef.created_by_user_id as createdByUserId',
        'sc.school_id as schoolId',
        's.district_id as districtId',
        'fv.engineer_id as engineerId',
      ])
      .where('ef.evidence_file_id', '=', evidenceId)
      .where('ef.is_deleted', '=', false)
      .executeTakeFirst();

    if (!row) return null;

    return {
      evidenceId: row.evidenceId,
      visitId: row.visitId,
      serviceCaseId: row.serviceCaseId,
      schoolId: row.schoolId,
      districtId: row.districtId,
      createdByUserId: row.createdByUserId ?? null,
      engineerId: row.engineerId,
    };
  }

  /**
   * Retrieves deterministic lineage for a field visit:
   * Field Visit -> Service Case -> School -> District
   */
  async getVisitLineage(visitId: string): Promise<VisitLineageInfo | null> {
    const row = await this.db
      .selectFrom('field_visits as fv')
      .innerJoin('service_cases as sc', 'sc.service_case_id', 'fv.service_case_id')
      .innerJoin('schools as s', 's.school_id', 'sc.school_id')
      .select([
        'fv.visit_id as visitId',
        'fv.service_case_id as serviceCaseId',
        'fv.engineer_id as engineerId',
        'sc.school_id as schoolId',
        's.district_id as districtId',
      ])
      .where('fv.visit_id', '=', visitId)
      .where('fv.is_deleted', '=', false)
      .executeTakeFirst();

    if (!row) return null;

    return {
      visitId: row.visitId,
      serviceCaseId: row.serviceCaseId,
      schoolId: row.schoolId,
      districtId: row.districtId,
      engineerId: row.engineerId,
    };
  }
}

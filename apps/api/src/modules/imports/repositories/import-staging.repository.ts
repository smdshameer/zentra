/**
 * ZENTRA — Import Staging Repository
 * apps/api/src/modules/imports/repositories/import-staging.repository.ts
 *
 * Handles persistence for isolated staging records before commit.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, type Transaction, type Insertable, type Selectable } from 'kysely';
import type { DatabaseSchema, ImportStagingRecordsTable } from '../../../database/database.types';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { ImportStagingRecord } from '@zentra/types';

@Injectable()
export class ImportStagingRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  async insertBatch(
    records: Insertable<ImportStagingRecordsTable>[],
    trx?: Transaction<DatabaseSchema>,
  ): Promise<void> {
    if (records.length === 0) return;
    const client = trx || this.db;

    // Batch insert in chunks of 200 for database query performance
    const chunkSize = 200;
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      await client.insertInto('import_staging_records').values(chunk).execute();
    }
  }

  async findByJobId(
    importJobId: string,
    filters: {
      page: number;
      limit: number;
      duplicateClassification?: string;
      isValid?: boolean;
      isApproved?: boolean;
    },
    trx?: Transaction<DatabaseSchema>,
  ): Promise<ImportStagingRecord[]> {
    const client = trx || this.db;

    let query = client
      .selectFrom('import_staging_records')
      .leftJoin('schools', 'schools.school_id', 'import_staging_records.resolved_school_id')
      .leftJoin('districts', 'districts.district_id', 'schools.district_id')
      .where('import_staging_records.import_job_id', '=', importJobId)
      .select([
        'import_staging_records.staging_record_id',
        'import_staging_records.import_job_id',
        'import_staging_records.row_number',
        'import_staging_records.raw_row_data',
        'import_staging_records.mapped_udise_code',
        'import_staging_records.resolved_school_id',
        'schools.school_name as school_name',
        'districts.district_name as district_name',
        'import_staging_records.mapped_external_ticket_id',
        'import_staging_records.mapped_issue_text',
        'import_staging_records.mapped_priority',
        'import_staging_records.duplicate_classification',
        'import_staging_records.duplicate_reason',
        'import_staging_records.duplicate_confidence',
        'import_staging_records.recommended_action',
        'import_staging_records.approved_by_user_id',
        'import_staging_records.approved_at',
        'import_staging_records.matched_source_complaint_id',
        'import_staging_records.committed_source_complaint_id',
        'import_staging_records.validation_error_message',
        'import_staging_records.is_approved_for_commit',
        'import_staging_records.created_at',
      ]);

    if (filters.duplicateClassification) {
      query = query.where(
        'import_staging_records.duplicate_classification',
        '=',
        filters.duplicateClassification,
      );
    }
    if (filters.isValid !== undefined) {
      if (filters.isValid) {
        query = query.where('import_staging_records.validation_error_message', 'is', null);
      } else {
        query = query.where('import_staging_records.validation_error_message', 'is not', null);
      }
    }
    if (filters.isApproved !== undefined) {
      query = query.where(
        'import_staging_records.is_approved_for_commit',
        '=',
        filters.isApproved,
      );
    }

    const offset = (filters.page - 1) * filters.limit;
    const rows = await query
      .orderBy('import_staging_records.row_number', 'asc')
      .limit(filters.limit)
      .offset(offset)
      .execute();

    return rows.map((r) => ({
      stagingRecordId: r.staging_record_id,
      importJobId: r.import_job_id,
      rowNumber: r.row_number,
      rawRowData: r.raw_row_data,
      mappedUdiseCode: r.mapped_udise_code,
      resolvedSchoolId: r.resolved_school_id,
      schoolName: r.school_name || undefined,
      districtName: r.district_name || undefined,
      mappedExternalTicketId: r.mapped_external_ticket_id,
      mappedIssueText: r.mapped_issue_text,
      mappedPriority: r.mapped_priority,
      duplicateClassification: r.duplicate_classification,
      duplicateReason: r.duplicate_reason,
      duplicateConfidence: r.duplicate_confidence !== null ? Number(r.duplicate_confidence) : null,
      recommendedAction: r.recommended_action || null,
      approvedByUserId: r.approved_by_user_id || null,
      approvedAt:
        r.approved_at instanceof Date
          ? r.approved_at.toISOString()
          : r.approved_at
            ? String(r.approved_at)
            : null,
      matchedSourceComplaintId: r.matched_source_complaint_id,
      committedSourceComplaintId: r.committed_source_complaint_id,
      validationErrorMessage: r.validation_error_message,
      isApprovedForCommit: r.is_approved_for_commit,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }

  async countByJobId(
    importJobId: string,
    filters: {
      duplicateClassification?: string;
      isValid?: boolean;
      isApproved?: boolean;
    },
    trx?: Transaction<DatabaseSchema>,
  ): Promise<number> {
    const client = trx || this.db;

    let query = client
      .selectFrom('import_staging_records')
      .where('import_job_id', '=', importJobId)
      .select((eb) => eb.fn.count<string>('staging_record_id').as('count'));

    if (filters.duplicateClassification) {
      query = query.where('duplicate_classification', '=', filters.duplicateClassification);
    }
    if (filters.isValid !== undefined) {
      if (filters.isValid) {
        query = query.where('validation_error_message', 'is', null);
      } else {
        query = query.where('validation_error_message', 'is not', null);
      }
    }
    if (filters.isApproved !== undefined) {
      query = query.where('is_approved_for_commit', '=', filters.isApproved);
    }

    const res = await query.executeTakeFirst();
    return Number(res?.count || 0);
  }

  async findApprovedForCommit(
    importJobId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<ImportStagingRecordsTable>[]> {
    const client = trx || this.db;
    return await client
      .selectFrom('import_staging_records')
      .where('import_job_id', '=', importJobId)
      .where('is_approved_for_commit', '=', true)
      .where('approved_by_user_id', 'is not', null)
      .where('validation_error_message', 'is', null)
      .selectAll()
      .orderBy('row_number', 'asc')
      .execute();
  }

  async setApprovalStatus(
    importJobId: string,
    isApproved: boolean,
    approvedByUserId?: string,
    recordIds?: string[],
    trx?: Transaction<DatabaseSchema>,
  ): Promise<void> {
    const client = trx || this.db;
    let query = client
      .updateTable('import_staging_records')
      .set({
        is_approved_for_commit: isApproved,
        approved_by_user_id: isApproved ? approvedByUserId || null : null,
        approved_at: isApproved ? new Date() : null,
      })
      .where('import_job_id', '=', importJobId);

    if (recordIds && recordIds.length > 0) {
      query = query.where('staging_record_id', 'in', recordIds);
    }

    await query.execute();
  }

  async markCommitted(
    stagingRecordId: string,
    sourceComplaintId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<void> {
    const client = trx || this.db;
    await client
      .updateTable('import_staging_records')
      .set({ committed_source_complaint_id: sourceComplaintId })
      .where('staging_record_id', '=', stagingRecordId)
      .execute();
  }

  async getStatistics(
    importJobId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<{
    total: number;
    valid: number;
    errors: number;
    duplicates: number;
    reviewRequired: number;
    approved: number;
    committed: number;
  }> {
    const client = trx || this.db;
    const records = await client
      .selectFrom('import_staging_records')
      .where('import_job_id', '=', importJobId)
      .select([
        'duplicate_classification',
        'validation_error_message',
        'is_approved_for_commit',
        'committed_source_complaint_id',
      ])
      .execute();

    let valid = 0;
    let errors = 0;
    let duplicates = 0;
    let approved = 0;
    let committed = 0;

    for (const r of records) {
      if (r.validation_error_message) {
        errors++;
      } else {
        valid++;
      }

      if (
        r.duplicate_classification === 'EXACT_SOURCE_DUPLICATE' ||
        r.duplicate_classification === 'ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT' ||
        r.duplicate_classification === 'REOPENED_POST_SERVICE_FAILURE' ||
        r.duplicate_classification === 'DUPLICATE_IN_FILE'
      ) {
        duplicates++;
      }

      if (r.is_approved_for_commit && !r.validation_error_message) {
        approved++;
      }

      if (r.committed_source_complaint_id) {
        committed++;
      }
    }

    return {
      total: records.length,
      valid,
      errors,
      duplicates,
      reviewRequired: duplicates + errors,
      approved,
      committed,
    };
  }
}

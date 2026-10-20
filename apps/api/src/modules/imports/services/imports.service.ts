/**
 * ZENTRA — Staged Ingestion & Deduplication Domain Service
 * apps/api/src/modules/imports/services/imports.service.ts
 *
 * Implements the complete two-phase ingestion lifecycle:
 * Upload/Parse -> Normalization -> 5-Tier Classification -> Staging -> Human Review -> Atomic Commit
 *
 * Enforces the Authoritative Boundary Wall:
 * Ingestion and re-imports NEVER overwrite active field service execution records.
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../database/database.types';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import { ImportJobsRepository } from '../repositories/import-jobs.repository';
import { ImportStagingRepository } from '../repositories/import-staging.repository';
import { SourceComplaintsRepository } from '../repositories/source-complaints.repository';
import { AuditEventsRepository } from '../repositories/audit-events.repository';
import { SpreadsheetParserService } from './spreadsheet-parser.service';
import { FieldMappingNormalizerService, type NormalizedRowResult } from './field-mapping-normalizer.service';
import { DuplicateClassificationEngineService } from './duplicate-classification-engine.service';
import { RlsService } from '../../auth/rls.service';
import { generateUuidV7 } from '@zentra/shared';
import type {
  CreateImportJobDto,
  QueryImportJobsDto,
  QueryStagingRecordsDto,
  ApproveStagingRecordsDto,
  CommitImportJobDto,
  RejectImportJobDto,
} from '@zentra/contracts';
import type {
  ImportJob,
  ImportStagingRecord,
  ImportJobStatistics,
  AccessTokenClaims,
  PaginationMeta,
} from '@zentra/types';

export interface ClientMetadata {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class ImportsService {
  constructor(
    @Inject(ImportJobsRepository)
    private readonly importJobsRepo: ImportJobsRepository,
    @Inject(ImportStagingRepository)
    private readonly importStagingRepo: ImportStagingRepository,
    @Inject(SourceComplaintsRepository)
    private readonly sourceComplaintsRepo: SourceComplaintsRepository,
    @Inject(AuditEventsRepository)
    private readonly auditEventsRepo: AuditEventsRepository,
    @Inject(SpreadsheetParserService)
    private readonly parser: SpreadsheetParserService,
    @Inject(FieldMappingNormalizerService)
    private readonly normalizer: FieldMappingNormalizerService,
    @Inject(DuplicateClassificationEngineService)
    private readonly duplicateEngine: DuplicateClassificationEngineService,
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
    @Inject(RlsService)
    private readonly rlsService: RlsService,
  ) {}

  /**
   * Phase 1: Intake & Parse spreadsheet into isolated Staging records.
   */
  async createJobAndIngest(
    dto: CreateImportJobDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<{ job: ImportJob; statistics: ImportJobStatistics }> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    // 1. Resolve raw buffer from base64, csvContent, or construct CSV from rows
    let fileBuffer: Buffer;
    if (dto.fileContentBase64) {
      fileBuffer = Buffer.from(dto.fileContentBase64, 'base64');
    } else if (dto.csvContent) {
      fileBuffer = Buffer.from(dto.csvContent, 'utf-8');
    } else if (dto.rows && dto.rows.length > 0) {
      // Create CSV text from raw objects
      const headers = Object.keys(dto.rows[0]!);
      const csvLines = [headers.join(',')];
      for (const row of dto.rows) {
        const line = headers
          .map((h) => {
            const val = row[h] !== undefined && row[h] !== null ? String(row[h]) : '';
            return `"${val.replace(/"/g, '""')}"`;
          })
          .join(',');
        csvLines.push(line);
      }
      fileBuffer = Buffer.from(csvLines.join('\n'), 'utf-8');
    } else {
      throw new BadRequestException('No file content or rows provided for import.');
    }

    // 2. Compute SHA-256 integrity hash for re-import detection
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const existingSameHash = await this.importJobsRepo.findByHash(fileHash);

    // 3. Resolve Complaint Source entity
    const systemCode = (dto.sourceSystemCode || 'HELPLINE').toUpperCase();
    const sourceSystem = await this.sourceComplaintsRepo.getOrCreateSource(
      systemCode,
      `${systemCode} Intake Feed`,
    );

    // 4. Parse spreadsheet safely (XLSX, XLS, or CSV)
    const parsed = this.parser.parseBuffer(fileBuffer, dto.fileName, dto.fileType);

    // 5. Create import_jobs header record
    const importJobId = generateUuidV7();
    await this.importJobsRepo.create({
      import_job_id: importJobId,
      uploaded_by_user_id: user.sub,
      source_system_id: sourceSystem.source_system_id,
      source_filename: dto.fileName,
      file_type: (dto.fileType || 'CSV').toUpperCase(),
      file_hash_sha256: fileHash,
      file_size_bytes: fileBuffer.length,
      total_rows_parsed: parsed.totalRows,
      valid_rows_count: 0,
      duplicate_rows_count: 0,
      error_rows_count: 0,
      job_status: 'PARSING',
    });

    // 6. Normalize each raw row
    const normalizedRows: NormalizedRowResult[] = [];
    for (let i = 0; i < parsed.rows.length; i++) {
      const raw = parsed.rows[i]!;
      const normalized = this.normalizer.normalizeRow(raw, i + 1, dto.columnMapping);
      normalizedRows.push(normalized);
    }

    // 7. Batch resolve schools from database using UDISE code
    const uniqueUdises = Array.from(
      new Set(normalizedRows.map((r) => r.mappedUdiseCode).filter((u): u is string => !!u)),
    );

    const schools =
      uniqueUdises.length > 0
        ? await this.db
            .selectFrom('schools')
            .where('udise_code', 'in', uniqueUdises)
            .select(['school_id', 'udise_code', 'district_id'])
            .execute()
        : [];
    const schoolMap = new Map(schools.map((s) => [s.udise_code, s]));

    // 8. Territory Scoping Check for District Coordinator on Upload
    if (activeRole === 'DISTRICT_COORDINATOR') {
      const userDistricts = await this.getUserDistricts(user.sub);
      for (const s of schools) {
        if (!userDistricts.includes(s.district_id)) {
          // Coordinator cannot ingest files targeting other districts
          await this.importJobsRepo.update(importJobId, { job_status: 'FAILED' });
          throw new ForbiddenException(
            `Unauthorized territory: imported file contains school in district not assigned to coordinator.`,
          );
        }
      }
    }

    // 9. Batch resolve existing source complaints for Exact Ticket matching
    const uniqueTickets = Array.from(
      new Set(
        normalizedRows.map((r) => r.mappedExternalTicketId).filter((t): t is string => !!t),
      ),
    );

    const existingTickets =
      uniqueTickets.length > 0
        ? await this.db
            .selectFrom('source_complaints')
            .where('source_system_id', '=', sourceSystem.source_system_id)
            .where('external_ticket_id', 'in', uniqueTickets)
            .selectAll()
            .execute()
        : [];

    const exactMatchMap = new Map(
      existingTickets.map((sc) => [
        `${sc.source_system_id}:${sc.external_ticket_id.toLowerCase()}`,
        sc,
      ]),
    );

    // 10. Batch resolve existing complaints for matched schools
    const schoolIds = Array.from(new Set(schools.map((s) => s.school_id)));
    const schoolComplaints =
      schoolIds.length > 0
        ? await this.db
            .selectFrom('source_complaints')
            .where('school_id', 'in', schoolIds)
            .selectAll()
            .execute()
        : [];

    const schoolComplaintsMap = new Map<string, typeof schoolComplaints>();
    for (const sc of schoolComplaints) {
      const list = schoolComplaintsMap.get(sc.school_id) || [];
      list.push(sc);
      schoolComplaintsMap.set(sc.school_id, list);
    }

    // 11. Run Five-Tier Duplicate Classification & Prepare Staging Records
    const seenBatchTicketKeys = new Map<string, number>();
    const seenBatchSchoolEquipmentKeys = new Map<string, number>();
    const stagingRecordsToInsert: any[] = [];

    let validRowsCount = 0;
    let duplicateRowsCount = 0;
    let errorRowsCount = 0;

    for (const row of normalizedRows) {
      let resolvedSchoolId: string | null = null;
      if (row.mappedUdiseCode && schoolMap.has(row.mappedUdiseCode)) {
        resolvedSchoolId = schoolMap.get(row.mappedUdiseCode)!.school_id;
      } else if (row.mappedUdiseCode && !schoolMap.has(row.mappedUdiseCode)) {
        // School not found in master records
        row.isValid = false;
        row.validationErrorMessage = row.validationErrorMessage
          ? `${row.validationErrorMessage}; SCHOOL_NOT_FOUND: School with UDISE '${row.mappedUdiseCode}' not found in master catalog.`
          : `SCHOOL_NOT_FOUND: School with UDISE '${row.mappedUdiseCode}' not found in master catalog.`;
      }

      const existingForSchool = resolvedSchoolId
        ? schoolComplaintsMap.get(resolvedSchoolId) || []
        : [];

      const classification = this.duplicateEngine.classifyRow(
        row,
        resolvedSchoolId,
        sourceSystem.source_system_id,
        existingForSchool,
        exactMatchMap,
        seenBatchTicketKeys,
        seenBatchSchoolEquipmentKeys,
      );

      if (row.isValid) {
        validRowsCount++;
      } else {
        errorRowsCount++;
      }

      if (
        classification.tier === 'EXACT_SOURCE_DUPLICATE' ||
        classification.tier === 'ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT' ||
        classification.tier === 'REOPENED_POST_SERVICE_FAILURE' ||
        classification.tier === 'DUPLICATE_IN_FILE'
      ) {
        duplicateRowsCount++;
      }

      // CORRECTION 1: Algorithmic classification recommendations MUST NOT be represented
      // as actual authorized human approvals. All inbound staging rows default to
      // is_approved_for_commit = false, approved_by_user_id = null, approved_at = null.
      // Authorized approval requires explicit human/admin review.
      stagingRecordsToInsert.push({
        staging_record_id: generateUuidV7(),
        import_job_id: importJobId,
        row_number: row.rowNumber,
        raw_row_data: row.rawRowData,
        mapped_udise_code: row.mappedUdiseCode,
        resolved_school_id: resolvedSchoolId,
        mapped_external_ticket_id: row.mappedExternalTicketId,
        mapped_issue_text: row.mappedIssueText,
        mapped_priority: row.mappedPriority,
        duplicate_classification: classification.tier,
        duplicate_reason: classification.reason,
        duplicate_confidence: classification.confidence,
        recommended_action: classification.recommendedAction,
        approved_by_user_id: null,
        approved_at: null,
        matched_source_complaint_id: classification.matchedEntityId || null,
        validation_error_message: row.validationErrorMessage,
        is_approved_for_commit: false,
      });
    }

    // 12. Persist staging records
    await this.importStagingRepo.insertBatch(stagingRecordsToInsert);

    // 13. Determine final import status
    const finalStatus =
      errorRowsCount > 0 || duplicateRowsCount > 0 ? 'REVIEW_REQUIRED' : 'STAGED';

    await this.importJobsRepo.update(importJobId, {
      valid_rows_count: validRowsCount,
      duplicate_rows_count: duplicateRowsCount,
      error_rows_count: errorRowsCount,
      job_status: finalStatus,
    });

    // 14. Administrative Audit Logging
    await this.auditEventsRepo.logEvent({
      actorUserId: user.sub,
      actorIpAddress: clientMeta?.ipAddress,
      actorDeviceId: clientMeta?.userAgent,
      eventCategory: 'IMPORT',
      targetEntityType: 'import_jobs',
      targetEntityId: importJobId,
      actionType: 'IMPORT_CREATED',
      preMutationState: null,
      postMutationState: {
        fileName: dto.fileName,
        totalRows: parsed.totalRows,
        validRows: validRowsCount,
        duplicateRows: duplicateRowsCount,
        errorRows: errorRowsCount,
        fileHash,
        status: finalStatus,
        isIdenticalReimport: !!existingSameHash,
      },
    });

    const updatedJob = await this.importJobsRepo.findById(importJobId);

    return {
      job: this.mapJobToDto(updatedJob!),
      statistics: {
        importJobId,
        totalRowsParsed: parsed.totalRows,
        validRowsCount,
        duplicateRowsCount,
        errorRowsCount,
        reviewRequiredCount: duplicateRowsCount + errorRowsCount,
        approvedCount: stagingRecordsToInsert.filter((r) => r.is_approved_for_commit).length,
        committedCount: 0,
      },
    };
  }

  /**
   * Retrieves single import job with security scoping.
   */
  async getImportJob(importJobId: string, user: AccessTokenClaims): Promise<ImportJob> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    return await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async () => {
        const job = await this.importJobsRepo.findById(importJobId);
        if (!job) {
          throw new NotFoundException(`Import job with ID '${importJobId}' not found.`);
        }
        return this.mapJobToDto(job);
      },
    );
  }

  /**
   * Lists import jobs with pagination and status filter under security scoping.
   */
  async listImportJobs(
    query: QueryImportJobsDto,
    user: AccessTokenClaims,
  ): Promise<{ data: ImportJob[]; meta: PaginationMeta }> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';
    const page = query.page || 1;
    const limit = query.limit || 20;

    return await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async () => {
        const [jobs, total] = await Promise.all([
          this.importJobsRepo.findAll({
            status: query.status,
            search: query.search,
            page,
            limit,
          }),
          this.importJobsRepo.count({
            status: query.status,
            search: query.search,
          }),
        ]);

        const totalPages = Math.ceil(total / limit) || 1;

        return {
          data: jobs.map((j) => this.mapJobToDto(j)),
          meta: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
          },
        };
      },
    );
  }

  /**
   * Retrieves staged records for an import job with filtering and pagination.
   */
  async getStagingRecords(
    importJobId: string,
    query: QueryStagingRecordsDto,
    user: AccessTokenClaims,
  ): Promise<{ data: ImportStagingRecord[]; meta: PaginationMeta }> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';
    const page = query.page || 1;
    const limit = query.limit || 50;

    return await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async () => {
        const job = await this.importJobsRepo.findById(importJobId);
        if (!job) {
          throw new NotFoundException(`Import job with ID '${importJobId}' not found.`);
        }

        const [records, total] = await Promise.all([
          this.importStagingRepo.findByJobId(importJobId, {
            page,
            limit,
            duplicateClassification: query.duplicateClassification,
            isValid: query.isValid,
            isApproved: query.isApproved,
          }),
          this.importStagingRepo.countByJobId(importJobId, {
            duplicateClassification: query.duplicateClassification,
            isValid: query.isValid,
            isApproved: query.isApproved,
          }),
        ]);

        const totalPages = Math.ceil(total / limit) || 1;

        return {
          data: records,
          meta: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
          },
        };
      },
    );
  }

  /**
   * Phase 2: Administrative Review & Approval.
   */
  async approveStagingRecords(
    importJobId: string,
    dto: ApproveStagingRecordsDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<{ success: boolean; message: string }> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    // RBAC: Reporting Head cannot approve/mutate
    if (activeRole === 'REPORTING_HEAD') {
      throw new ForbiddenException('Reporting Head has read-only access and cannot approve imports.');
    }
    if (activeRole !== 'MASTER_ADMIN' && activeRole !== 'DISTRICT_COORDINATOR') {
      throw new ForbiddenException('Only Master Admin and District Coordinators can approve imports.');
    }

    const job = await this.importJobsRepo.findById(importJobId);
    if (!job) {
      throw new NotFoundException(`Import job with ID '${importJobId}' not found.`);
    }

    if (job.job_status === 'COMMITTED') {
      throw new BadRequestException('Cannot modify approval on an already COMMITTED import job.');
    }

    // Territory scoping check for coordinator
    if (activeRole === 'DISTRICT_COORDINATOR') {
      await this.verifyCoordinatorTerritoryForJob(user.sub, importJobId);
    }

    await this.importStagingRepo.setApprovalStatus(
      importJobId,
      dto.isApproved,
      user.sub,
      dto.recordIds,
    );

    // Update job status to APPROVED
    await this.importJobsRepo.update(importJobId, { job_status: 'APPROVED' });

    // Administrative Audit Logging
    await this.auditEventsRepo.logEvent({
      actorUserId: user.sub,
      actorIpAddress: clientMeta?.ipAddress,
      actorDeviceId: clientMeta?.userAgent,
      eventCategory: 'IMPORT',
      targetEntityType: 'import_jobs',
      targetEntityId: importJobId,
      actionType: 'IMPORT_APPROVED',
      preMutationState: { status: job.job_status },
      postMutationState: {
        status: 'APPROVED',
        isApproved: dto.isApproved,
        recordIds: dto.recordIds || 'ALL',
        notes: dto.notes,
      },
    });

    return {
      success: true,
      message: dto.isApproved
        ? 'Staging records approved for commit.'
        : 'Staging records disapproved.',
    };
  }

  /**
   * Phase 3: Atomic Database Transaction Commit.
   * Promotes approved staging rows to authoritative source_complaints.
   *
   * BOUNDARY WALL GUARANTEE:
   * Committing imports NEVER overwrites active field service cases, visits, or findings.
   */
  async commitImportJob(
    importJobId: string,
    dto: CommitImportJobDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<{ success: boolean; committedCount: number; jobId: string }> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    // RBAC: Reporting Head cannot commit
    if (activeRole === 'REPORTING_HEAD') {
      throw new ForbiddenException('Reporting Head has read-only access and cannot commit imports.');
    }
    if (activeRole !== 'MASTER_ADMIN' && activeRole !== 'DISTRICT_COORDINATOR') {
      throw new ForbiddenException('Only Master Admin and District Coordinators can commit imports.');
    }

    // Territory scoping check for coordinator
    if (activeRole === 'DISTRICT_COORDINATOR') {
      await this.verifyCoordinatorTerritoryForJob(user.sub, importJobId);
    }

    return await this.db.transaction().execute(async (trx) => {
      const job = await this.importJobsRepo.findById(importJobId, trx);
      if (!job) {
        throw new NotFoundException(`Import job with ID '${importJobId}' not found.`);
      }

      if (job.job_status === 'COMMITTED') {
        throw new BadRequestException('Import job is already COMMITTED (Idempotent guard).');
      }

      const approvedRecords = await this.importStagingRepo.findApprovedForCommit(
        importJobId,
        trx,
      );

      if (approvedRecords.length === 0) {
        throw new BadRequestException('No approved, valid staging records found to commit.');
      }

      let committedCount = 0;

      for (const record of approvedRecords) {
        if (!record.resolved_school_id) {
          // Cannot commit record without resolved school
          continue;
        }

        const sourceSystemId = job.source_system_id!;

        if (record.duplicate_classification === 'EXACT_SOURCE_DUPLICATE') {
          // BOUNDARY WALL ENFORCEMENT:
          // Update ONLY unassigned source metadata on existing source_complaints row.
          // NEVER touch service_cases, assigned engineers, visits, or findings!
          if (record.matched_source_complaint_id) {
            await this.sourceComplaintsRepo.updateSourceMetadata(
              record.matched_source_complaint_id,
              {
                source_status: record.mapped_priority ? 'UPDATED_IN_SOURCE' : undefined,
                original_remarks: record.mapped_issue_text,
                raw_payload: record.raw_row_data,
              },
              trx,
            );
            await this.importStagingRepo.markCommitted(
              record.staging_record_id,
              record.matched_source_complaint_id,
              trx,
            );
            committedCount++;
          }
        } else {
          // Insert new source_complaints row
          const newComplaintId = generateUuidV7();
          const ticketId =
            record.mapped_external_ticket_id ||
            `INTAKE-${newComplaintId.slice(-8).toUpperCase()}`;

          // Check if this exact ticket already exists in source_complaints to prevent duplicate key error
          const existing = await this.sourceComplaintsRepo.findByExternalTicket(
            sourceSystemId,
            ticketId,
            trx,
          );

          if (existing) {
            // BOUNDARY WALL: Update source metadata only
            await this.sourceComplaintsRepo.updateSourceMetadata(
              existing.source_complaint_id,
              {
                original_remarks: record.mapped_issue_text,
                raw_payload: record.raw_row_data,
              },
              trx,
            );
            await this.importStagingRepo.markCommitted(
              record.staging_record_id,
              existing.source_complaint_id,
              trx,
            );
          } else {
            // Insert authoritative source complaint
            await this.sourceComplaintsRepo.insert(
              {
                source_complaint_id: newComplaintId,
                source_system_id: sourceSystemId,
                external_ticket_id: ticketId,
                school_id: record.resolved_school_id,
                lab_id: null,
                original_title: (record.mapped_issue_text || 'Intake Complaint').slice(0, 255),
                original_description: record.mapped_issue_text,
                registered_at: new Date(),
                source_status: 'Open',
                source_priority: record.mapped_priority || 'MEDIUM',
                source_sla_target: null,
                reported_equipment_text: null,
                reported_serial_number: null,
                reporter_name: null,
                reporter_phone: null,
                original_remarks: null,
                raw_payload: record.raw_row_data,
              },
              trx,
            );
            await this.importStagingRepo.markCommitted(
              record.staging_record_id,
              newComplaintId,
              trx,
            );
          }
          committedCount++;
        }
      }

      // Mark import job as COMMITTED
      await this.importJobsRepo.update(
        importJobId,
        {
          job_status: 'COMMITTED',
          committed_at: new Date(),
        },
        trx,
      );

      // Administrative Audit Logging
      await this.auditEventsRepo.logEvent(
        {
          actorUserId: user.sub,
          actorIpAddress: clientMeta?.ipAddress,
          actorDeviceId: clientMeta?.userAgent,
          eventCategory: 'IMPORT',
          targetEntityType: 'import_jobs',
          targetEntityId: importJobId,
          actionType: 'IMPORT_COMMITTED',
          preMutationState: { status: job.job_status },
          postMutationState: {
            status: 'COMMITTED',
            committedCount,
            notes: dto.notes,
          },
        },
        trx,
      );

      return {
        success: true,
        committedCount,
        jobId: importJobId,
      };
    });
  }

  /**
   * Rejects / aborts an import job.
   */
  async rejectImportJob(
    importJobId: string,
    dto: RejectImportJobDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<{ success: boolean; message: string }> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    if (activeRole === 'REPORTING_HEAD') {
      throw new ForbiddenException('Reporting Head has read-only access and cannot reject imports.');
    }

    const job = await this.importJobsRepo.findById(importJobId);
    if (!job) {
      throw new NotFoundException(`Import job with ID '${importJobId}' not found.`);
    }

    if (job.job_status === 'COMMITTED') {
      throw new BadRequestException('Cannot reject an already COMMITTED import job.');
    }

    await this.importStagingRepo.setApprovalStatus(importJobId, false);
    await this.importJobsRepo.update(importJobId, { job_status: 'REJECTED' });

    await this.auditEventsRepo.logEvent({
      actorUserId: user.sub,
      actorIpAddress: clientMeta?.ipAddress,
      actorDeviceId: clientMeta?.userAgent,
      eventCategory: 'IMPORT',
      targetEntityType: 'import_jobs',
      targetEntityId: importJobId,
      actionType: 'IMPORT_REJECTED',
      preMutationState: { status: job.job_status },
      postMutationState: { status: 'REJECTED', reason: dto.reason },
    });

    return {
      success: true,
      message: `Import job '${importJobId}' rejected.`,
    };
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  private async getUserDistricts(userId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('user_territory_assignments as uta')
      .select('uta.district_id')
      .where('uta.user_id', '=', userId)
      .where((eb) =>
        eb.or([eb('uta.valid_to', 'is', null), eb('uta.valid_to', '>', new Date())]),
      )
      .execute();

    return rows.map((r) => r.district_id);
  }

  private async verifyCoordinatorTerritoryForJob(
    userId: string,
    importJobId: string,
  ): Promise<void> {
    const userDistricts = await this.getUserDistricts(userId);
    const records = await this.db
      .selectFrom('import_staging_records as isr')
      .innerJoin('schools as s', 's.school_id', 'isr.resolved_school_id')
      .select('s.district_id')
      .where('isr.import_job_id', '=', importJobId)
      .execute();

    for (const r of records) {
      if (!userDistricts.includes(r.district_id)) {
        throw new ForbiddenException(
          'Unauthorized territory: import job contains records outside your assigned district.',
        );
      }
    }
  }

  private mapJobToDto(job: any): ImportJob {
    return {
      importJobId: job.import_job_id,
      uploadedByUserId: job.uploaded_by_user_id,
      sourceSystemId: job.source_system_id || null,
      sourceFilename: job.source_filename,
      fileType: job.file_type,
      fileHashSha256: job.file_hash_sha256 || null,
      fileSizeBytes: job.file_size_bytes || null,
      totalRowsParsed: Number(job.total_rows_parsed),
      validRowsCount: Number(job.valid_rows_count),
      duplicateRowsCount: Number(job.duplicate_rows_count),
      errorRowsCount: Number(job.error_rows_count),
      jobStatus: job.job_status,
      createdAt:
        job.created_at instanceof Date ? job.created_at.toISOString() : String(job.created_at),
      committedAt:
        job.committed_at instanceof Date
          ? job.committed_at.toISOString()
          : job.committed_at
            ? String(job.committed_at)
            : null,
    };
  }
}

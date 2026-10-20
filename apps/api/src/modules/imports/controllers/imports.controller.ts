/**
 * ZENTRA — Staged Ingestion & Deduplication API Controller
 * apps/api/src/modules/imports/controllers/imports.controller.ts
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ImportsService, type ClientMetadata } from '../services/imports.service';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  createImportJobSchema,
  queryImportJobsSchema,
  queryStagingRecordsSchema,
  approveStagingRecordsSchema,
  commitImportJobSchema,
  rejectImportJobSchema,
} from '@zentra/contracts';
import { generateCorrelationId } from '@zentra/shared';
import type {
  ImportJob,
  ImportStagingRecord,
  ImportJobStatistics,
  ApiResponseEnvelope,
} from '@zentra/types';

function extractClientMetadata(request: FastifyRequest): ClientMetadata {
  return {
    ipAddress: request.ip || (request.headers['x-forwarded-for'] as string) || '127.0.0.1',
    userAgent: (request.headers['user-agent'] as string) || 'unknown',
  };
}

function getCorrelationId(request: FastifyRequest): string {
  return (
    (request as unknown as { correlationId?: string }).correlationId ||
    generateCorrelationId()
  );
}

@Controller('imports')
@UseGuards(JwtAuthGuard)
export class ImportsController {
  constructor(
    @Inject(ImportsService)
    private readonly importsService: ImportsService,
  ) {}

  /**
   * Ingest spreadsheet into staging area.
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  async createImportJob(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<{ job: ImportJob; statistics: ImportJobStatistics }>> {
    const validated = createImportJobSchema.parse(body);
    const clientMeta = extractClientMetadata(request);
    const result = await this.importsService.createJobAndIngest(
      validated,
      request.user,
      clientMeta,
    );

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * List import jobs with scoping.
   */
  @Get()
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR')
  async listImportJobs(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ImportJob[]>> {
    const validated = queryImportJobsSchema.parse(query);
    const result = await this.importsService.listImportJobs(validated, request.user);

    return {
      success: true,
      data: result.data,
      meta: result.meta,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get single import job summary.
   */
  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR')
  async getImportJob(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ImportJob>> {
    const job = await this.importsService.getImportJob(id, request.user);

    return {
      success: true,
      data: job,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * List staged records for an import job.
   */
  @Get(':id/staging')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR')
  async getStagingRecords(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ImportStagingRecord[]>> {
    const validated = queryStagingRecordsSchema.parse(query);
    const result = await this.importsService.getStagingRecords(
      id,
      validated,
      request.user,
    );

    return {
      success: true,
      data: result.data,
      meta: result.meta,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * List staged rows that failed validation.
   */
  @Get(':id/errors')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR')
  async getStagingErrors(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ImportStagingRecord[]>> {
    const rawQuery = (query || {}) as Record<string, unknown>;
    const validated = queryStagingRecordsSchema.parse({
      ...rawQuery,
      isValid: 'false',
    });
    const result = await this.importsService.getStagingRecords(
      id,
      validated,
      request.user,
    );

    return {
      success: true,
      data: result.data,
      meta: result.meta,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * List staged records classified as duplicates.
   */
  @Get(':id/duplicates')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR')
  async getStagingDuplicates(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ImportStagingRecord[]>> {
    const validated = queryStagingRecordsSchema.parse(query);
    const result = await this.importsService.getStagingRecords(
      id,
      validated,
      request.user,
    );

    // Filter only duplicate classified tiers
    const duplicates = result.data.filter(
      (r) =>
        r.duplicateClassification === 'EXACT_SOURCE_DUPLICATE' ||
        r.duplicateClassification === 'ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT' ||
        r.duplicateClassification === 'REOPENED_POST_SERVICE_FAILURE' ||
        r.duplicateClassification === 'DUPLICATE_IN_FILE',
    );

    return {
      success: true,
      data: duplicates,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Approve staged records for commit.
   */
  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  async approveStagingRecords(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<{ message: string }>> {
    const validated = approveStagingRecordsSchema.parse(body);
    const clientMeta = extractClientMetadata(request);
    const result = await this.importsService.approveStagingRecords(
      id,
      validated,
      request.user,
      clientMeta,
    );

    return {
      success: true,
      data: { message: result.message },
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Atomically commit approved staged records.
   */
  @Post(':id/commit')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  async commitImportJob(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<{ committedCount: number; jobId: string }>> {
    const validated = commitImportJobSchema.parse(body);
    const clientMeta = extractClientMetadata(request);
    const result = await this.importsService.commitImportJob(
      id,
      validated,
      request.user,
      clientMeta,
    );

    return {
      success: true,
      data: { committedCount: result.committedCount, jobId: result.jobId },
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Reject import job.
   */
  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  async rejectImportJob(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<{ message: string }>> {
    const validated = rejectImportJobSchema.parse(body);
    const clientMeta = extractClientMetadata(request);
    const result = await this.importsService.rejectImportJob(
      id,
      validated,
      request.user,
      clientMeta,
    );

    return {
      success: true,
      data: { message: result.message },
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }
}

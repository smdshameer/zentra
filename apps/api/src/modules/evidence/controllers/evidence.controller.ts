/**
 * ZENTRA — Evidence Controller (Phase 14)
 * apps/api/src/modules/evidence/controllers/evidence.controller.ts
 *
 * RESTful endpoints for field evidence pipeline:
 * - Direct S3 streaming upload session preparation
 * - Cryptographic SHA-256 upload finalization
 * - Short-lived signed download URL retrieval
 * - Evidence retrieval by visit and ID
 * - Soft-deletion & tombstone lifecycle
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  createEvidenceUploadSessionSchema,
  finalizeEvidenceUploadSchema,
  evidenceQueryFiltersSchema,
} from '@zentra/contracts';
import { EvidenceService } from '../services/evidence.service';
import { generateCorrelationId } from '@zentra/shared';
import type {
  ApiResponseEnvelope,
  EvidenceFile,
  EvidenceUploadSession,
} from '@zentra/types';

function getCorrelationId(request: FastifyRequest): string {
  return (
    (request as unknown as { correlationId?: string }).correlationId ||
    generateCorrelationId()
  );
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class EvidenceController {
  constructor(
    @Inject(EvidenceService)
    private readonly evidenceService: EvidenceService,
  ) {}

  /**
   * Request a pre-signed upload session for field evidence.
   */
  @Post('evidence/upload-session')
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async createUploadSession(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EvidenceUploadSession>> {
    const validatedDto = createEvidenceUploadSessionSchema.parse(body);
    const result = await this.evidenceService.createUploadSession(
      validatedDto,
      request.user,
    );

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Finalize an uploaded evidence file after direct S3 transfer.
   */
  @Post('evidence/:evidenceId/finalize')
  @HttpCode(HttpStatus.OK)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async finalizeUpload(
    @Param('evidenceId') evidenceId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EvidenceFile>> {
    const validatedDto = finalizeEvidenceUploadSchema.parse(body || {});
    const result = await this.evidenceService.finalizeUpload(
      evidenceId,
      validatedDto,
      request.user,
    );

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Retrieve a short-lived pre-signed download/view URL for authorized evidence.
   */
  @Get('evidence/:evidenceId/download-url')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getDownloadUrl(
    @Param('evidenceId') evidenceId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<{ evidenceId: string; downloadUrl: string; expiresAt: string }>> {
    const result = await this.evidenceService.getDownloadUrl(evidenceId, request.user);

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Retrieve an evidence record by primary key.
   */
  @Get('evidence/:evidenceId')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getEvidenceById(
    @Param('evidenceId') evidenceId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EvidenceFile>> {
    const result = await this.evidenceService.getEvidenceById(evidenceId, request.user);

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * List all active evidence files for a field visit.
   */
  @Get('visits/:visitId/evidence')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async listEvidenceForVisit(
    @Param('visitId') visitId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EvidenceFile[]>> {
    const result = await this.evidenceService.listEvidenceForVisit(visitId, request.user);

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Soft-delete / tombstone an evidence record.
   */
  @Delete('evidence/:evidenceId')
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async softDeleteEvidence(
    @Param('evidenceId') evidenceId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<{ success: boolean; evidenceId: string }>> {
    const result = await this.evidenceService.softDeleteEvidence(evidenceId, request.user);

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Query evidence files with filters.
   */
  @Get('evidence')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR')
  async queryEvidence(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<{ items: EvidenceFile[]; total: number }>> {
    const validatedFilters = evidenceQueryFiltersSchema.parse(query || {});
    const result = await this.evidenceService.queryEvidence(validatedFilters, request.user);

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }
}

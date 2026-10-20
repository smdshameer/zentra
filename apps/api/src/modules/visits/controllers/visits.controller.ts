/**
 * ZENTRA — Field Visits API Controller
 * apps/api/src/modules/visits/controllers/visits.controller.ts
 *
 * RESTful endpoints for Field Visit execution and lifecycle management:
 * - Deterministic visit creation and sequencing per service case
 * - GPS proximity check-in with accuracy gating (<= 50m) and geofence verification
 * - Work initiation (IN_PROGRESS)
 * - Check-out with structured outcomes and service case lifecycle progression
 * - Visit retrieval with complete status transition history
 * - Filtered and paginated visit query endpoint
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
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  createFieldVisitSchema,
  checkInFieldVisitSchema,
  startWorkFieldVisitSchema,
  checkOutFieldVisitSchema,
  queryFieldVisitsSchema,
} from '@zentra/contracts';
import { VisitsService } from '../services/visits.service';
import { generateCorrelationId } from '@zentra/shared';
import type { ApiResponseEnvelope, FieldVisit, FieldVisitStatusHistoryEntry } from '@zentra/types';

function getCorrelationId(request: FastifyRequest): string {
  return (
    (request as unknown as { correlationId?: string }).correlationId ||
    generateCorrelationId()
  );
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class VisitsController {
  constructor(
    @Inject(VisitsService)
    private readonly visitsService: VisitsService,
  ) {}

  /**
   * Create a new field visit for a service case
   */
  @Post(['service-cases/:caseId/visits', 'visits'])
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async createVisit(
    @Param('caseId') paramCaseId: string | undefined,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<FieldVisit>> {
    const raw = typeof body === 'object' && body !== null ? { ...body } : {};
    if (paramCaseId && !('serviceCaseId' in raw)) {
      (raw as any).serviceCaseId = paramCaseId;
    }
    const validated = createFieldVisitSchema.parse(raw);
    const user = request.user;

    const created = await this.visitsService.createVisit(
      user.sub,
      user.roles,
      validated,
    );

    return {
      success: true,
      data: created,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Query visits with filters and pagination
   */
  @Get('visits')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async queryVisits(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<FieldVisit[]>> {
    const validated = queryFieldVisitsSchema.parse(query);
    const result = await this.visitsService.queryVisits(validated);

    return {
      success: true,
      data: result.items,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        hasNext: result.hasNext,
        hasPrev: result.hasPrev,
      },
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * List all visits for a specific service case
   */
  @Get('service-cases/:caseId/visits')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getVisitsForCase(
    @Param('caseId') caseId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<FieldVisit[]>> {
    const user = request.user;
    const visits = await this.visitsService.getVisitsForCase(
      caseId,
      user.sub,
      user.roles,
    );

    return {
      success: true,
      data: visits,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get single visit detail with full audit history
   */
  @Get('visits/:visitId')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getVisitById(
    @Param('visitId') visitId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<{ visit: FieldVisit; history: FieldVisitStatusHistoryEntry[] }>> {
    const user = request.user;
    const result = await this.visitsService.getVisitById(
      visitId,
      user.sub,
      user.roles,
    );

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * GPS Proximity Check-In
   */
  @Post('visits/:visitId/check-in')
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async checkIn(
    @Param('visitId') visitId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<FieldVisit>> {
    const validated = checkInFieldVisitSchema.parse(body);
    const user = request.user;

    const updated = await this.visitsService.checkIn(
      visitId,
      user.sub,
      user.roles,
      validated,
    );

    return {
      success: true,
      data: updated,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Commence on-site diagnostic & maintenance work (IN_PROGRESS)
   */
  @Post('visits/:visitId/start-work')
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async startWork(
    @Param('visitId') visitId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<FieldVisit>> {
    const validated = startWorkFieldVisitSchema.parse(body);
    const user = request.user;

    const updated = await this.visitsService.startWork(
      visitId,
      user.sub,
      user.roles,
      validated,
    );

    return {
      success: true,
      data: updated,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check-Out with structured outcome
   */
  @Post('visits/:visitId/check-out')
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async checkOut(
    @Param('visitId') visitId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<FieldVisit>> {
    const validated = checkOutFieldVisitSchema.parse(body);
    const user = request.user;

    const updated = await this.visitsService.checkOut(
      visitId,
      user.sub,
      user.roles,
      validated,
    );

    return {
      success: true,
      data: updated,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }
}

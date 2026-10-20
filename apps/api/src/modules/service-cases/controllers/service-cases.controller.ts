/**
 * ZENTRA — Service Cases API Controller
 * apps/api/src/modules/service-cases/controllers/service-cases.controller.ts
 *
 * RESTful endpoints for Service Case lifecycle management:
 * - Creation from approved complaints
 * - State machine transitions
 * - Paginated list and detailed queries
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
  ForbiddenException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  createServiceCaseSchema,
  transitionServiceCaseSchema,
  serviceCaseQuerySchema,
} from '@zentra/contracts';
import { ServiceCasesService } from '../services/service-cases.service';
import { generateCorrelationId } from '@zentra/shared';
import type { ApiResponseEnvelope, ServiceCase, ServiceCaseQueryFilters } from '@zentra/types';

function extractClientInfo(request: FastifyRequest) {
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

@Controller('service-cases')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServiceCasesController {
  constructor(
    @Inject(ServiceCasesService)
    private readonly serviceCasesService: ServiceCasesService,
  ) {}

  /**
   * Create service case from approved, committed source complaint
   */
  @Post()
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  async createCase(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ServiceCase>> {
    const validated = createServiceCaseSchema.parse(body);
    const client = extractClientInfo(request);

    const created = await this.serviceCasesService.createFromSourceComplaint({
      sourceComplaintId: validated.sourceComplaintId,
      internalPriority: validated.internalPriority,
      initialEngineerId: validated.initialEngineerId,
      actorUserId: request.user.sub,
      actorIpAddress: client.ipAddress,
      actorDeviceId: client.userAgent,
    });

    return {
      success: true,
      data: created as ServiceCase,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Query service cases with filters and role-based territory scoping
   */
  @Get()
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async listCases(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ServiceCase[]>> {
    const validated = serviceCaseQuerySchema.parse(query);
    const user = request.user;
    const isMasterOrReporting =
      user.roles.includes('MASTER_ADMIN') || user.roles.includes('REPORTING_HEAD');

    const filters: ServiceCaseQueryFilters = {
      ...validated,
    };

    // Scoping for DISTRICT_COORDINATOR: restrict to user territories unless Master Admin
    if (!isMasterOrReporting && user.roles.includes('DISTRICT_COORDINATOR')) {
      if (user.territoryDistrictIds && user.territoryDistrictIds.length > 0) {
        if (!filters.districtId) {
          filters.districtId = user.territoryDistrictIds[0];
        } else if (!user.territoryDistrictIds.includes(filters.districtId)) {
          throw new ForbiddenException('Cannot query service cases outside assigned territory');
        }
      }
    }

    // Scoping for FIELD_ENGINEER: restrict to cases assigned to this engineer
    if (!isMasterOrReporting && user.roles.includes('FIELD_ENGINEER')) {
      filters.assignedEngineerId = user.sub;
    }

    const result = await this.serviceCasesService.queryCases(filters, user);

    return {
      success: true,
      data: result.items as ServiceCase[],
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
   * Get single service case by ID with full histories and SLA metrics
   */
  @Get(':id')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getCase(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<unknown>> {
    const user = request.user;
    const serviceCase = await this.serviceCasesService.getCaseById(id, user);
    const isMasterOrReporting =
      user.roles.includes('MASTER_ADMIN') || user.roles.includes('REPORTING_HEAD');

    // Field Engineer can only view cases assigned to them
    if (
      !isMasterOrReporting &&
      user.roles.includes('FIELD_ENGINEER') &&
      serviceCase.assignedPrimaryEngineerId !== user.sub &&
      serviceCase.assignedSecondaryEngineerId !== user.sub
    ) {
      throw new ForbiddenException('Field engineers can only access assigned service cases');
    }

    return {
      success: true,
      data: serviceCase,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Execute state machine status transition
   */
  @Post(':id/transition')
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async transitionStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<unknown>> {
    const validated = transitionServiceCaseSchema.parse(body);
    const user = request.user;
    const client = extractClientInfo(request);
    const isMasterOrCoordinator =
      user.roles.includes('MASTER_ADMIN') || user.roles.includes('DISTRICT_COORDINATOR');

    const currentCase = await this.serviceCasesService.getCaseById(id, user);

    // Reopening CLOSED cases authority check:
    // Only MASTER_ADMIN possesses authority to reopen a CLOSED service case.
    if (currentCase.operationalStatus === 'CLOSED' && !user.roles.includes('MASTER_ADMIN')) {
      throw new ForbiddenException(
        'Unauthorized: Only MASTER_ADMIN possesses authority to reopen a CLOSED service case. Delegation to other roles REQUIRES CLARIFICATION.',
      );
    }

    // Field engineers can only transition their own assigned cases
    if (!isMasterOrCoordinator && user.roles.includes('FIELD_ENGINEER')) {
      if (
        currentCase.assignedPrimaryEngineerId !== user.sub &&
        currentCase.assignedSecondaryEngineerId !== user.sub
      ) {
        throw new ForbiddenException('Field engineers can only transition assigned service cases');
      }
    }

    const updated = await this.serviceCasesService.transitionStatus({
      serviceCaseId: id,
      targetStatus: validated.targetStatus,
      reason: validated.reason,
      notes: validated.notes,
      actorUserId: user.sub,
      actorIpAddress: client.ipAddress,
      actorDeviceId: client.userAgent,
    });

    return {
      success: true,
      data: updated,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }
}

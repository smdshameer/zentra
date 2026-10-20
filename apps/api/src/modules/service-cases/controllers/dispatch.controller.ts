/**
 * ZENTRA — Dispatch API Controller
 * apps/api/src/modules/service-cases/controllers/dispatch.controller.ts
 *
 * RESTful endpoints for field engineer dispatch operations:
 * - Querying eligible engineers with current workloads
 * - Assigning / reassigning engineers with territory validation
 * - Inspecting append-only assignment history ledger
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
import { assignEngineerSchema, eligibleEngineersQuerySchema } from '@zentra/contracts';
import { ServiceCasesService } from '../services/service-cases.service';
import { generateCorrelationId } from '@zentra/shared';
import type {
  ApiResponseEnvelope,
  EngineerWorkloadSummary,
  AssignmentHistoryEntry,
  ServiceCase,
} from '@zentra/types';

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

@Controller('dispatch')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DispatchController {
  constructor(
    @Inject(ServiceCasesService)
    private readonly serviceCasesService: ServiceCasesService,
  ) {}

  /**
   * Query eligible field engineers by territory with real-time active workloads and optional capacity threshold
   */
  @Get('eligible-engineers')
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  async getEligibleEngineers(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EngineerWorkloadSummary[]>> {
    const validated = eligibleEngineersQuerySchema.parse(query);

    const engineers = await this.serviceCasesService.getEligibleEngineers(
      validated.districtId,
      validated.blockId,
      validated.capacityThreshold,
    );

    return {
      success: true,
      data: engineers,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Assign or reassign engineer to a service case
   */
  @Post(':caseId/assign')
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  async assignEngineer(
    @Param('caseId') caseId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ServiceCase>> {
    const validated = assignEngineerSchema.parse(body);
    const client = extractClientInfo(request);

    const updatedCase = await this.serviceCasesService.assignEngineer({
      serviceCaseId: caseId,
      engineerId: validated.engineerId,
      assignmentRole: validated.assignmentRole,
      reassignmentReason: validated.reassignmentReason,
      isEmergencyCrossDistrict: validated.isEmergencyCrossDistrict,
      emergencyJustification: validated.emergencyJustification,
      actorUserId: request.user.sub,
      actorIpAddress: client.ipAddress,
      actorDeviceId: client.userAgent,
    });

    return {
      success: true,
      data: updatedCase as ServiceCase,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get append-only assignment history ledger for a service case
   */
  @Get(':caseId/history')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getAssignmentHistory(
    @Param('caseId') caseId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<AssignmentHistoryEntry[]>> {
    const history = await this.serviceCasesService.getAssignmentHistory(caseId, request.user);

    return {
      success: true,
      data: history,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }
}

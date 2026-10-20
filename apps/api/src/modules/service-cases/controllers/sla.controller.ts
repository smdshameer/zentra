/**
 * ZENTRA — SLA Policies API Controller
 * apps/api/src/modules/service-cases/controllers/sla.controller.ts
 *
 * RESTful endpoints for SLA policies and dynamic resolution tracking:
 * - List active SLA resolution policies
 * - Live resolution deadline and breach status evaluation
 */

import {
  Controller,
  Get,
  Param,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ServiceCasesService } from '../services/service-cases.service';
import { generateCorrelationId } from '@zentra/shared';
import type { ApiResponseEnvelope, SlaPolicy } from '@zentra/types';

function getCorrelationId(request: FastifyRequest): string {
  return (
    (request as unknown as { correlationId?: string }).correlationId ||
    generateCorrelationId()
  );
}

@Controller('sla')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SlaController {
  constructor(
    @Inject(ServiceCasesService)
    private readonly serviceCasesService: ServiceCasesService,
  ) {}

  /**
   * List active SLA policies
   */
  @Get('policies')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async listPolicies(
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<SlaPolicy[]>> {
    const policies = await this.serviceCasesService.getSlaPolicies();

    return {
      success: true,
      data: policies,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get dynamic SLA calculation and breach metrics for a specific case
   */
  @Get('calculate/:caseId')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async calculateSla(
    @Param('caseId') caseId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<unknown>> {
    const serviceCase = await this.serviceCasesService.getCaseById(caseId, request.user);

    return {
      success: true,
      data: {
        serviceCaseId: serviceCase.serviceCaseId,
        zentraCaseCode: serviceCase.zentraCaseCode,
        operationalStatus: serviceCase.operationalStatus,
        internalPriority: serviceCase.internalPriority,
        slaTargetAt: serviceCase.slaTargetAt,
        slaEvaluation: serviceCase.slaEvaluation,
      },
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }
}

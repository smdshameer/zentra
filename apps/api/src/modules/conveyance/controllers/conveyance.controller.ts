/**
 * ZENTRA — Conveyance Claims Controller (Phase 15)
 * apps/api/src/modules/conveyance/controllers/conveyance.controller.ts
 *
 * RESTful API endpoints for Conveyance Claims management:
 * - Claim submission with calculation transparency
 * - Configurable rate policies inspection
 * - Lifecycle state machine transitions (SUBMIT, REVIEW, APPROVE, REJECT, RETURN, PAY)
 * - Self-approval prevention enforcement
 * - Multi-hop territory isolation
 * - Reporting aggregates
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  createConveyanceClaimSchema,
  submitConveyanceClaimSchema,
  reviewConveyanceClaimSchema,
  approveConveyanceClaimSchema,
  rejectConveyanceClaimSchema,
  returnConveyanceClaimSchema,
  payConveyanceClaimSchema,
  conveyanceQueryFiltersSchema,
} from '@zentra/contracts';
import { ConveyanceService } from '../services/conveyance.service';
import { ConveyancePolicyService } from '../services/conveyance-policy.service';
import { generateCorrelationId } from '@zentra/shared';
import type {
  ApiResponseEnvelope,
  ConveyanceClaim,
  ConveyanceSummaryStats,
  ConveyanceCalculationBreakdown,
} from '@zentra/types';

function getCorrelationId(request: FastifyRequest): string {
  return (
    (request as unknown as { correlationId?: string }).correlationId ||
    generateCorrelationId()
  );
}

function toUserContext(user: any) {
  return {
    userId: user.sub,
    roles: user.roles || [],
    activeRole: user.activeRole,
    territoryDistrictIds: user.territoryDistrictIds || [],
    territories: user.territories || [],
  };
}

@Controller('conveyance-claims')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConveyanceController {
  constructor(
    @Inject(ConveyanceService)
    private readonly conveyanceService: ConveyanceService,
    @Inject(ConveyancePolicyService)
    private readonly policyService: ConveyancePolicyService,
  ) {}

  /**
   * Create a new conveyance claim (DRAFT / SUBMITTED)
   */
  @Post()
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async createClaim(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ConveyanceClaim>> {
    const validated = createConveyanceClaimSchema.parse(body);
    const user = toUserContext(request.user);

    const created = await this.conveyanceService.createClaim(validated, user);

    return {
      success: true,
      data: created,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Query conveyance claims with filters and pagination
   */
  @Get()
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async queryClaims(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ConveyanceClaim[]>> {
    const validated = conveyanceQueryFiltersSchema.parse(query);
    const user = toUserContext(request.user);

    const result = await this.conveyanceService.listClaims(validated, user);

    return {
      success: true,
      data: result.items,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        hasNext: result.page < result.totalPages,
        hasPrev: result.page > 1,
      },
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Conveyance claims summary stats
   */
  @Get('summary')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getSummary(
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ConveyanceSummaryStats>> {
    const user = toUserContext(request.user);

    const summary = await this.conveyanceService.getSummary(user);

    return {
      success: true,
      data: summary,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * List active conveyance rate policies
   */
  @Get('policies')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getPolicies(
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<any[]>> {
    const policies = await this.policyService.listPolicies();

    return {
      success: true,
      data: policies,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get single conveyance claim by ID with full calculation breakdown
   */
  @Get(':id')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getClaimById(
    @Param('id') claimId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<
    ApiResponseEnvelope<{
      claim: ConveyanceClaim;
      calculation: ConveyanceCalculationBreakdown;
    }>
  > {
    const user = toUserContext(request.user);

    const result = await this.conveyanceService.getClaimById(claimId, user);

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Submit conveyance claim (DRAFT -> SUBMITTED)
   */
  @Post(':id/submit')
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async submitClaim(
    @Param('id') claimId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ConveyanceClaim>> {
    const validated = submitConveyanceClaimSchema.parse(body || {});
    const user = toUserContext(request.user);

    const updated = await this.conveyanceService.submitClaim(claimId, validated, user);

    return {
      success: true,
      data: updated,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Transition claim into UNDER_REVIEW
   */
  @Post(':id/review')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR')
  async reviewClaim(
    @Param('id') claimId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ConveyanceClaim>> {
    const validated = reviewConveyanceClaimSchema.parse(body || {});
    const user = toUserContext(request.user);

    const updated = await this.conveyanceService.reviewClaim(claimId, validated, user);

    return {
      success: true,
      data: updated,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Approve claim (UNDER_REVIEW / SUBMITTED -> APPROVED)
   * Enforces self-approval prohibition.
   */
  @Post(':id/approve')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR')
  async approveClaim(
    @Param('id') claimId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ConveyanceClaim>> {
    const validated = approveConveyanceClaimSchema.parse(body || {});
    const user = toUserContext(request.user);

    const updated = await this.conveyanceService.approveClaim(claimId, validated, user);

    return {
      success: true,
      data: updated,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Reject claim
   */
  @Post(':id/reject')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR')
  async rejectClaim(
    @Param('id') claimId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ConveyanceClaim>> {
    const validated = rejectConveyanceClaimSchema.parse(body);
    const user = toUserContext(request.user);

    const updated = await this.conveyanceService.rejectClaim(claimId, validated, user);

    return {
      success: true,
      data: updated,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Return claim for correction (RETURNED_FOR_CORRECTION)
   */
  @Post(':id/return')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR')
  async returnClaim(
    @Param('id') claimId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ConveyanceClaim>> {
    const validated = returnConveyanceClaimSchema.parse(body);
    const user = toUserContext(request.user);

    const updated = await this.conveyanceService.returnClaimForCorrection(claimId, validated, user);

    return {
      success: true,
      data: updated,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Mark claim as PAID
   */
  @Post(':id/pay')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD')
  async payClaim(
    @Param('id') claimId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<ConveyanceClaim>> {
    const validated = payConveyanceClaimSchema.parse(body || {});
    const user = toUserContext(request.user);

    const updated = await this.conveyanceService.payClaim(claimId, validated, user);

    return {
      success: true,
      data: updated,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }
}

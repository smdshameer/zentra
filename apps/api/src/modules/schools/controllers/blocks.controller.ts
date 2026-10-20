/**
 * ZENTRA — Blocks API Controller
 * apps/api/src/modules/schools/controllers/blocks.controller.ts
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
import { TerritoryService } from '../services/territory.service';
import { SchoolsService } from '../services/schools.service';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { nowUtcIso, generateCorrelationId } from '@zentra/shared';
import type { Block, School, ApiResponseEnvelope, PaginationMeta } from '@zentra/types';

function getCorrelationId(request: FastifyRequest): string {
  return (
    (request as unknown as { correlationId?: string }).correlationId ||
    generateCorrelationId()
  );
}

@Controller('blocks')
@UseGuards(JwtAuthGuard)
export class BlocksController {
  constructor(
    @Inject(TerritoryService)
    private readonly territoryService: TerritoryService,
    @Inject(SchoolsService)
    private readonly schoolsService: SchoolsService,
  ) {}

  @Get(':blockId')
  async getBlockById(
    @Param('blockId') blockId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiResponseEnvelope<Block>> {
    const block = await this.territoryService.getBlockById(blockId);

    return {
      success: true,
      data: block,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Get(':blockId/schools')
  async listSchoolsByBlock(
    @Param('blockId') blockId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<School[]> & { meta: PaginationMeta }> {
    const result = await this.schoolsService.listSchools(
      { blockId, page: 1, limit: 100 },
      request.user,
    );

    return {
      success: true,
      data: result.data,
      meta: result.meta,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }
}

/**
 * ZENTRA — Districts API Controller
 * apps/api/src/modules/schools/controllers/districts.controller.ts
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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { nowUtcIso, generateCorrelationId } from '@zentra/shared';
import type { District, Block, ApiResponseEnvelope } from '@zentra/types';

function getCorrelationId(request: FastifyRequest): string {
  return (
    (request as unknown as { correlationId?: string }).correlationId ||
    generateCorrelationId()
  );
}

@Controller('districts')
@UseGuards(JwtAuthGuard)
export class DistrictsController {
  constructor(
    @Inject(TerritoryService)
    private readonly territoryService: TerritoryService,
  ) {}

  @Get()
  async listDistricts(
    @Req() request: FastifyRequest,
  ): Promise<ApiResponseEnvelope<District[]>> {
    const districts = await this.territoryService.listDistricts({ activeOnly: true });

    return {
      success: true,
      data: districts,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Get(':districtId')
  async getDistrictById(
    @Param('districtId') districtId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiResponseEnvelope<District>> {
    const district = await this.territoryService.getDistrictById(districtId);

    return {
      success: true,
      data: district,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Get(':districtId/blocks')
  async listBlocksByDistrict(
    @Param('districtId') districtId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiResponseEnvelope<Block[]>> {
    const blocks = await this.territoryService.listBlocksByDistrict(districtId, { activeOnly: true });

    return {
      success: true,
      data: blocks,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }
}

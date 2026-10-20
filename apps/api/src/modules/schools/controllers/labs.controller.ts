/**
 * ZENTRA — Hi-Tech Labs API Controller
 * apps/api/src/modules/schools/controllers/labs.controller.ts
 */

import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { LabsService } from '../services/labs.service';
import type { ClientMetadata } from '../services/schools.service';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { updateLabSchema } from '@zentra/contracts';
import { nowUtcIso, generateCorrelationId } from '@zentra/shared';
import type { HiTechLab, ApiResponseEnvelope } from '@zentra/types';

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

@Controller('labs')
@UseGuards(JwtAuthGuard)
export class LabsController {
  constructor(
    @Inject(LabsService)
    private readonly labsService: LabsService,
  ) {}

  @Get(':labId')
  async getLabById(
    @Param('labId') labId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<HiTechLab>> {
    const lab = await this.labsService.getLabById(labId, request.user);

    return {
      success: true,
      data: lab,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Put(':labId')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  async updateLab(
    @Param('labId') labId: string,
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<HiTechLab>> {
    const validatedDto = updateLabSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const updated = await this.labsService.updateLab(
      labId,
      validatedDto,
      request.user,
      clientMeta,
    );

    return {
      success: true,
      data: updated,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Delete(':labId')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  async deactivateLab(
    @Param('labId') labId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<HiTechLab>> {
    const clientMeta = extractClientMetadata(request);
    const deactivated = await this.labsService.deactivateLab(
      labId,
      request.user,
      clientMeta,
    );

    return {
      success: true,
      data: deactivated,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }
}

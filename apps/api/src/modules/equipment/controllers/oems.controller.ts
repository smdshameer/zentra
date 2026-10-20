/**
 * ZENTRA — OEM Manufacturers API Controller
 * apps/api/src/modules/equipment/controllers/oems.controller.ts
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { OemsService, type ClientMetadata } from '../services/oems.service';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { createOemSchema, updateOemSchema } from '@zentra/contracts';
import { nowUtcIso, generateCorrelationId } from '@zentra/shared';
import type { OemManufacturer, ApiResponseEnvelope } from '@zentra/types';

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

@Controller('oems')
@UseGuards(JwtAuthGuard)
export class OemsController {
  constructor(
    @Inject(OemsService)
    private readonly oemsService: OemsService,
  ) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async listOems(
    @Query('search') search: string | undefined,
    @Query('activeOnly') activeOnly: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<OemManufacturer[]>> {
    const oems = await this.oemsService.listOems({
      search,
      activeOnly: activeOnly === 'true',
    });

    return {
      success: true,
      data: oems,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Get(':oemId')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getOemById(
    @Param('oemId') oemId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<OemManufacturer>> {
    const oem = await this.oemsService.getOemById(oemId);

    return {
      success: true,
      data: oem,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN')
  async createOem(
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<OemManufacturer>> {
    const validatedDto = createOemSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const created = await this.oemsService.createOem(
      validatedDto,
      request.user,
      clientMeta,
    );

    return {
      success: true,
      data: created,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Patch(':oemId')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN')
  async updateOem(
    @Param('oemId') oemId: string,
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<OemManufacturer>> {
    const validatedDto = updateOemSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const updated = await this.oemsService.updateOem(
      oemId,
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

  @Delete(':oemId')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN')
  async deactivateOem(
    @Param('oemId') oemId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<OemManufacturer>> {
    const clientMeta = extractClientMetadata(request);
    const deactivated = await this.oemsService.deactivateOem(
      oemId,
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

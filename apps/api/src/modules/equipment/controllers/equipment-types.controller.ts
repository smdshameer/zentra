/**
 * ZENTRA — Equipment Types & Attribute Definitions API Controller
 * apps/api/src/modules/equipment/controllers/equipment-types.controller.ts
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
import { EquipmentTypesService } from '../services/equipment-types.service';
import type { ClientMetadata } from '../services/oems.service';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  createEquipmentTypeSchema,
  updateEquipmentTypeSchema,
  createAttributeDefinitionSchema,
  updateAttributeDefinitionSchema,
} from '@zentra/contracts';
import { nowUtcIso, generateCorrelationId } from '@zentra/shared';
import type {
  EquipmentType,
  EquipmentAttributeDefinition,
  ApiResponseEnvelope,
} from '@zentra/types';

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

@Controller('equipment-types')
@UseGuards(JwtAuthGuard)
export class EquipmentTypesController {
  constructor(
    @Inject(EquipmentTypesService)
    private readonly typesService: EquipmentTypesService,
  ) {}

  // ==========================================
  // Equipment Types
  // ==========================================

  @Get()
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async listTypes(
    @Query('search') search: string | undefined,
    @Query('activeOnly') activeOnly: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EquipmentType[]>> {
    const types = await this.typesService.listTypes({
      search,
      activeOnly: activeOnly === 'true',
    });

    return {
      success: true,
      data: types,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getTypeById(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EquipmentType>> {
    const type = await this.typesService.getTypeById(id);

    return {
      success: true,
      data: type,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN')
  async createType(
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EquipmentType>> {
    const validatedDto = createEquipmentTypeSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const created = await this.typesService.createType(
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

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN')
  async updateType(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EquipmentType>> {
    const validatedDto = updateEquipmentTypeSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const updated = await this.typesService.updateType(
      id,
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

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN')
  async deactivateType(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EquipmentType>> {
    const clientMeta = extractClientMetadata(request);
    const deactivated = await this.typesService.deactivateType(
      id,
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

  // ==========================================
  // Attribute Definitions
  // ==========================================

  @Get(':id/attributes')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async listAttributes(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EquipmentAttributeDefinition[]>> {
    const attributes = await this.typesService.listAttributes(id);

    return {
      success: true,
      data: attributes,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Post(':id/attributes')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN')
  async createAttribute(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EquipmentAttributeDefinition>> {
    const validatedDto = createAttributeDefinitionSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const created = await this.typesService.createAttribute(
      id,
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

  @Patch(':id/attributes/:attrId')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN')
  async updateAttribute(
    @Param('id') id: string,
    @Param('attrId') attrId: string,
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EquipmentAttributeDefinition>> {
    const validatedDto = updateAttributeDefinitionSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const updated = await this.typesService.updateAttribute(
      id,
      attrId,
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

  @Delete(':id/attributes/:attrId')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN')
  async deleteAttribute(
    @Param('id') id: string,
    @Param('attrId') attrId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<EquipmentAttributeDefinition>> {
    const clientMeta = extractClientMetadata(request);
    const deleted = await this.typesService.deleteAttribute(
      id,
      attrId,
      request.user,
      clientMeta,
    );

    return {
      success: true,
      data: deleted,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }
}

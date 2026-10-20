/**
 * ZENTRA — Lab Equipment Instances API Controller
 * apps/api/src/modules/equipment/controllers/lab-equipment.controller.ts
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { LabEquipmentService } from '../services/lab-equipment.service';
import { DynamicAttributeEngineService } from '../services/dynamic-attribute-engine.service';
import type { ClientMetadata } from '../services/oems.service';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  createEquipmentSchema,
  updateEquipmentSchema,
  equipmentQuerySchema,
  validateAttributesSchema,
} from '@zentra/contracts';
import { nowUtcIso, generateCorrelationId } from '@zentra/shared';
import type {
  LabEquipmentWithDetails,
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

@Controller('equipment')
@UseGuards(JwtAuthGuard)
export class LabEquipmentController {
  constructor(
    @Inject(LabEquipmentService)
    private readonly equipmentService: LabEquipmentService,
    @Inject(DynamicAttributeEngineService)
    private readonly attributeEngine: DynamicAttributeEngineService,
  ) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async listEquipment(
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<LabEquipmentWithDetails[]>> {
    const filters = equipmentQuerySchema.parse(request.query || {});
    const result = await this.equipmentService.listEquipment(filters, request.user);

    return {
      success: true,
      data: result.data,
      meta: result.meta,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getEquipmentById(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<LabEquipmentWithDetails>> {
    const equipment = await this.equipmentService.getEquipmentById(id, request.user);

    return {
      success: true,
      data: equipment,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async createEquipment(
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<LabEquipmentWithDetails>> {
    const validatedDto = createEquipmentSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const created = await this.equipmentService.createEquipment(
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
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async updateEquipment(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<LabEquipmentWithDetails>> {
    const validatedDto = updateEquipmentSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const updated = await this.equipmentService.updateEquipment(
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
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  async deactivateEquipment(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<LabEquipmentWithDetails>> {
    const clientMeta = extractClientMetadata(request);
    const deactivated = await this.equipmentService.deactivateEquipment(
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

  @Post('validate-attributes')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async validateAttributes(
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<{ isValid: boolean; errors: string[] }>> {
    const validatedDto = validateAttributesSchema.parse(rawBody);
    const result = await this.attributeEngine.validate(
      validatedDto.equipmentTypeId,
      validatedDto.customAttributes,
    );

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }
}

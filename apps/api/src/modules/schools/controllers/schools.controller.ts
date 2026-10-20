/**
 * ZENTRA — Schools API Controller
 * apps/api/src/modules/schools/controllers/schools.controller.ts
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SchoolsService, type ClientMetadata } from '../services/schools.service';
import { LabsService } from '../services/labs.service';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  createSchoolSchema,
  updateSchoolSchema,
  createLabSchema,
  schoolQuerySchema,
} from '@zentra/contracts';
import { nowUtcIso, generateCorrelationId } from '@zentra/shared';
import type {
  School,
  SchoolWithLabs,
  HiTechLab,
  ApiResponseEnvelope,
  PaginationMeta,
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

@Controller('schools')
@UseGuards(JwtAuthGuard)
export class SchoolsController {
  constructor(
    @Inject(SchoolsService)
    private readonly schoolsService: SchoolsService,
    @Inject(LabsService)
    private readonly labsService: LabsService,
  ) {}

  @Get()
  async listSchools(
    @Query() rawQuery: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<School[]> & { meta: PaginationMeta }> {
    const validatedQuery = schoolQuerySchema.parse(rawQuery);
    const result = await this.schoolsService.listSchools(validatedQuery, request.user);

    return {
      success: true,
      data: result.data,
      meta: result.meta,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Get(':schoolId')
  async getSchoolById(
    @Param('schoolId') schoolId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<SchoolWithLabs>> {
    const school = await this.schoolsService.getSchoolById(schoolId, request.user);

    return {
      success: true,
      data: school,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  @HttpCode(HttpStatus.CREATED)
  async createSchool(
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<School>> {
    const validatedDto = createSchoolSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const created = await this.schoolsService.createSchool(
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

  @Put(':schoolId')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  async updateSchool(
    @Param('schoolId') schoolId: string,
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<School>> {
    const validatedDto = updateSchoolSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const updated = await this.schoolsService.updateSchool(
      schoolId,
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

  @Delete(':schoolId')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  async deactivateSchool(
    @Param('schoolId') schoolId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<School>> {
    const clientMeta = extractClientMetadata(request);
    const deactivated = await this.schoolsService.deactivateSchool(
      schoolId,
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

  @Get(':schoolId/labs')
  async listLabsBySchool(
    @Param('schoolId') schoolId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<HiTechLab[]>> {
    const labs = await this.labsService.listLabsBySchool(schoolId, request.user, {
      activeOnly: true,
    });

    return {
      success: true,
      data: labs,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Post(':schoolId/labs')
  @UseGuards(RolesGuard)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR')
  @HttpCode(HttpStatus.CREATED)
  async createLab(
    @Param('schoolId') schoolId: string,
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<HiTechLab>> {
    const validatedDto = createLabSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const lab = await this.labsService.createLab(
      schoolId,
      validatedDto,
      request.user,
      clientMeta,
    );

    return {
      success: true,
      data: lab,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }
}

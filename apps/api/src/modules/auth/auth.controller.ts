/**
 * ZENTRA — Authentication & RBAC API Controller
 * apps/api/src/modules/auth/auth.controller.ts
 *
 * Implements Phase 5 Core Auth Endpoints:
 * - POST /auth/login
 * - POST /auth/refresh
 * - POST /auth/logout
 * - GET  /auth/me
 * - Demonstration endpoints for RBAC, Territory Scoping, and PostgreSQL RLS verification
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthService, type ClientMetadata } from './auth.service';
import { RlsService } from './rls.service';
import { JwtAuthGuard, type AuthenticatedRequest } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { TerritoryGuard } from './guards/territory.guard';
import { Roles } from './decorators/roles.decorator';
import { RequireTerritory } from './decorators/require-territory.decorator';
import {
  loginRequestSchema,
  type LoginResponse,
  refreshTokenRequestSchema,
  type RefreshTokenResponse,
  logoutRequestSchema,
  type UserProfileDto,
  switchRoleRequestSchema,
  type SwitchRoleResponse,
} from '@zentra/contracts';
import { nowUtcIso, generateCorrelationId } from '@zentra/shared';
import type { ApiResponseEnvelope } from '@zentra/types';

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

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(RlsService)
    private readonly rlsService: RlsService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ApiResponseEnvelope<LoginResponse>> {
    const validatedDto = loginRequestSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const result = await this.authService.login(validatedDto, clientMeta);

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ApiResponseEnvelope<RefreshTokenResponse>> {
    const validatedDto = refreshTokenRequestSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const result = await this.authService.refresh(validatedDto.refreshToken, clientMeta);

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ApiResponseEnvelope<{ loggedOut: boolean }>> {
    const validatedDto = logoutRequestSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    await this.authService.logout(validatedDto.refreshToken, clientMeta);

    return {
      success: true,
      data: { loggedOut: true },
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<UserProfileDto>> {
    const profile = await this.authService.getProfile(request.user.sub);

    return {
      success: true,
      data: profile,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  @Post('switch-role')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async switchRole(
    @Body() rawBody: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<SwitchRoleResponse>> {
    const validatedDto = switchRoleRequestSchema.parse(rawBody);
    const clientMeta = extractClientMetadata(request);
    const result = await this.authService.switchRole(
      request.user.sub,
      validatedDto.targetRole,
      clientMeta,
    );

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  // Demonstration endpoint 1: Role-Based Authorization
  @Get('demonstration/admin-only')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('MASTER_ADMIN')
  adminOnlyDemonstration(
    @Req() request: AuthenticatedRequest,
  ): ApiResponseEnvelope<{ message: string; callerRole: string }> {
    return {
      success: true,
      data: {
        message: 'Access granted: Master Admin privileged endpoint',
        callerRole: request.user.roles[0]!,
      },
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  // Demonstration endpoint 2: Multi-District Territory Scoping
  @Get('demonstration/district-scoped/:districtId')
  @UseGuards(JwtAuthGuard, RolesGuard, TerritoryGuard)
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  @RequireTerritory({ paramName: 'districtId' })
  districtScopedDemonstration(
    @Param('districtId') districtId: string,
    @Req() request: AuthenticatedRequest,
  ): ApiResponseEnvelope<{ message: string; districtId: string; userRoles: string[] }> {
    return {
      success: true,
      data: {
        message: 'Access granted: District territory authorized',
        districtId,
        userRoles: request.user.roles,
      },
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }

  // Demonstration endpoint 3: PostgreSQL Row-Level Security Execution
  @Get('demonstration/rls-schools')
  @UseGuards(JwtAuthGuard)
  async rlsSchoolsDemonstration(
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<{ visibleSchoolsCount: number; schools: unknown[] }>> {
    const activeRole = request.user.activeRole || request.user.roles[0] || '';

    const schools = await this.rlsService.withSecurityContext(
      { userId: request.user.sub, role: activeRole },
      async (trx) => {
        return await trx
          .selectFrom('schools')
          .select(['school_id', 'udise_code', 'school_name', 'district_id'])
          .execute();
      },
    );

    return {
      success: true,
      data: {
        visibleSchoolsCount: schools.length,
        schools,
      },
      correlationId: getCorrelationId(request),
      timestamp: nowUtcIso(),
    };
  }
}

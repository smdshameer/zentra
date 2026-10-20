/**
 * ZENTRA — Sync API Controller
 * apps/api/src/modules/sync/controllers/sync.controller.ts
 *
 * RESTful endpoints for delta synchronization:
 * - POST /api/v1/sync/push (Upstream idempotent mutation batch processing)
 * - GET  /api/v1/sync/delta (Downstream row-level delta streaming with opaque cursors)
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { JwtAuthGuard, type AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  syncPushRequestSchema,
  syncDeltaRequestQuerySchema,
} from '@zentra/contracts';
import { SyncPushService } from '../services/sync-push.service';
import { SyncDeltaService } from '../services/sync-delta.service';
import { generateCorrelationId } from '@zentra/shared';
import type {
  ApiResponseEnvelope,
  SyncPushResponseData,
  SyncDeltaResponseData,
} from '@zentra/types';

function extractClientInfo(request: FastifyRequest) {
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

@Controller('sync')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SyncController {
  constructor(
    @Inject(SyncPushService)
    private readonly syncPushService: SyncPushService,
    @Inject(SyncDeltaService)
    private readonly syncDeltaService: SyncDeltaService,
  ) {}

  /**
   * Pushes a batch of local client mutations for server processing, conflict arbitration, and idempotency.
   */
  @Post('push')
  @HttpCode(HttpStatus.OK)
  @Roles('MASTER_ADMIN', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async pushMutations(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<SyncPushResponseData>> {
    const validated = syncPushRequestSchema.parse(body);
    const client = extractClientInfo(request);

    const result = await this.syncPushService.processPushBatch(
      request.user.sub,
      request.user.roles,
      validated,
      client,
      request.user.activeRole,
    );

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Requests row-level delta changes and tombstones since the position represented by an opaque cursor.
   */
  @Get('delta')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getDelta(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<SyncDeltaResponseData>> {
    const validated = syncDeltaRequestQuerySchema.parse(query);

    const result = await this.syncDeltaService.fetchDelta(
      request.user.sub,
      request.user.roles,
      validated,
      request.user.activeRole,
    );

    return {
      success: true,
      data: result,
      correlationId: getCorrelationId(request),
      timestamp: new Date().toISOString(),
    };
  }
}

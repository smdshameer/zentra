/**
 * ZENTRA — Health and Readiness Controller
 * apps/api/src/modules/health/health.controller.ts
 */

import { Controller, Get, Req, Res, HttpStatus, Inject } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { nowUtcIso, generateCorrelationId } from '@zentra/shared';
import type { ApiResponse, ApiResponseEnvelope, ServiceHealthResponse } from '@zentra/types';
import { loadAppConfig } from '@zentra/config';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  private readonly config = loadAppConfig();
  private readonly startTime = Date.now();

  constructor(
    @Inject(HealthService)
    private readonly healthService: HealthService,
  ) {}

  @Get('liveness')
  getLiveness(@Req() request: FastifyRequest): ApiResponseEnvelope<ServiceHealthResponse> {
    const correlationId =
      (request as unknown as { correlationId?: string }).correlationId || generateCorrelationId();

    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    const healthData: ServiceHealthResponse = {
      status: 'ok',
      uptime: uptimeSeconds,
      timestamp: nowUtcIso(),
      version: '0.1.0',
      environment: this.config.APP_ENV,
    };

    return {
      success: true,
      data: healthData,
      correlationId,
      timestamp: nowUtcIso(),
    };
  }

  @Get('readiness')
  async getReadiness(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ApiResponse<ServiceHealthResponse>> {
    const correlationId =
      (request as unknown as { correlationId?: string }).correlationId || generateCorrelationId();

    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    const dbHealth = await this.healthService.checkDatabaseHealth();

    if (!dbHealth.isHealthy) {
      // Readiness fails when database dependency is unavailable: HTTP 503 Service Unavailable
      reply.status(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        success: false,
        error: {
          category: 'DEPENDENCY_FAILURE',
          code: 'ERR_DATABASE_UNAVAILABLE',
          message: 'Database dependency is unavailable or not ready to accept connections.',
          isRetryable: true,
        },
        correlationId,
        timestamp: nowUtcIso(),
      };
    }

    const healthData: ServiceHealthResponse = {
      status: 'ok',
      uptime: uptimeSeconds,
      timestamp: nowUtcIso(),
      version: '0.1.0',
      environment: this.config.APP_ENV,
      services: {
        api_event_loop: { status: 'ok' },
        config_registry: { status: 'ok' },
        database: { status: 'ok' },
      },
    };

    return {
      success: true,
      data: healthData,
      correlationId,
      timestamp: nowUtcIso(),
    };
  }
}

/**
 * ZENTRA — Database Dependency Health & Readiness Service
 * apps/api/src/modules/health/health.service.ts
 *
 * Implements real database dependency probing for Kubernetes/ALB readiness:
 * - Executes lightweight, non-blocking SELECT 1 probe against Kysely database pool
 * - Isolates liveness from database dependency
 * - Protects against credential and internal error leakage
 */

import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DatabaseSchema } from '../../database/database.types';
import { DATABASE_CONNECTION } from '../../database/database.connection';

export interface DatabaseHealthResult {
  isHealthy: boolean;
  latencyMs?: number;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Optional()
    @Inject(DATABASE_CONNECTION)
    private readonly db?: Kysely<DatabaseSchema>,
  ) {}

  /**
   * Executes a lightweight SELECT 1 query to confirm database pool readiness.
   * Never leaks internal SQL errors, connection strings, or credentials.
   */
  async checkDatabaseHealth(): Promise<DatabaseHealthResult> {
    if (!this.db) {
      this.logger.warn('Health check: Database connection is not available in DI context');
      return { isHealthy: false };
    }

    const start = Date.now();
    try {
      await sql`SELECT 1`.execute(this.db);
      return {
        isHealthy: true,
        latencyMs: Date.now() - start,
      };
    } catch {
      // Intentionally log generic failure without leaking connection strings or credentials
      this.logger.error('Health check: Database ping probe failed');
      return {
        isHealthy: false,
      };
    }
  }
}

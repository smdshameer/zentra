/**
 * ZENTRA — Row-Level Security (RLS) Execution Service
 * apps/api/src/modules/auth/rls.service.ts
 *
 * Implements Phase 5 PostgreSQL RLS Security Pattern:
 * - Scoped session variables via `SET LOCAL zentra.current_user_id` and `SET LOCAL zentra.current_role`
 * - Transaction isolation: SET LOCAL automatically clears upon COMMIT or ROLLBACK
 * - Guarantees zero connection-pool context leakage across concurrent requests
 * - Fail-closed: empty context defaults to zero-access on RLS-protected tables
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, Transaction, sql } from 'kysely';
import type { DatabaseSchema } from '../../database/database.types';
import { DATABASE_CONNECTION } from '../../database/database.connection';

export interface SecurityContext {
  userId?: string | null;
  role?: string | null;
}

@Injectable()
export class RlsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  /**
   * Executes a database operation within a transaction initialized with
   * user and role context for PostgreSQL Row-Level Security.
   *
   * SET LOCAL ensures parameters are strictly bound to this transaction and
   * automatically cleared upon transaction termination.
   */
  async withSecurityContext<T>(
    context: SecurityContext,
    action: (trx: Transaction<DatabaseSchema>) => Promise<T>,
  ): Promise<T> {
    return await this.db.transaction().execute(async (trx) => {
      const userId = context.userId ?? '';
      const role = context.role ?? '';

      // Ensure transaction runs under non-superuser application role so PostgreSQL enforces RLS (only switch if superuser)
      await sql`
        DO $$
        BEGIN
          IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) = true THEN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zentra_app') THEN
              PERFORM set_config('role', 'zentra_app', true);
            END IF;
          END IF;
        END $$;
      `.execute(trx);

      // Set transaction-local session variables for RLS evaluation
      await sql`SELECT set_config('zentra.current_user_id', ${userId}, true), set_config('zentra.current_role', ${role}, true)`.execute(trx);

      return await action(trx);
    });
  }

  /**
   * Helper to execute a query with unauthenticated/fail-closed context.
   */
  async withUnauthenticatedContext<T>(
    action: (trx: Transaction<DatabaseSchema>) => Promise<T>,
  ): Promise<T> {
    return this.withSecurityContext({ userId: '', role: '' }, action);
  }
}

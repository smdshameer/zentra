/**
 * ZENTRA — Idempotency Repository
 * apps/api/src/modules/sync/repositories/idempotency.repository.ts
 *
 * Persists and retrieves client operation idempotency records in PostgreSQL.
 * Guarantees that retried mutations with the same clientOperationId replay
 * the original response without executing secondary mutations.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, Transaction, type Selectable } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema, IdempotencyKeysTable } from '../../../database/database.types';

@Injectable()
export class IdempotencyRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  /**
   * Finds an existing idempotency record by clientOperationId.
   * Can execute on a scoped transaction (trx) or the global database connection.
   */
  async findKey(
    clientOperationId: string,
    executor?: Transaction<DatabaseSchema> | Kysely<DatabaseSchema>,
  ): Promise<Selectable<IdempotencyKeysTable> | null> {
    const db = executor || this.db;
    const record = await db
      .selectFrom('idempotency_keys')
      .where('client_operation_id', '=', clientOperationId)
      .selectAll()
      .executeTakeFirst();

    return record || null;
  }

  /**
   * Saves an idempotency record. Uses ON CONFLICT DO NOTHING to guarantee atomicity.
   * Can execute on a scoped transaction (trx) or the global database connection.
   */
  async saveKey(
    data: {
      clientOperationId: string;
      userId: string;
      endpoint: string;
      responseStatusCode: number;
      responseBody: Record<string, unknown>;
    },
    executor?: Transaction<DatabaseSchema> | Kysely<DatabaseSchema>,
  ): Promise<void> {
    const db = executor || this.db;
    await db
      .insertInto('idempotency_keys')
      .values({
        client_operation_id: data.clientOperationId,
        user_id: data.userId,
        endpoint: data.endpoint,
        response_status_code: data.responseStatusCode,
        response_body: data.responseBody,
      })
      .onConflict((oc) => oc.column('client_operation_id').doNothing())
      .execute();
  }
}

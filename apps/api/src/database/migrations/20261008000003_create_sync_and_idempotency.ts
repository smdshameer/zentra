/**
 * ZENTRA Database Migration: Sync and Idempotency Keys
 * 20261008000003_create_sync_and_idempotency.ts
 *
 * Implements:
 * - idempotency_keys (PostgreSQL ledger for client-operation deduplication and retry replay)
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('idempotency_keys')
    .addColumn('client_operation_id', 'uuid', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.user_id').onDelete('cascade'),
    )
    .addColumn('endpoint', 'varchar(128)', (col) => col.notNull())
    .addColumn('response_status_code', 'integer', (col) => col.notNull())
    .addColumn('response_body', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex('idx_idempotency_keys_user')
    .on('idempotency_keys')
    .column('user_id')
    .execute();

  // Add server-authoritative record version column to service_cases
  await db.schema
    .alterTable('service_cases')
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE service_cases DROP COLUMN IF EXISTS version`.execute(db);
  await db.schema.dropTable('idempotency_keys').ifExists().cascade().execute();
}

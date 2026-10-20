/**
 * ZENTRA — Kysely Database Connection Factory
 * apps/api/src/database/database.connection.ts
 */

import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from './database.types';
import { loadAppConfig } from '@zentra/config';
import { assertTestDatabaseIsSafe } from '@zentra/testing';

export const DATABASE_CONNECTION = 'DATABASE_CONNECTION';

export function createDatabaseConnection(customUrl?: string): Kysely<DatabaseSchema> {
  const config = loadAppConfig();
  const connectionString = customUrl || config.DATABASE_URL;

  // FAIL-CLOSED TEST GATE: If running in test mode, ensure the target database
  // is strictly validated as an isolated local test database before opening connection
  if (
    process.env.NODE_ENV === 'test' ||
    config.APP_ENV === 'test' ||
    process.env.APP_ENV === 'test'
  ) {
    assertTestDatabaseIsSafe(connectionString);
  }

  const pool = new Pool({
    connectionString,
    min: config.DATABASE_POOL_MIN,
    max: config.DATABASE_POOL_MAX,
  });

  const dialect = new PostgresDialect({
    pool,
  });

  return new Kysely<DatabaseSchema>({
    dialect,
  });
}

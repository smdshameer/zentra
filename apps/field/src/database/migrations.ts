/**
 * ZENTRA Field — Database Schema Migrations
 * apps/field/src/database/migrations.ts
 *
 * Tracks local database schema version migrations for WatermelonDB.
 */

import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

export const appDatabaseMigrations = schemaMigrations({
  migrations: [
    // Version 1 is baseline. Future schema migrations will be appended here.
  ],
});

/**
 * ZENTRA — Database Migration Runner
 * apps/api/src/database/migration-runner.ts
 *
 * Provides programmatic execution of Kysely migrations using both
 * explicit in-memory provider and file-system provider.
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import {
  Migrator,
  FileMigrationProvider,
  type MigrationProvider,
  type Migration,
  type MigrationResultSet,
} from 'kysely';
import { createDatabaseConnection } from './database.connection';
import { loadAppConfig } from '@zentra/config';

import * as m1 from './migrations/20261005000001_create_territory_and_schools';
import * as m2 from './migrations/20261005000002_create_equipment_master';
import * as m3 from './migrations/20261005000003_create_complaints_and_service_cases';
import * as m4 from './migrations/20261005000004_create_visits_evidence_and_findings';
import * as m5 from './migrations/20261005000005_create_governance_staging_and_audit';
import * as m6 from './migrations/20261007000001_create_auth_and_rbac';
import * as m7 from './migrations/20261007000002_create_hi_tech_labs_rls';
import * as m8 from './migrations/20261007000003_create_lab_equipment_rls';
import * as m9 from './migrations/20261008000001_create_import_staging_rls';
import * as m10 from './migrations/20261008000002_enhance_service_cases_and_dispatch';
import * as m11 from './migrations/20261008000003_create_sync_and_idempotency';
import * as m12 from './migrations/20261008000004_enhance_field_visits_and_lifecycle';
import * as m13 from './migrations/20261008000005_enhance_evidence_files_and_s3_pipeline';
import * as m14 from './migrations/20261008000006_create_conveyance_and_claims';
import * as m15 from './migrations/20261020000001_create_sync_change_ledger';

export class ExplicitMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      '20261005000001_create_territory_and_schools': m1,
      '20261005000002_create_equipment_master': m2,
      '20261005000003_create_complaints_and_service_cases': m3,
      '20261005000004_create_visits_evidence_and_findings': m4,
      '20261005000005_create_governance_staging_and_audit': m5,
      '20261007000001_create_auth_and_rbac': m6,
      '20261007000002_create_hi_tech_labs_rls': m7,
      '20261007000003_create_lab_equipment_rls': m8,
      '20261008000001_create_import_staging_rls': m9,
      '20261008000002_enhance_service_cases_and_dispatch': m10,
      '20261008000003_create_sync_and_idempotency': m11,
      '20261008000004_enhance_field_visits_and_lifecycle': m12,
      '20261008000005_enhance_evidence_files_and_s3_pipeline': m13,
      '20261008000006_create_conveyance_and_claims': m14,
      '20261020000001_create_sync_change_ledger': m15,
    };
  }
}

export function createMigrator(db = createDatabaseConnection()): Migrator {
  return new Migrator({
    db,
    provider: new ExplicitMigrationProvider(),
  });
}

export function createFileMigrator(db = createDatabaseConnection()): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });
}

export async function runMigrationsToLatest(databaseUrl?: string): Promise<MigrationResultSet> {
  if (process.env.NODE_ENV === 'test' || process.env.APP_ENV === 'test') {
    const target = databaseUrl || loadAppConfig().DATABASE_URL;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let gate: typeof import('@zentra/testing');
    try {
      gate = require('@zentra/testing/dist/production-gate.js');
    } catch {
      gate = require('@zentra/testing');
    }
    gate.assertTestDatabaseIsSafe(target);
  }
  const db = createDatabaseConnection(databaseUrl);
  const migrator = createMigrator(db);

  try {
    const result = await migrator.migrateToLatest();
    return result;
  } finally {
    await db.destroy();
  }
}

export async function rollbackLatestMigration(databaseUrl?: string): Promise<MigrationResultSet> {
  if (process.env.NODE_ENV === 'test' || process.env.APP_ENV === 'test') {
    const target = databaseUrl || loadAppConfig().DATABASE_URL;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let gate: typeof import('@zentra/testing');
    try {
      gate = require('@zentra/testing/dist/production-gate.js');
    } catch {
      gate = require('@zentra/testing');
    }
    gate.assertTestDatabaseIsSafe(target);
  }
  const db = createDatabaseConnection(databaseUrl);
  const migrator = createMigrator(db);

  try {
    const result = await migrator.migrateDown();
    return result;
  } finally {
    await db.destroy();
  }
}

export interface MigrationStatusInfo {
  name: string;
  isExecuted: boolean;
  executedAt?: Date;
}

export async function getMigrationStatus(databaseUrl?: string): Promise<{
  appliedCount: number;
  pendingCount: number;
  migrations: MigrationStatusInfo[];
}> {
  const db = createDatabaseConnection(databaseUrl);
  const migrator = createMigrator(db);
  try {
    const list = await migrator.getMigrations();
    const executed = list.filter((m) => Boolean(m.executedAt));
    const pending = list.filter((m) => !m.executedAt);
    return {
      appliedCount: executed.length,
      pendingCount: pending.length,
      migrations: list.map((m) => ({
        name: m.name,
        isExecuted: Boolean(m.executedAt),
        executedAt: m.executedAt,
      })),
    };
  } finally {
    await db.destroy();
  }
}

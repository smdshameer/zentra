/**
 * ZENTRA — Standalone Database Migration CLI
 * apps/api/src/database/cli.ts
 *
 * Standalone operational tool for inspecting, applying, and rolling back
 * Kysely migrations with fail-closed safety assertions.
 */

import { URL } from 'url';
import { Migrator, type MigrationResultSet } from 'kysely';
import { createDatabaseConnection } from './database.connection';
import { createMigrator } from './migration-runner';
import { loadAppConfig } from '@zentra/config';
import type { AppEnvironment } from '@zentra/types';

export interface CliOptions {
  command: 'migrate' | 'rollback' | 'status' | 'help';
  databaseUrl?: string;
  dryRun: boolean;
  confirmRollback?: string;
  confirmEnvironment?: string;
  help: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const rawArgs = argv.slice(2);
  let command: CliOptions['command'] = 'help';
  let databaseUrl: string | undefined;
  let dryRun = false;
  let confirmRollback: string | undefined;
  let confirmEnvironment: string | undefined;
  let help = false;

  for (const arg of rawArgs) {
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      help = true;
    } else if (arg === 'migrate' || arg === 'rollback' || arg === 'status') {
      command = arg;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--database-url=')) {
      databaseUrl = arg.substring('--database-url='.length).trim();
    } else if (arg.startsWith('--confirm-rollback=')) {
      confirmRollback = arg.substring('--confirm-rollback='.length).trim();
    } else if (arg.startsWith('--confirm-environment=')) {
      confirmEnvironment = arg.substring('--confirm-environment='.length).trim();
    }
  }

  if (help || rawArgs.length === 0) {
    command = 'help';
  }

  return { command, databaseUrl, dryRun, confirmRollback, confirmEnvironment, help };
}

export function sanitizeDatabaseUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '[INVALID_URL]';
  }
}

export const VALID_APP_ENVS = new Set<string>([
  'local',
  'test',
  'development',
  'staging',
  'production',
]);

export const VALID_NODE_ENVS = new Set<string>([
  'development',
  'test',
  'production',
]);

export function extractDatabaseName(parsed: URL): string {
  const rawPath = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const cleanPath = (rawPath.split('?')[0] ?? '').trim();

  if (!cleanPath) {
    throw new Error('FAIL-CLOSED SAFETY GATE ABORT: Target database name is missing in database URL.');
  }

  if (cleanPath.includes('/')) {
    throw new Error(
      `FAIL-CLOSED SAFETY GATE ABORT: Ambiguous database path [${parsed.pathname}]. Database URL must specify a single database name.`,
    );
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(cleanPath);
  } catch {
    throw new Error('FAIL-CLOSED SAFETY GATE ABORT: Malformed URL-encoded database name.');
  }

  const normalized = decoded.trim().toLowerCase();
  if (!normalized) {
    throw new Error('FAIL-CLOSED SAFETY GATE ABORT: Target database name is missing in database URL.');
  }

  return normalized;
}

export function resolveEffectiveEnvironment(
  options: CliOptions,
  envSource: Record<string, string | undefined> = process.env,
): { appEnv: AppEnvironment; isProductionTier: boolean; isTestTier: boolean } {
  const rawAppEnv =
    envSource.APP_ENV !== undefined && envSource.APP_ENV.trim() !== ''
      ? envSource.APP_ENV.trim().toLowerCase()
      : undefined;
  const rawNodeEnv =
    envSource.NODE_ENV !== undefined && envSource.NODE_ENV.trim() !== ''
      ? envSource.NODE_ENV.trim().toLowerCase()
      : undefined;

  // 1. Validate supported environment values fail-closed
  if (rawAppEnv !== undefined && !VALID_APP_ENVS.has(rawAppEnv)) {
    throw new Error(
      `FAIL-CLOSED SAFETY GATE ABORT: Unsupported or malformed APP_ENV "${envSource.APP_ENV}". Supported values: local, test, development, staging, production.`,
    );
  }

  if (rawNodeEnv !== undefined && !VALID_NODE_ENVS.has(rawNodeEnv)) {
    throw new Error(
      `FAIL-CLOSED SAFETY GATE ABORT: Unsupported or malformed NODE_ENV "${envSource.NODE_ENV}". Supported values: development, test, production.`,
    );
  }

  // 2. Reject conflicting environment signals on mutating commands
  const isMutating = options.command !== 'status' && !options.dryRun;

  const hasConflict =
    (rawNodeEnv === 'production' &&
      (rawAppEnv === 'local' || rawAppEnv === 'development' || rawAppEnv === 'test')) ||
    (rawAppEnv === 'production' && (rawNodeEnv === 'development' || rawNodeEnv === 'test')) ||
    (rawAppEnv === 'staging' && (rawNodeEnv === 'development' || rawNodeEnv === 'test'));

  if (hasConflict && isMutating) {
    throw new Error(
      `ENVIRONMENT_CONFLICT_SAFETY_VIOLATION: Conflicting environment signals detected (NODE_ENV="${rawNodeEnv}", APP_ENV="${rawAppEnv}"). Refusing to execute mutating database operation under ambiguous environment.`,
    );
  }

  // 3. Conservative resolution: production/staging signal cannot be downgraded to local
  if (rawAppEnv === 'production' || rawNodeEnv === 'production') {
    return { appEnv: 'production', isProductionTier: true, isTestTier: false };
  }

  if (rawAppEnv === 'staging') {
    return { appEnv: 'staging', isProductionTier: true, isTestTier: false };
  }

  if (rawAppEnv === 'test' || rawNodeEnv === 'test') {
    return { appEnv: 'test', isProductionTier: false, isTestTier: true };
  }

  const effectiveAppEnv = (rawAppEnv || 'local') as AppEnvironment;
  return { appEnv: effectiveAppEnv, isProductionTier: false, isTestTier: false };
}

export function validateCliExecution(
  options: CliOptions,
  targetUrl: string,
  envSource: Record<string, string | undefined> = process.env,
): { dbName: string; appEnv: AppEnvironment } {
  if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.trim() === '') {
    throw new Error(
      'FAIL-CLOSED SAFETY GATE ABORT: DATABASE_URL is missing or empty. Migration operations require an explicit database connection URL.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error('FAIL-CLOSED SAFETY GATE ABORT: DATABASE_URL is malformed or invalid.');
  }

  const dbName = extractDatabaseName(parsed);
  parsed.pathname = '/' + dbName;
  const normalizedTargetUrl = parsed.toString();
  const { appEnv, isProductionTier, isTestTier } = resolveEffectiveEnvironment(options, envSource);

  // 1. CANONICAL DATABASE WRITE PROTECTION (CRITICAL)
  // Canonical zentra_test database must remain 100% untouched and read-only.
  if (dbName === 'zentra_test' && options.command !== 'status' && !options.dryRun) {
    throw new Error(
      'CANONICAL_DATABASE_SAFETY_VIOLATION: Writing or mutating canonical test database "zentra_test" is strictly prohibited. Use "zentra_test_disposable" for disposable migration tests.',
    );
  }

  // 2. Test Environment Safety Gate
  if (isTestTier) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let gate: typeof import('@zentra/testing');
    try {
      gate = require('@zentra/testing/dist/production-gate.js');
    } catch {
      gate = require('@zentra/testing');
    }
    gate.assertTestDatabaseIsSafe(normalizedTargetUrl);
  }

  // 3. Staging and Production Environment Gate
  if (isProductionTier) {
    if (
      dbName === 'zentra_local' ||
      dbName.includes('dev') ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1'
    ) {
      throw new Error(
        `FAIL-CLOSED SAFETY GATE ABORT: Environment "${appEnv}" cannot target local or development databases.`,
      );
    }

    if (options.command !== 'status' && !options.dryRun) {
      if (options.confirmEnvironment !== appEnv) {
        throw new Error(
          `PRODUCTION_ENVIRONMENT_CONFIRMATION_REQUIRED: Mutating database in environment "${appEnv}" requires explicit confirmation flag '--confirm-environment=${appEnv}'.`,
        );
      }
    }
  }

  return { dbName, appEnv };
}

export function printHelp(): void {
  console.log(`
==============================================================================
 ZENTRA Database Migration CLI
==============================================================================

USAGE:
  pnpm db:migrate [options]
  pnpm db:rollback [options]
  pnpm db:status [options]

COMMANDS:
  migrate    Apply all pending migrations up to the latest registered migration
  rollback   Safely roll back the single latest applied migration (requires confirmation)
  status     Display list of all applied and pending migrations
  help       Display this usage message

OPTIONS:
  --dry-run                         Preview the migration or rollback without modifying the database
  --database-url=<url>              Override connection URL (defaults to DATABASE_URL)
  --confirm-rollback=<name>         Required confirmation token matching the latest migration name
  --confirm-environment=<env>       Required confirmation flag when executing in staging or production
  --help, -h                        Show help message

SAFETY GUARANTEES:
  • Canonical database 'zentra_test' is strictly read-only and write-protected
  • Rollback requires explicit name-matching confirmation to prevent accidental reversal
  • Staging/production environments require explicit --confirm-environment flags
  • Migration locks prevent concurrent conflicting executions
`);
}

export async function handleStatus(migrator: Migrator): Promise<{ applied: number; pending: number }> {
  const migrations = await migrator.getMigrations();
  const executed = migrations.filter((m) => Boolean(m.executedAt));
  const pending = migrations.filter((m) => !m.executedAt);

  console.log(`Migration Status (${migrations.length} registered migrations):`);
  console.log(`  Applied: ${executed.length}`);
  console.log(`  Pending: ${pending.length}\n`);

  migrations.forEach((m) => {
    const statusTag = m.executedAt
      ? `[APPLIED] (${m.executedAt.toISOString()})`
      : `[PENDING]`;
    console.log(`  ${statusTag.padEnd(38)} ${m.name}`);
  });
  console.log('');

  return { applied: executed.length, pending: pending.length };
}

export async function handleMigrate(
  migrator: Migrator,
  isDryRun: boolean,
): Promise<{ executedCount: number; results?: MigrationResultSet['results'] }> {
  const migrations = await migrator.getMigrations();
  const pending = migrations.filter((m) => !m.executedAt);

  if (pending.length === 0) {
    console.log('Database is already up to date. Zero pending migrations.\n');
    return { executedCount: 0 };
  }

  if (isDryRun) {
    console.log(`[DRY-RUN] ${pending.length} pending migration(s) would be applied:`);
    pending.forEach((m) => console.log(`  - ${m.name}`));
    console.log('');
    return { executedCount: 0 };
  }

  console.log(`Applying ${pending.length} pending migration(s)...`);
  const result = await migrator.migrateToLatest();

  if (result.results) {
    result.results.forEach((r) => {
      const mark = r.status === 'Success' ? '[APPLIED]' : `[${r.status.toUpperCase()}]`;
      console.log(`  ${mark} ${r.migrationName}`);
    });
  }

  if (result.error) {
    throw new Error(`Migration execution failed: ${result.error}`);
  }

  console.log('\nAll pending migrations applied successfully.\n');
  return { executedCount: result.results?.length ?? 0, results: result.results };
}

export async function handleRollback(
  migrator: Migrator,
  isDryRun: boolean,
  confirmRollback?: string,
): Promise<{ rolledBackMigration: string; dryRun: boolean }> {
  const migrations = await migrator.getMigrations();
  const executed = migrations.filter((m) => Boolean(m.executedAt));

  if (executed.length === 0) {
    throw new Error('No executed migrations found in database. Rollback cannot proceed.');
  }

  const latestExecuted = executed[executed.length - 1];
  if (!latestExecuted) {
    throw new Error('No executed migrations found in database. Rollback cannot proceed.');
  }

  if (!confirmRollback) {
    throw new Error(
      `ROLLBACK_SAFETY_VIOLATION: Rollback requires explicit target confirmation. Re-run with: --confirm-rollback=${latestExecuted.name}`,
    );
  }

  if (confirmRollback !== latestExecuted.name) {
    throw new Error(
      `ROLLBACK_SAFETY_VIOLATION: Confirmation mismatch. Specified target '${confirmRollback}' does not match latest executed migration '${latestExecuted.name}'.`,
    );
  }

  if (isDryRun) {
    console.log(`[DRY-RUN] Latest migration would be rolled back:`);
    console.log(`  - ${latestExecuted.name}\n`);
    return { rolledBackMigration: latestExecuted.name, dryRun: true };
  }

  console.log(`Rolling back latest migration: ${latestExecuted.name}...`);
  const result = await migrator.migrateDown();

  if (result.results) {
    result.results.forEach((r) => {
      const mark = r.status === 'Success' ? '[ROLLED_BACK]' : `[${r.status.toUpperCase()}]`;
      console.log(`  ${mark} ${r.migrationName}`);
    });
  }

  if (result.error) {
    throw new Error(`Rollback execution failed: ${result.error}`);
  }

  console.log(`\nSuccessfully rolled back: ${latestExecuted.name}\n`);
  return { rolledBackMigration: latestExecuted.name, dryRun: false };
}

export async function runCli(argv: string[]): Promise<number> {
  const options = parseCliArgs(argv);

  if (options.command === 'help') {
    printHelp();
    return 0;
  }

  const config = loadAppConfig();
  const targetUrl = options.databaseUrl || config.DATABASE_URL;

  const { dbName, appEnv } = validateCliExecution(options, targetUrl);

  const sanitizedUrl = sanitizeDatabaseUrl(targetUrl);
  console.log(`\n==============================================================================`);
  console.log(` ZENTRA Database Migration CLI`);
  console.log(` Command:     ${options.command.toUpperCase()}${options.dryRun ? ' (DRY-RUN)' : ''}`);
  console.log(` Target DB:   ${dbName} (${sanitizedUrl})`);
  console.log(` Environment: ${appEnv}`);
  console.log(`==============================================================================\n`);

  const db = createDatabaseConnection(targetUrl);
  const migrator = createMigrator(db);

  try {
    switch (options.command) {
      case 'status':
        await handleStatus(migrator);
        break;
      case 'migrate':
        await handleMigrate(migrator, options.dryRun);
        break;
      case 'rollback':
        await handleRollback(migrator, options.dryRun, options.confirmRollback);
        break;
    }
    return 0;
  } catch (err: any) {
    console.error(`\n[MIGRATION ERROR] ${err.message || err}\n`);
    return 1;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  runCli(process.argv)
    .then((code) => {
      if (code !== 0) process.exit(code);
    })
    .catch((err) => {
      console.error('Fatal CLI Error:', err);
      process.exit(1);
    });
}

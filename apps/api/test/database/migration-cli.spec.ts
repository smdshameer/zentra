/**
 * ZENTRA — Standalone Database Migration CLI Specification
 * apps/api/test/database/migration-cli.spec.ts
 *
 * Comprehensive automated test suite verifying all 10 safety and operational
 * requirements of the database migration CLI against disposable database:
 * 1. CLI help / usage output
 * 2. Missing configuration fails closed
 * 3. Invalid/prohibited environment rejected
 * 4. Canonical zentra_test write rejected fail-closed
 * 5. Status detection (applied vs pending)
 * 6. Rollback requires --confirm-rollback
 * 7. Rollback fails if --confirm-rollback does not match latest migration
 * 8. Rollback with correct confirmation succeeds
 * 9. Migrate re-applies pending migration successfully
 * 10. Migrate is idempotent
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types';
import { createDatabaseConnection } from '../../src/database/database.connection';
import {
  createMigrator,
  getMigrationStatus,
  runMigrationsToLatest,
} from '../../src/database/migration-runner';
import {
  parseCliArgs,
  sanitizeDatabaseUrl,
  validateCliExecution,
  extractDatabaseName,
  resolveEffectiveEnvironment,
  handleStatus,
  handleMigrate,
  handleRollback,
  runCli,
} from '../../src/database/cli';
import {
  setupDisposableIntegrationHarness,
  DISPOSABLE_INTEGRATION_TEST_DATABASE,
} from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  `postgresql://postgres:postgres@localhost:5432/${DISPOSABLE_INTEGRATION_TEST_DATABASE}`;

describe('ZENTRA Migration CLI & Safety Assertions', () => {
  let db: Kysely<DatabaseSchema>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;

    // Ensure disposable test database is fully migrated and initialized
    const harness = await setupDisposableIntegrationHarness(
      TEST_DB_URL,
      createDatabaseConnection,
      runMigrationsToLatest,
    );
    db = harness.db;
  });

  afterAll(async () => {
    // Ensure database is left fully migrated
    if (db) {
      const migrator = createMigrator(db);
      await migrator.migrateToLatest();
      await db.destroy();
    }
  });

  // ---------------------------------------------------------------------------
  // Case 1: CLI Help / Usage Output
  // ---------------------------------------------------------------------------
  it('Requirement 1: should parse help flags and display help with exit code 0 without DB connection', async () => {
    // 1.1 parseCliArgs variants
    expect(parseCliArgs(['node', 'cli.ts']).command).toBe('help');
    expect(parseCliArgs(['node', 'cli.ts', '--help']).help).toBe(true);
    expect(parseCliArgs(['node', 'cli.ts', '-h']).help).toBe(true);
    expect(parseCliArgs(['node', 'cli.ts', 'help']).command).toBe('help');

    // 1.2 runCli execution
    const codeNoArgs = await runCli(['node', 'cli.ts']);
    expect(codeNoArgs).toBe(0);

    const codeHelp = await runCli(['node', 'cli.ts', '--help']);
    expect(codeHelp).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Case 2: Missing Configuration & URL Parsing Fails Closed (SEC-02)
  // ---------------------------------------------------------------------------
  it('Requirement 2: should fail closed when DATABASE_URL is missing, empty, ambiguous, or malformed', () => {
    // 2.1 Empty and whitespace URLs
    expect(() =>
      validateCliExecution({ command: 'migrate', dryRun: false, help: false }, ''),
    ).toThrow(/FAIL-CLOSED SAFETY GATE ABORT: DATABASE_URL is missing or empty/);

    expect(() =>
      validateCliExecution({ command: 'status', dryRun: false, help: false }, '   '),
    ).toThrow(/FAIL-CLOSED SAFETY GATE ABORT: DATABASE_URL is missing or empty/);

    // 2.2 Malformed non-URL strings
    expect(() =>
      validateCliExecution({ command: 'migrate', dryRun: false, help: false }, 'not-a-valid-url'),
    ).toThrow(/FAIL-CLOSED SAFETY GATE ABORT: DATABASE_URL is malformed or invalid/);

    // 2.3 Missing database name path
    expect(() =>
      validateCliExecution({ command: 'migrate', dryRun: false, help: false }, 'postgresql://localhost:5432'),
    ).toThrow(/FAIL-CLOSED SAFETY GATE ABORT: Target database name is missing in database URL/);

    expect(() =>
      validateCliExecution({ command: 'migrate', dryRun: false, help: false }, 'postgresql://localhost:5432/'),
    ).toThrow(/FAIL-CLOSED SAFETY GATE ABORT: Target database name is missing in database URL/);

    expect(() =>
      validateCliExecution({ command: 'migrate', dryRun: false, help: false }, 'postgresql://localhost:5432////'),
    ).toThrow(/FAIL-CLOSED SAFETY GATE ABORT: Target database name is missing in database URL/);

    // 2.4 Ambiguous multi-segment database paths
    expect(() =>
      validateCliExecution(
        { command: 'migrate', dryRun: false, help: false },
        'postgresql://localhost:5432/zentra_test/extra_segment',
      ),
    ).toThrow(/FAIL-CLOSED SAFETY GATE ABORT: Ambiguous database path/);
  });

  // ---------------------------------------------------------------------------
  // Case 3: Environment Resolution & Conflict Detection (SEC-01)
  // ---------------------------------------------------------------------------
  it('Requirement 3: should enforce fail-closed environment resolution and reject conflicting signals (SEC-01)', () => {
    // 3.1 NODE_ENV=production with APP_ENV missing resolves to production tier
    const resNodeProdNoApp = resolveEffectiveEnvironment(
      { command: 'migrate', dryRun: false, help: false },
      { NODE_ENV: 'production' },
    );
    expect(resNodeProdNoApp.appEnv).toBe('production');
    expect(resNodeProdNoApp.isProductionTier).toBe(true);

    // In this state, localhost targets MUST fail closed
    expect(() =>
      validateCliExecution(
        { command: 'migrate', dryRun: false, help: false },
        'postgresql://postgres:postgres@localhost:5432/zentra_prod',
        { NODE_ENV: 'production' },
      ),
    ).toThrow(/cannot target local or development databases/);

    // And remote targets MUST require --confirm-environment=production
    expect(() =>
      validateCliExecution(
        { command: 'migrate', dryRun: false, help: false },
        'postgresql://user:pass@remote.rds.amazonaws.com:5432/zentra_production',
        { NODE_ENV: 'production' },
      ),
    ).toThrow(/PRODUCTION_ENVIRONMENT_CONFIRMATION_REQUIRED/);

    // 3.2 NODE_ENV=production and APP_ENV=local (Conflict)
    expect(() =>
      resolveEffectiveEnvironment(
        { command: 'migrate', dryRun: false, help: false },
        { NODE_ENV: 'production', APP_ENV: 'local' },
      ),
    ).toThrow(/ENVIRONMENT_CONFLICT_SAFETY_VIOLATION/);

    // Read-only status or dryRun does NOT throw on conflict
    const resStatusConflict = resolveEffectiveEnvironment(
      { command: 'status', dryRun: false, help: false },
      { NODE_ENV: 'production', APP_ENV: 'local' },
    );
    expect(resStatusConflict.isProductionTier).toBe(true);

    // 3.3 APP_ENV=production with NODE_ENV missing resolves to production tier
    const resAppProdNoNode = resolveEffectiveEnvironment(
      { command: 'migrate', dryRun: false, help: false },
      { APP_ENV: 'production' },
    );
    expect(resAppProdNoNode.appEnv).toBe('production');
    expect(resAppProdNoNode.isProductionTier).toBe(true);

    // 3.4 APP_ENV=production with inconsistent NODE_ENV (development / test)
    expect(() =>
      resolveEffectiveEnvironment(
        { command: 'migrate', dryRun: false, help: false },
        { APP_ENV: 'production', NODE_ENV: 'development' },
      ),
    ).toThrow(/ENVIRONMENT_CONFLICT_SAFETY_VIOLATION/);

    expect(() =>
      resolveEffectiveEnvironment(
        { command: 'rollback', dryRun: false, help: false },
        { APP_ENV: 'production', NODE_ENV: 'test' },
      ),
    ).toThrow(/ENVIRONMENT_CONFLICT_SAFETY_VIOLATION/);

    // 3.5 Malformed or unsupported environment values fail closed
    expect(() =>
      resolveEffectiveEnvironment(
        { command: 'status', dryRun: false, help: false },
        { APP_ENV: 'invalid_env_tier' },
      ),
    ).toThrow(/FAIL-CLOSED SAFETY GATE ABORT: Unsupported or malformed APP_ENV/);

    expect(() =>
      resolveEffectiveEnvironment(
        { command: 'status', dryRun: false, help: false },
        { NODE_ENV: 'invalid_node_tier' },
      ),
    ).toThrow(/FAIL-CLOSED SAFETY GATE ABORT: Unsupported or malformed NODE_ENV/);

    // 3.6 Legitimate local development workflow
    const resLocal = resolveEffectiveEnvironment(
      { command: 'migrate', dryRun: false, help: false },
      { APP_ENV: 'local', NODE_ENV: 'development' },
    );
    expect(resLocal.appEnv).toBe('local');
    expect(resLocal.isProductionTier).toBe(false);
    expect(resLocal.isTestTier).toBe(false);

    // 3.7 Legitimate disposable-test workflow
    const resTest = resolveEffectiveEnvironment(
      { command: 'migrate', dryRun: false, help: false },
      { APP_ENV: 'test', NODE_ENV: 'test' },
    );
    expect(resTest.appEnv).toBe('test');
    expect(resTest.isTestTier).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Case 4: Database URL Trailing Slash & Canonical DB Protection (SEC-02)
  // ---------------------------------------------------------------------------
  it('Requirement 4: should strictly reject any write or rollback targeting canonical zentra_test database regardless of URL variations (SEC-02)', () => {
    // 4.1 URL variants targeting canonical zentra_test
    const canonicalVariants = [
      'postgresql://postgres:postgres@localhost:5432/zentra_test',
      'postgresql://postgres:postgres@localhost:5432/zentra_test/',
      'postgresql://postgres:postgres@localhost:5432/zentra_test///',
      'postgresql://postgres:postgres@localhost:5432/Zentra_Test',
      'postgresql://postgres:postgres@localhost:5432/ZENTRA_TEST/',
      'postgresql://postgres:postgres@localhost:5432/%7Aentra_test',
      'postgresql://postgres:postgres@localhost:5432/%7Aentra_test/',
      'postgresql://postgres:postgres@localhost:5432/%5A%45%4E%54%52%41_TEST/',
    ];

    for (const url of canonicalVariants) {
      // Must correctly extract normalized dbName 'zentra_test'
      const parsed = new URL(url);
      expect(extractDatabaseName(parsed)).toBe('zentra_test');

      // Migrate must throw CANONICAL_DATABASE_SAFETY_VIOLATION
      expect(() =>
        validateCliExecution({ command: 'migrate', dryRun: false, help: false }, url),
      ).toThrow(/CANONICAL_DATABASE_SAFETY_VIOLATION/);

      // Rollback must throw CANONICAL_DATABASE_SAFETY_VIOLATION
      expect(() =>
        validateCliExecution({ command: 'rollback', dryRun: false, help: false }, url),
      ).toThrow(/CANONICAL_DATABASE_SAFETY_VIOLATION/);

      // Status and dry-run are allowed for read-only inspection
      expect(() =>
        validateCliExecution({ command: 'status', dryRun: false, help: false }, url),
      ).not.toThrow();

      expect(() =>
        validateCliExecution({ command: 'migrate', dryRun: true, help: false }, url),
      ).not.toThrow();
    }

    // 4.2 Legitimate disposable database names with trailing slashes parse cleanly
    const disposableVariants = [
      'postgresql://localhost:5432/zentra_test_disposable',
      'postgresql://localhost:5432/zentra_test_disposable/',
      'postgresql://localhost:5432/zentra_test_disposable///',
      'postgresql://localhost:5432/%7Aentra_test_disposable/',
    ];

    for (const url of disposableVariants) {
      const parsed = new URL(url);
      expect(extractDatabaseName(parsed)).toBe('zentra_test_disposable');
    }
  });

  // ---------------------------------------------------------------------------
  // Case 5: Status Detection (Applied vs Pending)
  // ---------------------------------------------------------------------------
  it('Requirement 5: should accurately detect and report applied and pending migrations', async () => {
    const status = await getMigrationStatus(TEST_DB_URL);
    expect(status.migrations.length).toBe(15);
    expect(status.appliedCount).toBe(15);
    expect(status.pendingCount).toBe(0);

    const testDb = createDatabaseConnection(TEST_DB_URL);
    const migrator = createMigrator(testDb);
    try {
      const cliStatus = await handleStatus(migrator);
      expect(cliStatus.applied).toBe(15);
      expect(cliStatus.pending).toBe(0);
    } finally {
      await testDb.destroy();
    }
  });

  // ---------------------------------------------------------------------------
  // Case 6: Rollback Requires --confirm-rollback
  // ---------------------------------------------------------------------------
  it('Requirement 6: should reject rollback when --confirm-rollback confirmation is omitted', async () => {
    const testDb = createDatabaseConnection(TEST_DB_URL);
    const migrator = createMigrator(testDb);
    try {
      await expect(handleRollback(migrator, false, undefined)).rejects.toThrow(
        /ROLLBACK_SAFETY_VIOLATION: Rollback requires explicit target confirmation/,
      );
    } finally {
      await testDb.destroy();
    }
  });

  // ---------------------------------------------------------------------------
  // Case 7: Rollback Fails if Confirmation Does Not Match Latest Migration
  // ---------------------------------------------------------------------------
  it('Requirement 7: should reject rollback if confirmation token does not match latest executed migration', async () => {
    const testDb = createDatabaseConnection(TEST_DB_URL);
    const migrator = createMigrator(testDb);
    try {
      await expect(
        handleRollback(migrator, false, 'wrong_migration_name_20261005'),
      ).rejects.toThrow(/ROLLBACK_SAFETY_VIOLATION: Confirmation mismatch/);
    } finally {
      await testDb.destroy();
    }
  });

  // ---------------------------------------------------------------------------
  // Case 8: Rollback with Correct Confirmation Succeeds
  // ---------------------------------------------------------------------------
  it('Requirement 8: should roll back the latest migration when valid confirmation is provided', async () => {
    const targetMigration = '20261020000001_create_sync_change_ledger';
    const testDb = createDatabaseConnection(TEST_DB_URL);
    const migrator = createMigrator(testDb);

    try {
      // 8.1 Perform rollback with exact confirmation token
      const result = await handleRollback(migrator, false, targetMigration);
      expect(result.rolledBackMigration).toBe(targetMigration);
      expect(result.dryRun).toBe(false);

      // 8.2 Verify migration status: 14 applied, 1 pending
      const statusAfter = await handleStatus(migrator);
      expect(statusAfter.applied).toBe(14);
      expect(statusAfter.pending).toBe(1);
    } finally {
      await testDb.destroy();
    }
  });

  // ---------------------------------------------------------------------------
  // Case 9: Migrate Re-applies Pending Migration Successfully
  // ---------------------------------------------------------------------------
  it('Requirement 9: should apply pending migrations successfully up to latest', async () => {
    const testDb = createDatabaseConnection(TEST_DB_URL);
    const migrator = createMigrator(testDb);

    try {
      // 9.1 Verify 1 pending migration exists before migrate
      const statusBefore = await handleStatus(migrator);
      expect(statusBefore.pending).toBe(1);

      // 9.2 Migrate to latest
      const result = await handleMigrate(migrator, false);
      expect(result.executedCount).toBe(1);

      // 9.3 Verify migration status: 15 applied, 0 pending
      const statusAfter = await handleStatus(migrator);
      expect(statusAfter.applied).toBe(15);
      expect(statusAfter.pending).toBe(0);
    } finally {
      await testDb.destroy();
    }
  });

  // ---------------------------------------------------------------------------
  // Case 10: Migrate is Idempotent
  // ---------------------------------------------------------------------------
  it('Requirement 10: should be idempotent when re-running migrate against an up-to-date database', async () => {
    const testDb = createDatabaseConnection(TEST_DB_URL);
    const migrator = createMigrator(testDb);

    try {
      // 10.1 Running migrate when already up-to-date should apply 0 migrations
      const result = await handleMigrate(migrator, false);
      expect(result.executedCount).toBe(0);

      // 10.2 Dry run also reports 0 executed
      const dryResult = await handleMigrate(migrator, true);
      expect(dryResult.executedCount).toBe(0);

      // 10.3 Verify status remains fully applied (15 applied, 0 pending)
      const status = await handleStatus(migrator);
      expect(status.applied).toBe(15);
      expect(status.pending).toBe(0);
    } finally {
      await testDb.destroy();
    }
  });

  // ---------------------------------------------------------------------------
  // Utility & Helper Tests
  // ---------------------------------------------------------------------------
  it('should sanitize credentials from database URLs in logging output', () => {
    const sanitized = sanitizeDatabaseUrl('postgresql://user:secretPassword123@db.example.com:5432/mydb');
    expect(sanitized).toBe('postgresql://user:***@db.example.com:5432/mydb');
    expect(sanitized).not.toContain('secretPassword123');

    const invalid = sanitizeDatabaseUrl('not_a_valid_url');
    expect(invalid).toBe('[INVALID_URL]');
  });

  it('should execute status command via runCli successfully against disposable database', async () => {
    const exitCode = await runCli([
      'node',
      'cli.ts',
      'status',
      `--database-url=${TEST_DB_URL}`,
    ]);
    expect(exitCode).toBe(0);
  });
});

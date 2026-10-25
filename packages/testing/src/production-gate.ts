/**
 * ZENTRA — Fail-Closed Production & Test Database Safety Gate
 * packages/testing/src/production-gate.ts
 *
 * Enforces an architectural circuit-breaker:
 * 1. Immediately aborts any test runner process if there is ANY indication
 *    that it is pointed to production databases, storage buckets, or cloud credentials.
 * 2. Strictly validates test database targets: rejects all remote hosts (Neon, Supabase, RDS, etc.)
 *    and mandates the dedicated local test database (zentra_test).
 * 3. Inspects URL search parameters / query strings to prevent remote redirection,
 *    host overrides, database overrides, or remote markers via query arguments (SEC-REV-02).
 * 4. Never prints credentials, passwords, or complete connection strings in logs or errors.
 */

const ALLOWED_LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

export const CANONICAL_TEST_DATABASE = 'zentra_test';
export const DISPOSABLE_INTEGRATION_TEST_DATABASE = 'zentra_test_disposable';

const ALLOWED_TEST_DATABASES = new Set([
  CANONICAL_TEST_DATABASE,
  DISPOSABLE_INTEGRATION_TEST_DATABASE,
]);

const PROHIBITED_REMOTE_MARKERS = [
  'neon.tech',
  'rds.amazonaws.com',
  'supabase.co',
  'render.com',
  'railway.app',
  'fly.io',
  'pooler',
];

/**
 * Validates a database URL specifically for database test operations
 * (connections, migrations, fixture resets, and teardowns).
 *
 * Guarantees fail-closed termination if the target is remote, shared,
 * malformed, or targets anything other than the dedicated local test database.
 */
export function assertTestDatabaseIsSafe(dbUrl: string | undefined | null): void {
  if (!dbUrl || typeof dbUrl !== 'string' || dbUrl.trim() === '') {
    throw new Error(
      'FAIL-CLOSED SAFETY GATE ABORT: Test database URL is missing or empty. Database operations require an explicit local test database.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error(
      'FAIL-CLOSED SAFETY GATE ABORT: Test database URL is malformed or invalid.',
    );
  }

  // 1. Protocol check
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'postgresql:' && protocol !== 'postgres:') {
    throw new Error(
      `FAIL-CLOSED SAFETY GATE ABORT: Prohibited database protocol [${protocol}]. Only postgresql: or postgres: is permitted.`,
    );
  }

  // 2. Prohibited remote markers in hostname
  const hostname = parsed.hostname.toLowerCase();
  for (const marker of PROHIBITED_REMOTE_MARKERS) {
    if (hostname.includes(marker)) {
      throw new Error(
        `FAIL-CLOSED SAFETY GATE ABORT: Prohibited remote host marker [${marker}] detected in test database host.`,
      );
    }
  }

  // 3. Strict local host validation
  if (!ALLOWED_LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `FAIL-CLOSED SAFETY GATE ABORT: Prohibited non-local test database host [${hostname}]. Automated database tests must execute exclusively against local test instances (localhost / 127.0.0.1).`,
    );
  }

  // 4. Database name validation
  const dbName = (parsed.pathname.replace(/^\//, '').split('?')[0] ?? '').trim().toLowerCase();
  if (!dbName) {
    throw new Error(
      'FAIL-CLOSED SAFETY GATE ABORT: Test database name is missing in database URL.',
    );
  }

  if (!ALLOWED_TEST_DATABASES.has(dbName)) {
    throw new Error(
      `FAIL-CLOSED SAFETY GATE ABORT: Prohibited test database name [${dbName}]. Only dedicated isolated test database [zentra_test] is permitted. Development, production, and shared application databases are strictly prohibited.`,
    );
  }

  // 5. Query parameters & connection driver overrides validation (SEC-REV-02)
  if (parsed.search) {
    const searchLower = parsed.search.toLowerCase();

    // 5a. Prohibited remote markers in query parameters
    for (const marker of PROHIBITED_REMOTE_MARKERS) {
      if (searchLower.includes(marker)) {
        throw new Error(
          `FAIL-CLOSED SAFETY GATE ABORT: Prohibited remote host marker [${marker}] detected in test database query parameters.`,
        );
      }
    }

    // 5b. Host and hostaddr query overrides
    const hostOverrides = parsed.searchParams.getAll('host');
    for (const h of hostOverrides) {
      const normalized = h.trim().toLowerCase();
      if (!ALLOWED_LOCAL_HOSTS.has(normalized)) {
        throw new Error(
          'FAIL-CLOSED SAFETY GATE ABORT: Prohibited non-local host override detected in test database query parameters.',
        );
      }
    }

    const hostaddrOverrides = parsed.searchParams.getAll('hostaddr');
    for (const ha of hostaddrOverrides) {
      const normalized = ha.trim().toLowerCase();
      if (!ALLOWED_LOCAL_HOSTS.has(normalized)) {
        throw new Error(
          'FAIL-CLOSED SAFETY GATE ABORT: Prohibited non-local hostaddr override detected in test database query parameters.',
        );
      }
    }

    // 5c. Target endpoint query overrides
    const endpointOverrides = parsed.searchParams.getAll('endpoint');
    for (const ep of endpointOverrides) {
      const normalized = ep.trim().toLowerCase();
      if (!ALLOWED_LOCAL_HOSTS.has(normalized)) {
        throw new Error(
          'FAIL-CLOSED SAFETY GATE ABORT: Prohibited endpoint override detected in test database query parameters.',
        );
      }
    }

    // 5d. Database name query overrides
    const dbOverrides = [
      ...parsed.searchParams.getAll('database'),
      ...parsed.searchParams.getAll('dbname'),
    ];
    for (const db of dbOverrides) {
      const normalized = db.trim().toLowerCase();
      if (!ALLOWED_TEST_DATABASES.has(normalized)) {
        throw new Error(
          `FAIL-CLOSED SAFETY GATE ABORT: Prohibited test database name override [${normalized}] detected in test database query parameters. Only dedicated isolated test database [zentra_test] is permitted.`,
        );
      }
    }

    // 5e. Port query overrides
    const portOverrides = parsed.searchParams.getAll('port');
    for (const p of portOverrides) {
      const portNum = Number(p.trim());
      if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
        throw new Error(
          'FAIL-CLOSED SAFETY GATE ABORT: Invalid port override detected in test database query parameters.',
        );
      }
    }

    // 5f. Options parameter host redirection
    const optionsOverrides = parsed.searchParams.getAll('options');
    for (const opt of optionsOverrides) {
      const optLower = opt.toLowerCase();
      if (optLower.includes('-h') || optLower.includes('host=')) {
        throw new Error(
          'FAIL-CLOSED SAFETY GATE ABORT: Host redirection via options parameter is prohibited in test database query parameters.',
        );
      }
    }
  }
}

/**
 * Returns true if the database URL passes all safety checks, false otherwise.
 */
export function isTestDatabaseUrlSafe(dbUrl: string | undefined | null): boolean {
  try {
    assertTestDatabaseIsSafe(dbUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dedicated safety guard for destructive integration tests.
 *
 * Enforces:
 * 1. Must satisfy all standard fail-closed test database protections (assertTestDatabaseIsSafe).
 * 2. Explicitly REJECTS the canonical protected reconciliation database ('zentra_test').
 * 3. Accepts ONLY the dedicated disposable test database ('zentra_test_disposable').
 * 4. Rejects all other database names, malformed URLs, and remote targets.
 */
export function assertDisposableTestDatabaseUrl(dbUrl: string | undefined | null): string {
  // First run all comprehensive test database validations (protocol, host, port, remote markers, query params)
  assertTestDatabaseIsSafe(dbUrl);

  const parsed = new URL(dbUrl!);
  const dbName = (parsed.pathname.replace(/^\//, '').split('?')[0] ?? '').trim().toLowerCase();

  if (dbName === CANONICAL_TEST_DATABASE) {
    throw new Error(
      `FAIL-CLOSED SAFETY GATE ABORT: Prohibited destructive test execution against protected canonical test database [${CANONICAL_TEST_DATABASE}]. Integration test suites with destructive cleanup hooks must target exclusively [${DISPOSABLE_INTEGRATION_TEST_DATABASE}].`,
    );
  }

  if (dbName !== DISPOSABLE_INTEGRATION_TEST_DATABASE) {
    throw new Error(
      `FAIL-CLOSED SAFETY GATE ABORT: Prohibited database name [${dbName}] for destructive integration test path. Only dedicated disposable test database [${DISPOSABLE_INTEGRATION_TEST_DATABASE}] is permitted.`,
    );
  }

  return dbName;
}

/**
 * Returns true if the database URL passes all disposable test safety checks, false otherwise.
 */
export function isDisposableTestDatabaseUrlSafe(dbUrl: string | undefined | null): boolean {
  try {
    assertDisposableTestDatabaseUrl(dbUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pre-destructive identity assertion.
 *
 * Queries or resolves SELECT current_database() on the active connection and verifies that
 * the database is strictly 'zentra_test_disposable' before allowing any destructive SQL
 * (such as TRUNCATE TABLE, DELETE, or destructive schema migrations).
 *
 * @param dbOrGetter An active database client, connection pool, Kysely-like instance, or an async getter function returning the database name.
 */
export async function assertConnectedToDisposableDatabase(
  dbOrGetter:
    | { query: (sql: string) => Promise<{ rows: Array<{ current_database?: string }> }> }
    | { executeQuery: (compiled: any) => Promise<{ rows: Array<{ current_database?: string }> }> }
    | (() => Promise<string | undefined | null>)
    | any,
): Promise<string> {
  if (!dbOrGetter) {
    throw new Error(
      'FAIL-CLOSED SAFETY GATE ABORT: Database connection or getter is required for pre-destructive identity assertion.',
    );
  }

  let currentDbName: string | undefined | null;

  try {
    if (typeof dbOrGetter === 'function') {
      currentDbName = await dbOrGetter();
    } else if (typeof dbOrGetter.query === 'function') {
      const res = await dbOrGetter.query('SELECT current_database() AS current_database');
      currentDbName = res.rows?.[0]?.current_database;
    } else if (typeof dbOrGetter.executeQuery === 'function') {
      const res = await dbOrGetter.executeQuery({
        sql: 'SELECT current_database() AS current_database',
        parameters: [],
        query: {
          kind: 'RawNode',
          parameters: [],
          sqlFragments: ['SELECT current_database() AS current_database'],
        },
      });
      currentDbName = res.rows?.[0]?.current_database;
    } else {
      throw new Error(
        'Unsupported database connection interface for pre-destructive identity assertion.',
      );
    }
  } catch (err: any) {
    throw new Error(
      `FAIL-CLOSED SAFETY GATE ABORT: Failed to verify active database identity before destructive operation: ${err.message}`,
    );
  }

  const normalized = (currentDbName ?? '').trim().toLowerCase();

  if (!normalized) {
    throw new Error(
      'FAIL-CLOSED SAFETY GATE ABORT: Current database name could not be determined. Aborting destructive operation.',
    );
  }

  if (normalized === CANONICAL_TEST_DATABASE) {
    throw new Error(
      `CRITICAL FAIL-CLOSED SAFETY ABORT: Active database connection is targeting protected canonical database [${CANONICAL_TEST_DATABASE}]! Destructive operations (TRUNCATE/DROP/DELETE) are strictly prohibited against this database.`,
    );
  }

  if (normalized !== DISPOSABLE_INTEGRATION_TEST_DATABASE) {
    throw new Error(
      `CRITICAL FAIL-CLOSED SAFETY ABORT: Active database connection is targeting [${normalized}], expected [${DISPOSABLE_INTEGRATION_TEST_DATABASE}]! Refusing to execute destructive test operations.`,
    );
  }

  return normalized;
}

export interface DisposableIntegrationHarnessConfig<T = any> {
  testDbUrl: string | undefined | null;
  /**
   * Connection factory function (e.g. createDatabaseConnection) OR an established database connection.
   */
  connection: ((url: string) => T | Promise<T>) | T;
  /**
   * Optional migration runner (e.g. runMigrationsToLatest).
   * GUARANTEE: Will ONLY execute after testDbUrl passes validation AND live connection identity is proven to be 'zentra_test_disposable'.
   */
  runMigrations?: (url: string) => Promise<{ error?: any } | void | any>;
}

export interface DisposableIntegrationHarnessResult<T = any> {
  db: T;
  dbName: string;
}

/**
 * Initializes and verifies a dedicated disposable integration test database harness.
 *
 * Enforces an architectural circuit-breaker before any migration, TRUNCATE, table deletion,
 * or fixture seeding can execute:
 * 1. Confirms test environment flags via assertTestEnvironmentIsSafe().
 * 2. Validates testDbUrl via assertDisposableTestDatabaseUrl(): rejects zentra_test, remote markers,
 *    malformed URLs, and non-disposable database names.
 * 3. Establishes or resolves the database connection.
 * 4. Queries SELECT current_database() on the live connection via assertConnectedToDisposableDatabase():
 *    fails closed with CRITICAL FAIL-CLOSED SAFETY ABORT if the connected database is zentra_test or anything
 *    other than zentra_test_disposable.
 * 5. Executes runMigrations only AFTER step 4 passes. If migrations fail, propagates the error.
 * 6. Returns the verified database instance and database name.
 */
export async function setupDisposableIntegrationHarness<T = any>(
  configOrUrl: DisposableIntegrationHarnessConfig<T> | string | undefined | null,
  connectionFactory?: ((url: string) => T | Promise<T>) | T,
  runMigrations?: (url: string) => Promise<{ error?: any } | void | any>,
): Promise<DisposableIntegrationHarnessResult<T>> {
  let testDbUrl: string | undefined | null;
  let connection: ((url: string) => T | Promise<T>) | T | undefined;
  let migrationsRunner: ((url: string) => Promise<{ error?: any } | void | any>) | undefined;

  if (typeof configOrUrl === 'object' && configOrUrl !== null && 'connection' in configOrUrl) {
    testDbUrl = configOrUrl.testDbUrl;
    connection = configOrUrl.connection;
    migrationsRunner = configOrUrl.runMigrations;
  } else {
    testDbUrl = configOrUrl as string | undefined | null;
    connection = connectionFactory;
    migrationsRunner = runMigrations;
  }

  // 1. Verify environment safety
  assertTestEnvironmentIsSafe();

  // 2. Validate URL strictly targets zentra_test_disposable
  const dbName = assertDisposableTestDatabaseUrl(testDbUrl);

  // 3. Resolve connection
  if (!connection) {
    throw new Error(
      'FAIL-CLOSED SAFETY GATE ABORT: A valid database connection or connection factory is required for disposable test harness initialization.',
    );
  }

  let db: T;
  if (typeof connection === 'function') {
    db = await (connection as (url: string) => T | Promise<T>)(testDbUrl!);
  } else {
    db = connection;
  }

  // 4. PRE-DESTRUCTIVE IDENTITY ASSERTION:
  // Live query on the active connection verifying current_database() === 'zentra_test_disposable'
  await assertConnectedToDisposableDatabase(db);

  // 5. Execute migrations ONLY after live connection identity is proven
  if (migrationsRunner) {
    const migrationResult = await migrationsRunner(testDbUrl!);
    if (
      migrationResult &&
      typeof migrationResult === 'object' &&
      'error' in migrationResult &&
      migrationResult.error
    ) {
      throw migrationResult.error;
    }
  }

  return {
    db,
    dbName,
  };
}

/**
 * Validates general test environment safety (NODE_ENV, APP_ENV, S3 buckets, and DB markers).
 * Unit tests without a database remain usable; if a test database URL is provided,
 * it is verified via assertTestDatabaseIsSafe().
 */
export function assertTestEnvironmentIsSafe(
  envOverrides?: Record<string, string | undefined>,
): void {
  const env = envOverrides || process.env;
  const nodeEnv = (env.NODE_ENV || '').toLowerCase();
  const appEnv = (env.APP_ENV || '').toLowerCase();
  const dbUrl = env.DATABASE_URL || '';
  const testDbUrl = env.TEST_DATABASE_URL || '';
  const s3Bucket = (env.S3_BUCKET_NAME || '').toLowerCase();
  const s3Endpoint = (env.S3_ENDPOINT || '').toLowerCase();

  // 1. Reject production environment flags
  if (nodeEnv === 'production' || appEnv === 'production') {
    throw new Error(
      'FAIL-CLOSED SAFETY GATE ABORT: Automated test suite cannot execute with NODE_ENV or APP_ENV set to production!',
    );
  }

  // 2. Reject staging environment flags for unit/integration test runs
  if (appEnv === 'staging') {
    throw new Error(
      'FAIL-CLOSED SAFETY GATE ABORT: Automated test suite cannot execute against STAGING environment directly!',
    );
  }

  // 3. Inspect S3 bucket and endpoint
  const dangerousStorageMarkers = ['prod', 'production', 'official', 'live'];
  for (const marker of dangerousStorageMarkers) {
    if (s3Bucket.includes(marker) || s3Endpoint.includes(marker)) {
      throw new Error(
        `FAIL-CLOSED SAFETY GATE ABORT: S3 Storage configuration contains prohibited marker [${marker}]`,
      );
    }
  }

  // 4. Inspect Database configuration
  if (testDbUrl) {
    // If TEST_DATABASE_URL is explicitly set, it must satisfy the strict test database gate
    assertTestDatabaseIsSafe(testDbUrl);
  } else if (dbUrl) {
    // If only general DATABASE_URL is set (e.g. in unit tests or local dev configs),
    // ensure it does not point to prohibited remote cloud or production targets
    const dangerousDbMarkers = [
      'prod',
      'production',
      ...PROHIBITED_REMOTE_MARKERS,
    ];
    const lowerDbUrl = dbUrl.toLowerCase();
    for (const marker of dangerousDbMarkers) {
      if (lowerDbUrl.includes(marker)) {
        throw new Error(
          `FAIL-CLOSED SAFETY GATE ABORT: Database URL contains prohibited marker [${marker}]`,
        );
      }
    }
  }
}

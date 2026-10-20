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

const ALLOWED_TEST_DATABASES = new Set(['zentra_test']);

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

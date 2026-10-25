import { describe, it, expect, vi } from 'vitest';
import {
  assertTestEnvironmentIsSafe,
  assertTestDatabaseIsSafe,
  isTestDatabaseUrlSafe,
  assertDisposableTestDatabaseUrl,
  isDisposableTestDatabaseUrlSafe,
  assertConnectedToDisposableDatabase,
  setupDisposableIntegrationHarness,
  CANONICAL_TEST_DATABASE,
  DISPOSABLE_INTEGRATION_TEST_DATABASE,
} from '../src/production-gate';

describe('Production Gate Circuit-Breaker Smoke Tests', () => {
  it('allows safe local development environment', () => {
    const safeEnv = {
      NODE_ENV: 'test',
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://zentra_dev:pass@localhost:5432/zentra_dev',
      S3_BUCKET_NAME: 'zentra-local-evidence',
    };

    expect(() => assertTestEnvironmentIsSafe(safeEnv)).not.toThrow();
  });

  it('fails closed when NODE_ENV is production', () => {
    const dangerousEnv = {
      NODE_ENV: 'production',
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://zentra_dev:pass@localhost:5432/zentra_dev',
      S3_BUCKET_NAME: 'zentra-local-evidence',
    };

    expect(() => assertTestEnvironmentIsSafe(dangerousEnv)).toThrow(
      /FAIL-CLOSED SAFETY GATE ABORT/,
    );
  });

  it('fails closed when DATABASE_URL points to AWS RDS or production marker', () => {
    const dangerousEnv = {
      NODE_ENV: 'test',
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://admin:secret@zentra-prod.rds.amazonaws.com:5432/zentra',
      S3_BUCKET_NAME: 'zentra-local-evidence',
    };

    expect(() => assertTestEnvironmentIsSafe(dangerousEnv)).toThrow(
      /Database URL contains prohibited marker/,
    );
  });

  it('fails closed when S3 bucket is production', () => {
    const dangerousEnv = {
      NODE_ENV: 'test',
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://zentra_dev:pass@localhost:5432/zentra_dev',
      S3_BUCKET_NAME: 'zentra-production-evidence',
    };

    expect(() => assertTestEnvironmentIsSafe(dangerousEnv)).toThrow(
      /S3 Storage configuration contains prohibited marker/,
    );
  });
});

describe('Database Test Safety Gate Regression Suite', () => {
  // 1. Local zentra_test connections are accepted when correctly configured
  describe('1. Valid Local Test Database Targets', () => {
    it('accepts localhost with zentra_test', () => {
      const url = 'postgresql://postgres:postgres@localhost:5432/zentra_test';
      expect(() => assertTestDatabaseIsSafe(url)).not.toThrow();
      expect(isTestDatabaseUrlSafe(url)).toBe(true);
    });

    it('accepts 127.0.0.1 with zentra_test', () => {
      const url = 'postgresql://zentra_test:secret@127.0.0.1:5432/zentra_test';
      expect(() => assertTestDatabaseIsSafe(url)).not.toThrow();
      expect(isTestDatabaseUrlSafe(url)).toBe(true);
    });

    it('accepts IPv6 ::1 with zentra_test', () => {
      const url = 'postgres://user:pass@[::1]:5432/zentra_test';
      expect(() => assertTestDatabaseIsSafe(url)).not.toThrow();
      expect(isTestDatabaseUrlSafe(url)).toBe(true);
    });
  });

  // 2. Neon and other remote database URLs are rejected
  describe('2. Remote Host Rejection (Neon, RDS, Supabase, Cloud)', () => {
    it('rejects Neon database URLs with prohibited host marker', () => {
      const neonUrl =
        'postgresql://neondb_owner:secretpass123@ep-quiet-star-12345.ap-southeast-1.aws.neon.tech:5432/zentra_test?sslmode=require';
      expect(() => assertTestDatabaseIsSafe(neonUrl)).toThrow(
        /Prohibited remote host marker \[neon\.tech\] detected/,
      );
      expect(isTestDatabaseUrlSafe(neonUrl)).toBe(false);
    });

    it('rejects AWS RDS database URLs', () => {
      const rdsUrl =
        'postgresql://admin:secretpass@my-cluster.cluster-xyz.ap-south-1.rds.amazonaws.com:5432/zentra_test';
      expect(() => assertTestDatabaseIsSafe(rdsUrl)).toThrow(
        /Prohibited remote host marker \[rds\.amazonaws\.com\] detected/,
      );
      expect(isTestDatabaseUrlSafe(rdsUrl)).toBe(false);
    });

    it('rejects Supabase database URLs', () => {
      const supabaseUrl =
        'postgresql://postgres:secretpass@db.xyzcompany.supabase.co:5432/zentra_test';
      expect(() => assertTestDatabaseIsSafe(supabaseUrl)).toThrow(
        /Prohibited remote host marker \[supabase\.co\] detected/,
      );
      expect(isTestDatabaseUrlSafe(supabaseUrl)).toBe(false);
    });

    it('rejects arbitrary remote hostnames and IPs', () => {
      const remoteDomainUrl = 'postgresql://user:pass@staging.zentra.app:5432/zentra_test';
      expect(() => assertTestDatabaseIsSafe(remoteDomainUrl)).toThrow(
        /Prohibited non-local test database host \[staging\.zentra\.app\]/,
      );

      const remoteIpUrl = 'postgresql://user:pass@192.168.1.100:5432/zentra_test';
      expect(() => assertTestDatabaseIsSafe(remoteIpUrl)).toThrow(
        /Prohibited non-local test database host \[192\.168\.1\.100\]/,
      );
    });
  });

  // 3. A missing TEST_DATABASE_URL fails safely for database integration tests
  describe('3. Missing or Empty Configuration', () => {
    it('rejects undefined database URL', () => {
      expect(() => assertTestDatabaseIsSafe(undefined)).toThrow(
        /Test database URL is missing or empty/,
      );
    });

    it('rejects null database URL', () => {
      expect(() => assertTestDatabaseIsSafe(null)).toThrow(
        /Test database URL is missing or empty/,
      );
    });

    it('rejects empty string database URL', () => {
      expect(() => assertTestDatabaseIsSafe('')).toThrow(
        /Test database URL is missing or empty/,
      );
      expect(() => assertTestDatabaseIsSafe('   ')).toThrow(
        /Test database URL is missing or empty/,
      );
    });
  });

  // 4. A database name other than the explicitly approved test database is rejected
  describe('4. Database Name Whitelist (Only zentra_test permitted)', () => {
    it('rejects local development database (zentra_local)', () => {
      const url = 'postgresql://postgres:postgres@localhost:5432/zentra_local';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited test database name \[zentra_local\]\. Only dedicated isolated test database \[zentra_test\] is permitted/,
      );
    });

    it('rejects local dev database (zentra_dev)', () => {
      const url = 'postgresql://postgres:postgres@localhost:5432/zentra_dev';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited test database name \[zentra_dev\]\. Only dedicated isolated test database \[zentra_test\] is permitted/,
      );
    });

    it('rejects default postgres catalog database', () => {
      const url = 'postgresql://postgres:postgres@localhost:5432/postgres';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited test database name \[postgres\]/,
      );
    });

    it('rejects neon default catalog database (neondb)', () => {
      const url = 'postgresql://postgres:postgres@localhost:5432/neondb';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited test database name \[neondb\]/,
      );
    });

    it('rejects production database names even on localhost', () => {
      const url = 'postgresql://postgres:postgres@localhost:5432/production';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited test database name \[production\]/,
      );
    });

    it('rejects URL with missing database name in pathname', () => {
      const url = 'postgresql://localhost:5432/';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Test database name is missing in database URL/,
      );
    });
  });

  // 5. Malformed URLs and unexpected hosts are rejected
  describe('5. Malformed and Invalid Configurations', () => {
    it('rejects completely malformed URL string', () => {
      expect(() => assertTestDatabaseIsSafe('not-a-valid-url')).toThrow(
        /Test database URL is malformed or invalid/,
      );
    });

    it('rejects non-postgres protocols (http, mysql, redis)', () => {
      expect(() => assertTestDatabaseIsSafe('http://localhost:5432/zentra_test')).toThrow(
        /Prohibited database protocol \[http:\]/,
      );
      expect(() => assertTestDatabaseIsSafe('mysql://localhost:3306/zentra_test')).toThrow(
        /Prohibited database protocol \[mysql:\]/,
      );
    });

    it('rejects attacker-crafted subdomains masquerading as localhost', () => {
      const attackerUrl = 'postgresql://user:pass@localhost.attacker.com:5432/zentra_test';
      expect(() => assertTestDatabaseIsSafe(attackerUrl)).toThrow(
        /Prohibited non-local test database host \[localhost\.attacker\.com\]/,
      );
    });
  });

  // 6. Rejected configurations fail before any connection or destructive query is executed
  describe('6. Pre-Execution Synchronous Circuit-Breaking', () => {
    it('fails immediately and synchronously without invoking network operations', () => {
      const start = Date.now();
      expect(() =>
        assertTestDatabaseIsSafe(
          'postgresql://user:pass@ep-remote-unreachable-domain-12345.neon.tech/zentra_test',
        ),
      ).toThrow();
      const elapsed = Date.now() - start;
      // Synchronous gate check must complete in <10ms without network timeouts
      expect(elapsed).toBeLessThan(50);
    });
  });

  // 7. Error output does not expose credentials
  describe('7. Credential Leakage Prevention in Errors', () => {
    it('never includes passwords, secret tokens, or full connection strings in error message', () => {
      const sensitivePassword = 'SUPER_SECRET_COMPLEX_PASSWORD_98765!';
      const sensitiveUser = 'confidential_admin_user';
      const dangerousUrl = `postgresql://${sensitiveUser}:${sensitivePassword}@ep-target.neon.tech:5432/forbidden_db?token=secret_api_token_value`;

      try {
        assertTestDatabaseIsSafe(dangerousUrl);
        expect.unreachable('Should have thrown an error');
      } catch (err: any) {
        expect(err.message).not.toContain(sensitivePassword);
        expect(err.message).not.toContain(sensitiveUser);
        expect(err.message).not.toContain('secret_api_token_value');
        expect(err.message).not.toContain('postgresql://');
      }
    });

    it('never leaks credentials in assertTestEnvironmentIsSafe when catching prohibited markers', () => {
      const sensitivePassword = 'MY_RDS_MASTER_PASSWORD_XYZ!';
      const envWithRds = {
        NODE_ENV: 'test',
        DATABASE_URL: `postgresql://admin:${sensitivePassword}@my-db.rds.amazonaws.com:5432/prod_db`,
      };

      try {
        assertTestEnvironmentIsSafe(envWithRds);
        expect.unreachable('Should have thrown an error');
      } catch (err: any) {
        expect(err.message).not.toContain(sensitivePassword);
        expect(err.message).not.toContain('postgresql://');
      }
    });
  });

  // 8. URL Query Parameter Host/Driver Override Rejection (SEC-REV-02)
  describe('8. URL Query Parameter Host/Driver Override Rejection (SEC-REV-02)', () => {
    it('rejects remote host marker in query parameters (host override)', () => {
      const url =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?host=ep-cool-star.neon.tech';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited remote host marker \[neon\.tech\] detected in test database query parameters/,
      );
      expect(isTestDatabaseUrlSafe(url)).toBe(false);
    });

    it('rejects remote host marker in endpoint parameter', () => {
      const url =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?endpoint=ep-quiet-star-12345.ap-southeast-1.aws.neon.tech';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited remote host marker \[neon\.tech\] detected in test database query parameters/,
      );
      expect(isTestDatabaseUrlSafe(url)).toBe(false);
    });

    it('rejects remote host marker in arbitrary query parameters', () => {
      const url =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?sslmode=require&provider=neon.tech';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited remote host marker \[neon\.tech\] detected in test database query parameters/,
      );
      expect(isTestDatabaseUrlSafe(url)).toBe(false);
    });

    it('rejects AWS RDS marker in query parameters', () => {
      const url =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?host=zentra.cluster-xyz.ap-south-1.rds.amazonaws.com';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited remote host marker \[rds\.amazonaws\.com\] detected in test database query parameters/,
      );
      expect(isTestDatabaseUrlSafe(url)).toBe(false);
    });

    it('rejects Supabase marker in query parameters', () => {
      const url =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?host=db.xyzcompany.supabase.co';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited remote host marker \[supabase\.co\] detected in test database query parameters/,
      );
      expect(isTestDatabaseUrlSafe(url)).toBe(false);
    });

    it('rejects non-local IP override in host query parameter', () => {
      const url =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?host=192.168.1.50';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited non-local host override detected in test database query parameters/,
      );
      expect(isTestDatabaseUrlSafe(url)).toBe(false);
    });

    it('rejects non-local IP override in hostaddr query parameter', () => {
      const url =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?hostaddr=192.168.1.50';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited non-local hostaddr override detected in test database query parameters/,
      );
      expect(isTestDatabaseUrlSafe(url)).toBe(false);
    });

    it('rejects non-local domain in endpoint query parameter', () => {
      const url =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?endpoint=remote-host.com';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited endpoint override detected in test database query parameters/,
      );
      expect(isTestDatabaseUrlSafe(url)).toBe(false);
    });

    it('rejects database name override to production in dbname parameter', () => {
      const url =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?dbname=production';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited test database name override \[production\] detected in test database query parameters/,
      );
      expect(isTestDatabaseUrlSafe(url)).toBe(false);
    });

    it('rejects database name override to neondb in database parameter', () => {
      const url =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?database=neondb';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited test database name override \[neondb\] detected in test database query parameters/,
      );
      expect(isTestDatabaseUrlSafe(url)).toBe(false);
    });

    it('rejects database name override to local dev database (zentra_dev)', () => {
      const url =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?database=zentra_dev';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Prohibited test database name override \[zentra_dev\] detected in test database query parameters/,
      );
      expect(isTestDatabaseUrlSafe(url)).toBe(false);
    });

    it('rejects invalid or non-numeric port override in query parameters', () => {
      const urlInvalid =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?port=invalid';
      expect(() => assertTestDatabaseIsSafe(urlInvalid)).toThrow(
        /Invalid port override detected in test database query parameters/,
      );

      const urlOutOfRange =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?port=99999';
      expect(() => assertTestDatabaseIsSafe(urlOutOfRange)).toThrow(
        /Invalid port override detected in test database query parameters/,
      );
    });

    it('rejects host redirection in options parameter', () => {
      const url =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?options=-h%20remote.server.com';
      expect(() => assertTestDatabaseIsSafe(url)).toThrow(
        /Host redirection via options parameter is prohibited in test database query parameters/,
      );
    });

    it('permits legitimate query parameters (sslmode, application_name, connect_timeout)', () => {
      const safeUrl =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?sslmode=disable&application_name=zentra_test_runner&connect_timeout=10';
      expect(() => assertTestDatabaseIsSafe(safeUrl)).not.toThrow();
      expect(isTestDatabaseUrlSafe(safeUrl)).toBe(true);
    });

    it('permits local host query overrides (localhost, 127.0.0.1)', () => {
      const safeHostUrl =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?host=localhost';
      expect(() => assertTestDatabaseIsSafe(safeHostUrl)).not.toThrow();

      const safeHostaddrUrl =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?hostaddr=127.0.0.1';
      expect(() => assertTestDatabaseIsSafe(safeHostaddrUrl)).not.toThrow();
    });

    it('permits explicit test database name in query parameter', () => {
      const safeDbUrl =
        'postgresql://postgres:postgres@localhost:5432/zentra_test?database=zentra_test';
      expect(() => assertTestDatabaseIsSafe(safeDbUrl)).not.toThrow();
    });

    it('never leaks query parameter secrets or tokens in query parameter error messages', () => {
      const sensitiveToken = 'SECRET_NEON_BEARER_TOKEN_ABCD1234';
      const dangerousUrl = `postgresql://localhost:5432/zentra_test?host=ep-secret.neon.tech&token=${sensitiveToken}`;

      try {
        assertTestDatabaseIsSafe(dangerousUrl);
        expect.unreachable('Should have thrown an error');
      } catch (err: any) {
        expect(err.message).not.toContain(sensitiveToken);
        expect(err.message).not.toContain('postgresql://');
      }
    });
  });

  // 9. Caller Environment Safety Validation (SEC-REV-01)
  describe('9. Caller Environment Safety Validation (SEC-REV-01)', () => {
    it('fails closed when caller environment has NODE_ENV=production', () => {
      const callerEnv = {
        NODE_ENV: 'production',
      };
      expect(() => assertTestEnvironmentIsSafe(callerEnv)).toThrow(
        /cannot execute with NODE_ENV or APP_ENV set to production/,
      );
    });

    it('fails closed when caller environment has APP_ENV=production', () => {
      const callerEnv = {
        NODE_ENV: 'test',
        APP_ENV: 'production',
      };
      expect(() => assertTestEnvironmentIsSafe(callerEnv)).toThrow(
        /cannot execute with NODE_ENV or APP_ENV set to production/,
      );
    });

    it('fails closed when caller environment has APP_ENV=staging', () => {
      const callerEnv = {
        NODE_ENV: 'test',
        APP_ENV: 'staging',
      };
      expect(() => assertTestEnvironmentIsSafe(callerEnv)).toThrow(
        /cannot execute against STAGING environment directly/,
      );
    });

    it('permits legitimate caller test environments (test, local, or unset)', () => {
      expect(() =>
        assertTestEnvironmentIsSafe({
          NODE_ENV: 'test',
          APP_ENV: 'test',
        }),
      ).not.toThrow();

      expect(() =>
        assertTestEnvironmentIsSafe({
          NODE_ENV: 'test',
          APP_ENV: 'local',
        }),
      ).not.toThrow();

      expect(() =>
        assertTestEnvironmentIsSafe({
          NODE_ENV: undefined,
          APP_ENV: undefined,
        }),
      ).not.toThrow();
    });
  });

  describe('Disposable Integration Test Database Safety Guard Suite (Gate 6B-7P)', () => {
    it('1. rejects zentra_test for the destructive integration-test path', () => {
      const canonicalUrl = 'postgresql://postgres:postgres@localhost:5432/zentra_test';
      expect(() => assertDisposableTestDatabaseUrl(canonicalUrl)).toThrow(
        /FAIL-CLOSED SAFETY GATE ABORT: Prohibited destructive test execution against protected canonical test database \[zentra_test\]/,
      );
      expect(isDisposableTestDatabaseUrlSafe(canonicalUrl)).toBe(false);
    });

    it('2. accepts zentra_test_disposable by the URL-name guard', () => {
      const disposableUrl = 'postgresql://postgres:postgres@localhost:5432/zentra_test_disposable';
      expect(() => assertDisposableTestDatabaseUrl(disposableUrl)).not.toThrow();
      expect(assertDisposableTestDatabaseUrl(disposableUrl)).toBe('zentra_test_disposable');
      expect(isDisposableTestDatabaseUrlSafe(disposableUrl)).toBe(true);

      const ipUrl = 'postgresql://postgres:postgres@127.0.0.1:5432/zentra_test_disposable';
      expect(() => assertDisposableTestDatabaseUrl(ipUrl)).not.toThrow();
      expect(isDisposableTestDatabaseUrlSafe(ipUrl)).toBe(true);
    });

    it('3. rejects missing or malformed database URLs', () => {
      expect(() => assertDisposableTestDatabaseUrl('')).toThrow(
        /Test database URL is missing or empty/,
      );
      expect(() => assertDisposableTestDatabaseUrl(undefined)).toThrow(
        /Test database URL is missing or empty/,
      );
      expect(() => assertDisposableTestDatabaseUrl(null)).toThrow(
        /Test database URL is missing or empty/,
      );
      expect(() => assertDisposableTestDatabaseUrl('not-a-valid-url')).toThrow(
        /Test database URL is malformed or invalid/,
      );
      expect(() =>
        assertDisposableTestDatabaseUrl('mysql://localhost:5432/zentra_test_disposable'),
      ).toThrow(/Prohibited database protocol/);
      expect(isDisposableTestDatabaseUrlSafe('')).toBe(false);
      expect(isDisposableTestDatabaseUrlSafe('not-a-valid-url')).toBe(false);
    });

    it('4. rejects unexpected database names', () => {
      const devUrl = 'postgresql://postgres:postgres@localhost:5432/zentra_dev';
      expect(() => assertDisposableTestDatabaseUrl(devUrl)).toThrow(
        /Prohibited test database name \[zentra_dev\]/,
      );

      const prodUrl = 'postgresql://postgres:postgres@localhost:5432/production';
      expect(() => assertDisposableTestDatabaseUrl(prodUrl)).toThrow(
        /Prohibited test database name \[production\]/,
      );

      const otherUrl = 'postgresql://postgres:postgres@localhost:5432/other_db';
      expect(() => assertDisposableTestDatabaseUrl(otherUrl)).toThrow(
        /Prohibited test database name \[other_db\]/,
      );

      const remoteUrl =
        'postgresql://postgres:postgres@ep-quiet-star.aws.neon.tech:5432/zentra_test_disposable';
      expect(() => assertDisposableTestDatabaseUrl(remoteUrl)).toThrow(
        /Prohibited remote host marker/,
      );
    });

    it('5. aborts if active database connection is connected to zentra_test (protects canonical reconciliation state)', async () => {
      const mockGetter = async () => 'zentra_test';
      await expect(assertConnectedToDisposableDatabase(mockGetter)).rejects.toThrow(
        /CRITICAL FAIL-CLOSED SAFETY ABORT: Active database connection is targeting protected canonical database \[zentra_test\]/,
      );

      const mockClient = {
        query: async (querySql: string) => {
          return { rows: [{ current_database: 'zentra_test' }] };
        },
      };
      await expect(assertConnectedToDisposableDatabase(mockClient)).rejects.toThrow(
        /CRITICAL FAIL-CLOSED SAFETY ABORT: Active database connection is targeting protected canonical database \[zentra_test\]/,
      );
    });

    it('5b. aborts if active database connection is connected to an unexpected database', async () => {
      const mockGetter = async () => 'postgres';
      await expect(assertConnectedToDisposableDatabase(mockGetter)).rejects.toThrow(
        /CRITICAL FAIL-CLOSED SAFETY ABORT: Active database connection is targeting \[postgres\], expected \[zentra_test_disposable\]/,
      );

      const mockEmpty = async () => '';
      await expect(assertConnectedToDisposableDatabase(mockEmpty)).rejects.toThrow(
        /Current database name could not be determined/,
      );

      await expect(assertConnectedToDisposableDatabase(null)).rejects.toThrow(
        /Database connection or getter is required/,
      );
    });

    it('6. passes the guard on mocked disposable connection without executing destructive statements and verifies CompiledQuery contract', async () => {
      let destructiveSqlExecuted = false;
      let receivedCompiledQuery: any = null;

      const mockKyselyExecutor = {
        executeQuery: async (compiled: any) => {
          receivedCompiledQuery = compiled;
          if (!Array.isArray(compiled?.parameters)) {
            throw new TypeError('compiledQuery.parameters is not iterable');
          }
          if (typeof compiled?.sql !== 'string') {
            throw new TypeError('compiledQuery.sql must be a string');
          }
          const queryText = compiled.sql || compiled?.query?.sqlFragments?.join(' ') || '';
          if (
            queryText.toUpperCase().includes('TRUNCATE') ||
            queryText.toUpperCase().includes('DROP')
          ) {
            destructiveSqlExecuted = true;
          }
          return { rows: [{ current_database: 'zentra_test_disposable' }] };
        },
      };

      const verifiedDb = await assertConnectedToDisposableDatabase(mockKyselyExecutor);
      expect(verifiedDb).toBe('zentra_test_disposable');
      expect(destructiveSqlExecuted).toBe(false);
      expect(receivedCompiledQuery).toBeDefined();
      expect(receivedCompiledQuery.sql).toBe('SELECT current_database() AS current_database');
      expect(receivedCompiledQuery.parameters).toEqual([]);
      expect(receivedCompiledQuery.query?.kind).toBe('RawNode');

      const mockGetter = async () => 'zentra_test_disposable';
      const verifiedFromGetter = await assertConnectedToDisposableDatabase(mockGetter);
      expect(verifiedFromGetter).toBe('zentra_test_disposable');
    });
  });

  describe('13. Shared Disposable Integration Test Harness (Gate 6B-7V)', () => {
    const validDisposableUrl =
      'postgresql://postgres:postgres@localhost:5432/zentra_test_disposable';
    const canonicalUrl = 'postgresql://postgres:postgres@localhost:5432/zentra_test';

    const createMockConnection = (dbName: string = 'zentra_test_disposable') => {
      let destructiveExecuted = false;
      const client = {
        query: async (sqlText: string) => {
          if (
            sqlText.toUpperCase().includes('TRUNCATE') ||
            sqlText.toUpperCase().includes('DROP') ||
            sqlText.toUpperCase().includes('DELETE')
          ) {
            destructiveExecuted = true;
          }
          return { rows: [{ current_database: dbName }] };
        },
        hasExecutedDestructive: () => destructiveExecuted,
      };
      return client;
    };

    it('1. rejects canonical zentra_test URL (fails closed before connection or migration)', async () => {
      const mockFactory = vi.fn(() => createMockConnection());
      const mockMigration = vi.fn(async () => {});

      await expect(
        setupDisposableIntegrationHarness(canonicalUrl, mockFactory, mockMigration),
      ).rejects.toThrow(
        /FAIL-CLOSED SAFETY GATE ABORT: Prohibited destructive test execution against protected canonical test database \[zentra_test\]/,
      );

      expect(mockFactory).not.toHaveBeenCalled();
      expect(mockMigration).not.toHaveBeenCalled();
    });

    it('2. accepts zentra_test_disposable URL with valid connection and runs migrations after identity check', async () => {
      const mockClient = createMockConnection('zentra_test_disposable');
      const executionOrder: string[] = [];

      const trackingClient = {
        query: async (sqlText: string) => {
          executionOrder.push('SELECT_CURRENT_DATABASE');
          return mockClient.query(sqlText);
        },
      };

      const mockMigration = vi.fn(async (url: string) => {
        executionOrder.push('RUN_MIGRATIONS');
      });

      const harness = await setupDisposableIntegrationHarness({
        testDbUrl: validDisposableUrl,
        connection: () => trackingClient,
        runMigrations: mockMigration,
      });

      expect(harness.dbName).toBe('zentra_test_disposable');
      expect(harness.db).toBe(trackingClient);
      expect(mockMigration).toHaveBeenCalledWith(validDisposableUrl);
      expect(executionOrder).toEqual(['SELECT_CURRENT_DATABASE', 'RUN_MIGRATIONS']);
    });

    it('3. rejects missing or malformed URLs', async () => {
      const mockFactory = vi.fn(() => createMockConnection());
      const mockMigration = vi.fn(async () => {});

      await expect(
        setupDisposableIntegrationHarness('', mockFactory, mockMigration),
      ).rejects.toThrow(/Test database URL is missing or empty/);

      await expect(
        setupDisposableIntegrationHarness(undefined, mockFactory, mockMigration),
      ).rejects.toThrow(/Test database URL is missing or empty/);

      await expect(
        setupDisposableIntegrationHarness('not-a-valid-url', mockFactory, mockMigration),
      ).rejects.toThrow(/Test database URL is malformed or invalid/);

      expect(mockFactory).not.toHaveBeenCalled();
      expect(mockMigration).not.toHaveBeenCalled();
    });

    it('4. rejects unexpected database names (zentra_dev, production, remote neon)', async () => {
      const devUrl = 'postgresql://postgres:postgres@localhost:5432/zentra_dev';
      await expect(
        setupDisposableIntegrationHarness(devUrl, () => createMockConnection()),
      ).rejects.toThrow(/Prohibited test database name \[zentra_dev\]/);

      const prodUrl = 'postgresql://postgres:postgres@localhost:5432/production';
      await expect(
        setupDisposableIntegrationHarness(prodUrl, () => createMockConnection()),
      ).rejects.toThrow(/Prohibited test database name \[production\]/);

      const remoteUrl =
        'postgresql://postgres:postgres@ep-remote.aws.neon.tech:5432/zentra_test_disposable';
      await expect(
        setupDisposableIntegrationHarness(remoteUrl, () => createMockConnection()),
      ).rejects.toThrow(/Prohibited remote host marker/);
    });

    it('5. aborts before migrations or destructive SQL if actual connected database is zentra_test (anti-spoofing)', async () => {
      // Attacker or misconfiguration sets URL to disposable but connection pool connects to zentra_test
      const mockClientConnectedToCanonical = createMockConnection('zentra_test');
      const mockMigration = vi.fn(async () => {});

      await expect(
        setupDisposableIntegrationHarness(
          validDisposableUrl,
          () => mockClientConnectedToCanonical,
          mockMigration,
        ),
      ).rejects.toThrow(
        /CRITICAL FAIL-CLOSED SAFETY ABORT: Active database connection is targeting protected canonical database \[zentra_test\]/,
      );

      // CRITICAL: migration runner was NEVER called
      expect(mockMigration).not.toHaveBeenCalled();
      expect(mockClientConnectedToCanonical.hasExecutedDestructive()).toBe(false);
    });

    it('6. aborts before migrations if actual connected database is an unexpected database (e.g. postgres)', async () => {
      const mockClientConnectedToPostgres = createMockConnection('postgres');
      const mockMigration = vi.fn(async () => {});

      await expect(
        setupDisposableIntegrationHarness(
          validDisposableUrl,
          () => mockClientConnectedToPostgres,
          mockMigration,
        ),
      ).rejects.toThrow(
        /CRITICAL FAIL-CLOSED SAFETY ABORT: Active database connection is targeting \[postgres\], expected \[zentra_test_disposable\]/,
      );

      expect(mockMigration).not.toHaveBeenCalled();
      expect(mockClientConnectedToPostgres.hasExecutedDestructive()).toBe(false);
    });

    it('7. guard failure in connection or factory prevents migration execution', async () => {
      const failingFactory = vi.fn(() => {
        throw new Error('Connection refused');
      });
      const mockMigration = vi.fn(async () => {});

      await expect(
        setupDisposableIntegrationHarness(validDisposableUrl, failingFactory, mockMigration),
      ).rejects.toThrow(/Connection refused/);

      expect(mockMigration).not.toHaveBeenCalled();
    });

    it('8. accepts pre-established connection instance directly (options object signature)', async () => {
      const mockClient = createMockConnection('zentra_test_disposable');

      const result = await setupDisposableIntegrationHarness({
        testDbUrl: validDisposableUrl,
        connection: mockClient,
      });

      expect(result.dbName).toBe('zentra_test_disposable');
      expect(result.db).toBe(mockClient);
    });

    it('9. propagates migration errors if migration runner fails', async () => {
      const mockClient = createMockConnection('zentra_test_disposable');
      const failingMigration = vi.fn(async () => {
        return { error: new Error('Migration DDL syntax error') };
      });

      await expect(
        setupDisposableIntegrationHarness(validDisposableUrl, mockClient, failingMigration),
      ).rejects.toThrow(/Migration DDL syntax error/);
    });
  });
});

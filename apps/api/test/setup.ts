/**
 * ZENTRA — Central API Test Safety Harness
 * apps/api/test/setup.ts
 *
 * Runs automatically before every test file in @zentra/api via Vitest setupFiles.
 * Enforces fail-closed safety checks before any test suite can execute, ensuring
 * that any misconfigured, remote, or staging environment is blocked immediately.
 */

import { assertTestEnvironmentIsSafe, assertTestDatabaseIsSafe } from '@zentra/testing';

// 1. Verify caller's original environment flags BEFORE setting test defaults (SEC-REV-01)
assertTestEnvironmentIsSafe();

// 2. Lock environment to test mode for safe local test execution
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'test';

// 3. If TEST_DATABASE_URL is provided in environment, strictly validate it immediately
if (process.env.TEST_DATABASE_URL) {
  assertTestDatabaseIsSafe(process.env.TEST_DATABASE_URL);
}

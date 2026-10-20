/**
 * ZENTRA Field — API Client Test Suite
 * apps/field/test/api-client.spec.ts
 *
 * Verifies mobile API client pipeline, error classification, timeouts, and refresh.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../src/api/api-client';
import { ApiClientError } from '../src/api/types';
import { SessionManager } from '../src/auth/session-manager';
import { InMemorySecureStorageAdapter } from '../src/auth/secure-storage';

describe('Phase 10 — Mobile API Client & Error Classification', () => {
  let storage: InMemorySecureStorageAdapter;
  let sessionManager: SessionManager;
  let client: ApiClient;

  beforeEach(() => {
    storage = new InMemorySecureStorageAdapter();
    sessionManager = new SessionManager(storage);
    client = new ApiClient({
      baseUrl: 'http://localhost:3000/api/v1',
      defaultTimeoutMs: 500,
      sessionManager,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unwraps successful API response envelopes', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          data: { testKey: 'testValue' },
          correlationId: 'corr-01',
          timestamp: new Date().toISOString(),
        }),
    } as any);

    const result = await client.get<{ testKey: string }>('health');
    expect(result.testKey).toBe('testValue');
  });

  it('classifies network connection loss as NETWORK_OFFLINE', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    let caughtError: ApiClientError | null = null;
    try {
      await client.get('service-cases');
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ApiClientError);
    expect(caughtError?.kind).toBe('NETWORK_OFFLINE');
    expect(caughtError?.isNetworkOrTimeout).toBe(true);
  });

  it('classifies request timeout as TIMEOUT', async () => {
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          }, 100);
        }),
    );

    let caughtError: ApiClientError | null = null;
    try {
      await client.get('slow-endpoint', { timeoutMs: 50 });
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ApiClientError);
    expect(caughtError?.kind).toBe('TIMEOUT');
    expect(caughtError?.isNetworkOrTimeout).toBe(true);
  });

  it('classifies HTTP 400 as VALIDATION_ERROR', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          success: false,
          error: { message: 'Invalid payload: required field missing' },
        }),
    } as any);

    let caughtError: ApiClientError | null = null;
    try {
      await client.post('service-cases', { invalid: true });
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ApiClientError);
    expect(caughtError?.kind).toBe('VALIDATION_ERROR');
    expect(caughtError?.statusCode).toBe(400);
    expect(caughtError?.message).toContain('Invalid payload');
  });

  it('classifies HTTP 403 as FORBIDDEN', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          success: false,
          error: { message: 'Cannot transition service case in another district' },
        }),
    } as any);

    let caughtError: ApiClientError | null = null;
    try {
      await client.post('service-cases/123/transition', {});
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ApiClientError);
    expect(caughtError?.kind).toBe('FORBIDDEN');
    expect(caughtError?.statusCode).toBe(403);
    expect(caughtError?.isAuthError).toBe(true);
  });
});

/**
 * ZENTRA Field — Authentication & Session Test Suite
 * apps/field/test/auth-session.spec.ts
 *
 * Verifies mobile session lifecycle, secure storage, and active role handling:
 * - Secure persistence of tokens
 * - Session restoration on app boot
 * - Session expiry detection
 * - Silent access token updates
 * - Safe logout and memory clearing
 * - Security rule: No passwords or raw tokens in domain tables
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager, type AuthenticatedSession } from '../src/auth/session-manager';
import { InMemorySecureStorageAdapter } from '../src/auth/secure-storage';
import { appDatabaseSchema } from '../src/database/schema';

describe('Phase 10 — Mobile Authentication & Session Foundation', () => {
  let storage: InMemorySecureStorageAdapter;
  let sessionManager: SessionManager;

  beforeEach(() => {
    storage = new InMemorySecureStorageAdapter();
    sessionManager = new SessionManager(storage);
  });

  it('saves and restores authenticated session from secure storage', async () => {
    const dummySession: AuthenticatedSession = {
      user: {
        userId: 'fe-usr-001',
        username: 'fe_erode_01',
        email: 'fe_erode_01@zentra.gov.in',
        fullName: 'R. Kannan',
        activeRole: 'FIELD_ENGINEER',
        territoryDistrictIds: ['dst-erode'],
      },
      accessToken: 'sample-access-token-jwt',
      refreshToken: 'sample-refresh-token-uuid',
      expiresAt: Date.now() + 3600 * 1000,
    };

    await sessionManager.saveSession(dummySession);
    expect(sessionManager.isAuthenticated()).toBe(true);

    // Create a new session manager instance simulating app reboot
    const rebootedManager = new SessionManager(storage);
    const restored = await rebootedManager.restoreSession();

    expect(restored).not.toBeNull();
    expect(restored?.user.username).toBe('fe_erode_01');
    expect(restored?.user.activeRole).toBe('FIELD_ENGINEER');
    expect(restored?.accessToken).toBe('sample-access-token-jwt');
    expect(restored?.refreshToken).toBe('sample-refresh-token-uuid');
    expect(rebootedManager.isAuthenticated()).toBe(true);
  });

  it('detects expired session and calculates expiry buffer', async () => {
    const expiredSession: AuthenticatedSession = {
      user: {
        userId: 'fe-usr-002',
        username: 'fe_salem_01',
        email: 'fe_salem_01@zentra.gov.in',
        fullName: 'K. Murugan',
        activeRole: 'FIELD_ENGINEER',
        territoryDistrictIds: ['dst-salem'],
      },
      accessToken: 'expired-access-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: Date.now() - 5000, // Expired 5 seconds ago
    };

    await sessionManager.saveSession(expiredSession);
    expect(sessionManager.isAccessTokenExpired()).toBe(true);
    expect(sessionManager.isAuthenticated()).toBe(false);

    // Update access token after refresh
    const newExpiresAt = Date.now() + 15 * 60 * 1000;
    await sessionManager.updateAccessToken('new-refreshed-access-token', newExpiresAt);

    expect(sessionManager.isAccessTokenExpired()).toBe(false);
    expect(sessionManager.isAuthenticated()).toBe(true);
    expect(sessionManager.getSession()?.accessToken).toBe('new-refreshed-access-token');
  });

  it('purges all tokens from secure storage upon logout', async () => {
    const activeSession: AuthenticatedSession = {
      user: {
        userId: 'fe-usr-003',
        username: 'fe_karur_01',
        email: 'fe_karur_01@zentra.gov.in',
        fullName: 'S. Vijay',
        activeRole: 'FIELD_ENGINEER',
        territoryDistrictIds: ['dst-karur'],
      },
      accessToken: 'token-to-purge',
      refreshToken: 'refresh-to-purge',
      expiresAt: Date.now() + 3600 * 1000,
    };

    await sessionManager.saveSession(activeSession);
    await sessionManager.clearSession();

    expect(sessionManager.getSession()).toBeNull();
    expect(sessionManager.isAuthenticated()).toBe(false);

    const storedAccessToken = await storage.getItem('zentra_access_token');
    const storedRefreshToken = await storage.getItem('zentra_refresh_token');
    expect(storedAccessToken).toBeNull();
    expect(storedRefreshToken).toBeNull();
  });

  it('verifies domain database tables contain NO password or credential fields', () => {
    const tables = Object.values(appDatabaseSchema.tables);
    for (const table of tables) {
      const columnNames = table.columnArray.map((c) => c.name.toLowerCase());
      expect(columnNames).not.toContain('password');
      expect(columnNames).not.toContain('password_hash');
      expect(columnNames).not.toContain('access_token');
      expect(columnNames).not.toContain('refresh_token');
    }
  });
});

/**
 * ZENTRA Field — Authentication & Session Manager
 * apps/field/src/auth/session-manager.ts
 *
 * Manages mobile session lifecycle:
 * - Persisting session tokens in hardware secure storage
 * - Restoring authenticated session on app boot
 * - Session expiry evaluation
 * - Active role preservation (primarily FIELD_ENGINEER)
 * - Safe sanitization (never logging raw tokens or passwords)
 */

import { ISecureStorage, getSecureStorage } from './secure-storage';

export interface MobileSessionUser {
  userId: string;
  username: string;
  email: string;
  fullName: string;
  activeRole: string;
  territoryDistrictIds: string[];
}

export interface AuthenticatedSession {
  user: MobileSessionUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix epoch milliseconds
}

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'zentra_access_token',
  REFRESH_TOKEN: 'zentra_refresh_token',
  SESSION_USER: 'zentra_session_user',
  EXPIRES_AT: 'zentra_expires_at',
};

export class SessionManager {
  private currentSession: AuthenticatedSession | null = null;
  private readonly storage: ISecureStorage;

  constructor(customStorage?: ISecureStorage) {
    this.storage = customStorage || getSecureStorage();
  }

  /**
   * Returns current in-memory active session
   */
  getSession(): AuthenticatedSession | null {
    return this.currentSession;
  }

  /**
   * Returns whether a valid session is currently loaded and unexpired
   */
  isAuthenticated(): boolean {
    if (!this.currentSession) return false;
    return !this.isAccessTokenExpired();
  }

  /**
   * Evaluates if access token has expired (with 30 second grace buffer)
   */
  isAccessTokenExpired(bufferSeconds = 30): boolean {
    if (!this.currentSession) return true;
    const now = Date.now();
    return now >= this.currentSession.expiresAt - bufferSeconds * 1000;
  }

  /**
   * Persists a newly authenticated session safely into secure storage
   */
  async saveSession(session: AuthenticatedSession): Promise<void> {
    this.currentSession = session;
    await this.storage.setItem(STORAGE_KEYS.ACCESS_TOKEN, session.accessToken);
    await this.storage.setItem(STORAGE_KEYS.REFRESH_TOKEN, session.refreshToken);
    await this.storage.setItem(STORAGE_KEYS.SESSION_USER, JSON.stringify(session.user));
    await this.storage.setItem(STORAGE_KEYS.EXPIRES_AT, String(session.expiresAt));
  }

  /**
   * Updates only the access token (typically after a silent token refresh)
   */
  async updateAccessToken(accessToken: string, expiresAt: number): Promise<void> {
    if (!this.currentSession) return;
    this.currentSession = {
      ...this.currentSession,
      accessToken,
      expiresAt,
    };
    await this.storage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
    await this.storage.setItem(STORAGE_KEYS.EXPIRES_AT, String(expiresAt));
  }

  /**
   * Restores authenticated session from secure storage during app boot
   */
  async restoreSession(): Promise<AuthenticatedSession | null> {
    try {
      const accessToken = await this.storage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      const refreshToken = await this.storage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      const userJson = await this.storage.getItem(STORAGE_KEYS.SESSION_USER);
      const expiresAtStr = await this.storage.getItem(STORAGE_KEYS.EXPIRES_AT);

      if (!accessToken || !refreshToken || !userJson || !expiresAtStr) {
        this.currentSession = null;
        return null;
      }

      const user = JSON.parse(userJson) as MobileSessionUser;
      const expiresAt = Number(expiresAtStr);

      this.currentSession = {
        user,
        accessToken,
        refreshToken,
        expiresAt,
      };

      return this.currentSession;
    } catch {
      // In case of parsing error or corruption, clear session safely
      await this.clearSession();
      return null;
    }
  }

  /**
   * Clears session in memory and purges secure storage on logout
   */
  async clearSession(): Promise<void> {
    this.currentSession = null;
    await this.storage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    await this.storage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    await this.storage.removeItem(STORAGE_KEYS.SESSION_USER);
    await this.storage.removeItem(STORAGE_KEYS.EXPIRES_AT);
  }
}

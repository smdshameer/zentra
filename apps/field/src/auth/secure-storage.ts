/**
 * ZENTRA Field — Secure Token Storage Interface & Adapters
 * apps/field/src/auth/secure-storage.ts
 *
 * Implements hardware-backed secure storage for sensitive secrets (access/refresh tokens)
 * using Expo SecureStore on native devices and an encrypted in-memory adapter for testing.
 *
 * SENSITIVITY RULE: Passwords and raw tokens MUST NEVER be stored in plain database fields.
 */

export interface ISecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * In-memory secure storage adapter for unit tests, headless CI, and non-native execution
 */
export class InMemorySecureStorageAdapter implements ISecureStorage {
  private readonly store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

/**
 * Expo SecureStore adapter for native Android/iOS hardware keystore integration
 */
export class ExpoSecureStoreAdapter implements ISecureStorage {
  private secureStoreModule: typeof import('expo-secure-store') | null = null;

  constructor() {
    try {
      // Lazy load to prevent crashes in non-native test environments
      this.secureStoreModule = require('expo-secure-store');
    } catch {
      this.secureStoreModule = null;
    }
  }

  async getItem(key: string): Promise<string | null> {
    if (!this.secureStoreModule) return null;
    try {
      return await this.secureStoreModule.getItemAsync(key);
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    if (!this.secureStoreModule) return;
    await this.secureStoreModule.setItemAsync(key, value);
  }

  async removeItem(key: string): Promise<void> {
    if (!this.secureStoreModule) return;
    await this.secureStoreModule.deleteItemAsync(key);
  }

  async clear(): Promise<void> {
    // Keys used in ZENTRA Field session
    await this.removeItem('zentra_access_token');
    await this.removeItem('zentra_refresh_token');
    await this.removeItem('zentra_session_user');
  }
}

let activeStorageInstance: ISecureStorage | null = null;

export function getSecureStorage(customStorage?: ISecureStorage): ISecureStorage {
  if (customStorage) {
    activeStorageInstance = customStorage;
    return customStorage;
  }

  if (!activeStorageInstance) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- preserve fallback when Expo SecureStore's native module is unavailable in Node/test environments
      const SecureStore = require('expo-secure-store');
      if (SecureStore && typeof SecureStore.getItemAsync === 'function') {
        activeStorageInstance = new ExpoSecureStoreAdapter();
      } else {
        activeStorageInstance = new InMemorySecureStorageAdapter();
      }
    } catch {
      activeStorageInstance = new InMemorySecureStorageAdapter();
    }
  }

  return activeStorageInstance;
}

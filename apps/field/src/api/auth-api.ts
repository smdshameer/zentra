/**
 * ZENTRA Field — Authentication API Service
 * apps/field/src/api/auth-api.ts
 *
 * Implements login, logout, and token refresh API calls using the ApiClient.
 */

import type { ApiClient } from './api-client';
import type { LoginRequest, LoginResponse, RefreshTokenResponse } from '@zentra/contracts';

export class AuthApiService {
  constructor(private readonly client: ApiClient) {}

  /**
   * Log in field engineer credentials against ZENTRA Core API
   */
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    return await this.client.post<LoginResponse>('auth/login', credentials, {
      skipAuth: true,
    });
  }

  /**
   * Refresh expired access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<RefreshTokenResponse> {
    return await this.client.post<RefreshTokenResponse>(
      'auth/refresh',
      { refreshToken },
      { skipAuth: true },
    );
  }

  /**
   * Terminate active server session
   */
  async logout(refreshToken: string): Promise<{ success: boolean }> {
    return await this.client.post<{ success: boolean }>('auth/logout', { refreshToken });
  }
}

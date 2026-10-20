/**
 * ZENTRA Field — Mobile API Client
 * apps/field/src/api/api-client.ts
 *
 * Typed HTTP client foundation for ZENTRA Core API:
 * - Deterministic error classification (Network vs Server vs Auth vs Validation)
 * - Timeout handling via AbortController
 * - Automatic Bearer token injection
 * - Silent token refresh on HTTP 401
 * - Secure sanitization (never logging raw tokens or credentials)
 */

import { ApiClientError, type ApiRequestOptions, type MobileApiResponse } from './types';
import type { SessionManager } from '../auth/session-manager';

export interface ApiClientConfig {
  baseUrl: string;
  defaultTimeoutMs?: number;
  sessionManager?: SessionManager;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly sessionManager?: SessionManager;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 10000;
    this.sessionManager = config.sessionManager;
  }

  /**
   * Core request execution pipeline
   */
  async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    body?: unknown,
    options: ApiRequestOptions = {},
  ): Promise<T> {
    const url = `${this.baseUrl}/${endpoint.replace(/^\/+/, '')}`;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    // Inject Bearer token if session exists and not explicitly skipped
    if (!options.skipAuth && this.sessionManager) {
      const session = this.sessionManager.getSession();
      if (session?.accessToken) {
        headers['Authorization'] = `Bearer ${session.accessToken}`;
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 Unauthorized with token refresh attempt
      if (response.status === 401 && !options.skipAuth && this.sessionManager) {
        const refreshed = await this.tryRefreshToken();
        if (refreshed) {
          // Re-try the original request once with new token
          return await this.request<T>(endpoint, method, body, {
            ...options,
            skipAuth: false,
          });
        }
      }

      // Parse JSON response body
      let responseData: unknown = null;
      const text = await response.text();
      if (text) {
        try {
          responseData = JSON.parse(text);
        } catch {
          responseData = text;
        }
      }

      if (!response.ok) {
        this.handleHttpError(response.status, responseData);
      }

      // Check ZENTRA API envelope structure
      const envelope = responseData as MobileApiResponse<T>;
      if (envelope && typeof envelope === 'object' && 'success' in envelope) {
        if (!envelope.success) {
          throw new ApiClientError(
            envelope.error?.message || 'API request failed',
            'SERVER_ERROR',
            response.status,
            envelope.error,
          );
        }
        return (envelope.data !== undefined ? envelope.data : envelope) as T;
      }

      return responseData as T;
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (err instanceof ApiClientError) {
        throw err;
      }

      // Classify fetch / network / timeout exceptions
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new ApiClientError(
            `Request timed out after ${timeoutMs}ms`,
            'TIMEOUT',
            undefined,
            { endpoint, timeoutMs },
          );
        }

        // Network connection error / offline
        return this.handleNetworkFailure(err, endpoint);
      }

      throw new ApiClientError('Unknown network failure', 'UNKNOWN');
    }
  }

  get<T>(endpoint: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(endpoint, 'GET', undefined, options);
  }

  post<T>(endpoint: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(endpoint, 'POST', body, options);
  }

  put<T>(endpoint: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(endpoint, 'PUT', body, options);
  }

  delete<T>(endpoint: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(endpoint, 'DELETE', undefined, options);
  }

  /**
   * Attempts silent refresh using refresh token stored in session manager
   */
  private async tryRefreshToken(): Promise<boolean> {
    if (!this.sessionManager) return false;
    const session = this.sessionManager.getSession();
    if (!session?.refreshToken) return false;

    try {
      const refreshUrl = `${this.baseUrl}/auth/refresh`;
      const res = await fetch(refreshUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });

      if (!res.ok) {
        await this.sessionManager.clearSession();
        return false;
      }

      const data = (await res.json()) as {
        success: boolean;
        data?: { accessToken: string; expiresInSeconds?: number };
      };

      if (data.success && data.data?.accessToken) {
        const expiresInMs = (data.data.expiresInSeconds || 900) * 1000;
        await this.sessionManager.updateAccessToken(
          data.data.accessToken,
          Date.now() + expiresInMs,
        );
        return true;
      }

      await this.sessionManager.clearSession();
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Deterministic HTTP status code to ApiClientError mapping
   */
  private handleHttpError(status: number, body: unknown): never {
    const errorEnvelope = body as { message?: string; error?: { message?: string } };
    const message =
      errorEnvelope?.error?.message ||
      errorEnvelope?.message ||
      `HTTP error with status code ${status}`;

    switch (status) {
      case 400:
        throw new ApiClientError(message, 'VALIDATION_ERROR', 400, body);
      case 401:
        throw new ApiClientError(
          'Authentication required or token expired',
          'AUTHENTICATION_REQUIRED',
          401,
          body,
        );
      case 403:
        throw new ApiClientError('Action prohibited: Insufficient permissions', 'FORBIDDEN', 403, body);
      case 404:
        throw new ApiClientError(message, 'NOT_FOUND', 404, body);
      case 409:
        throw new ApiClientError(message, 'CONFLICT', 409, body);
      case 500:
      case 502:
      case 503:
      case 504:
        throw new ApiClientError(message, 'SERVER_ERROR', status, body);
      default:
        throw new ApiClientError(message, 'UNKNOWN', status, body);
    }
  }

  private handleNetworkFailure(err: Error, endpoint: string): never {
    throw new ApiClientError(
      `Network connection failed while accessing ${endpoint}: ${err.message}`,
      'NETWORK_OFFLINE',
      undefined,
      { originalError: err.message },
    );
  }
}

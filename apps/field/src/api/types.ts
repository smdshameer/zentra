/**
 * ZENTRA Field — Mobile API Client Types
 * apps/field/src/api/types.ts
 *
 * Defines typed API error classifications, request options, and response envelopes.
 */

export type ApiErrorKind =
  | 'NETWORK_OFFLINE'
  | 'TIMEOUT'
  | 'AUTHENTICATION_REQUIRED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export class ApiClientError extends Error {
  public readonly kind: ApiErrorKind;
  public readonly statusCode?: number;
  public readonly details?: unknown;

  constructor(message: string, kind: ApiErrorKind, statusCode?: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.kind = kind;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, ApiClientError.prototype);
  }

  get isNetworkOrTimeout(): boolean {
    return this.kind === 'NETWORK_OFFLINE' || this.kind === 'TIMEOUT';
  }

  get isAuthError(): boolean {
    return this.kind === 'AUTHENTICATION_REQUIRED' || this.kind === 'FORBIDDEN';
  }
}

export interface ApiRequestOptions {
  timeoutMs?: number;
  skipAuth?: boolean;
  headers?: Record<string, string>;
}

export interface MobileApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  correlationId?: string;
  timestamp?: string;
}

/**
 * ZENTRA — Cryptographic Token Service (JWT Access & Hashed Refresh Tokens)
 * apps/api/src/modules/auth/token.service.ts
 *
 * Implements Phase 1 & 5 Token Architecture:
 * - Access Tokens: HMAC-SHA256 JWT, 15m lifetime (900 seconds)
 * - Refresh Tokens: Cryptographic random 32-byte secret (64 hex characters)
 * - One-way Refresh Token Storage: Stored strictly as SHA-256 digest in PostgreSQL
 * - Zero plaintext tokens ever persisted to disk or logged
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { loadAppConfig } from '@zentra/config';
import type { AccessTokenClaims, UserRole } from '@zentra/types';
import { generateUuidV7 } from '@zentra/shared';

function base64UrlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export interface CreateAccessTokenParams {
  userId: string;
  username: string;
  roles: UserRole[];
  activeRole?: UserRole;
  territoryDistrictIds: string[];
  deviceId?: string;
}

export interface GeneratedRefreshToken {
  tokenSecret: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  private readonly config = loadAppConfig();
  private readonly accessSecret: string;
  private readonly accessTokenTtlSeconds = 900; // 15 minutes
  private readonly refreshTokenTtlMs = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor() {
    this.accessSecret = this.config.JWT_ACCESS_SECRET;
  }

  /**
   * Generates a signed HMAC-SHA256 JWT Access Token.
   */
  generateAccessToken(params: CreateAccessTokenParams): { token: string; expiresIn: number } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.accessTokenTtlSeconds;

    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };

    const payload: AccessTokenClaims & { deviceId?: string } = {
      sub: params.userId,
      username: params.username,
      roles: params.roles,
      activeRole: params.activeRole || params.roles[0],
      territoryDistrictIds: params.territoryDistrictIds,
      deviceId: params.deviceId,
      iat: now,
      exp,
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const message = `${encodedHeader}.${encodedPayload}`;

    const signature = crypto
      .createHmac('sha256', this.accessSecret)
      .update(message)
      .digest();
    const encodedSignature = base64UrlEncode(signature);

    return {
      token: `${message}.${encodedSignature}`,
      expiresIn: this.accessTokenTtlSeconds,
    };
  }

  /**
   * Verifies an HMAC-SHA256 JWT Access Token.
   * Throws UnauthorizedException on signature mismatch, malformed payload, or expiration.
   */
  verifyAccessToken(token: string): AccessTokenClaims {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Token is required');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed token structure');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const message = `${encodedHeader}.${encodedPayload}`;

    // Verify header algorithm
    try {
      const headerJson = JSON.parse(base64UrlDecode(encodedHeader!));
      if (headerJson.alg !== 'HS256') {
        throw new UnauthorizedException('Unsupported token algorithm');
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid token header');
    }

    // Verify signature with constant-time equality
    const expectedSig = crypto
      .createHmac('sha256', this.accessSecret)
      .update(message)
      .digest();
    const actualSig = Buffer.from(
      encodedSignature!.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (encodedSignature!.length % 4)) % 4),
      'base64',
    );

    if (
      actualSig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(actualSig, expectedSig)
    ) {
      throw new UnauthorizedException('Invalid token signature');
    }

    // Parse and validate claims
    let payload: AccessTokenClaims;
    try {
      payload = JSON.parse(base64UrlDecode(encodedPayload!)) as AccessTokenClaims;
    } catch {
      throw new UnauthorizedException('Invalid token payload');
    }

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
      throw new UnauthorizedException('Token has expired');
    }

    if (!payload.sub || !payload.roles) {
      throw new UnauthorizedException('Token missing required claims');
    }

    return payload;
  }

  /**
   * Generates a new cryptographically secure Refresh Token pair:
   * - tokenSecret (to return to the caller)
   * - tokenHash (SHA-256 digest to store in the database)
   * - familyId (token family for rotation & reuse tracking)
   */
  generateRefreshToken(existingFamilyId?: string): GeneratedRefreshToken {
    const tokenSecret = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(tokenSecret);
    const familyId = existingFamilyId || generateUuidV7();
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlMs);

    return {
      tokenSecret,
      tokenHash,
      familyId,
      expiresAt,
    };
  }

  /**
   * Hashes a refresh token secret using SHA-256 hex digest.
   */
  hashToken(tokenSecret: string): string {
    return crypto.createHash('sha256').update(tokenSecret).digest('hex');
  }
}

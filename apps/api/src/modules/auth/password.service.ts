/**
 * ZENTRA — Cryptographic Password Hashing & Verification Service
 * apps/api/src/modules/auth/password.service.ts
 *
 * Implements Phase 1 & 5 Password Security Architecture:
 * - Scrypt algorithm with adaptive cost parameters (N=16384, r=8, p=1, keylen=64)
 * - Cryptographically secure 16-byte random salt per user
 * - Constant-time comparison via crypto.timingSafeEqual
 * - Zero external C++ native dependencies; zero plaintext password retention
 */

import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

export interface ScryptOptions {
  N: number;
  r: number;
  p: number;
  keyLength: number;
}

const DEFAULT_SCRYPT_OPTIONS: ScryptOptions = {
  N: 16384, // CPU/memory cost
  r: 8, // Block size
  p: 1, // Parallelization
  keyLength: 64, // Output key length in bytes
};

function scryptAsync(
  password: string | Buffer,
  salt: Buffer,
  keyLength: number,
  options: crypto.ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, options, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey);
    });
  });
}

@Injectable()
export class PasswordService {
  /**
   * Hashes a plaintext password using Scrypt with a random 16-byte salt.
   * Returns a self-describing formatted string:
   * scrypt$N=16384,r=8,p=1$<saltHex>$<hashHex>
   */
  async hash(password: string): Promise<string> {
    if (!password || typeof password !== 'string') {
      throw new Error('Password must be a non-empty string');
    }

    const salt = crypto.randomBytes(16);
    const { N, r, p, keyLength } = DEFAULT_SCRYPT_OPTIONS;

    const derivedKey = await scryptAsync(password, salt, keyLength, {
      cost: N,
      blockSize: r,
      parallelization: p,
      maxmem: 32 * 1024 * 1024,
    });

    return `scrypt$N=${N},r=${r},p=${p}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
  }

  /**
   * Verifies a plaintext password against a stored Scrypt hash.
   * Uses constant-time comparison (crypto.timingSafeEqual) to prevent timing attacks.
   */
  async verify(password: string, storedHash: string): Promise<boolean> {
    if (!password || !storedHash || typeof password !== 'string' || typeof storedHash !== 'string') {
      return false;
    }

    try {
      const parts = storedHash.split('$');
      if (parts.length !== 4 || parts[0] !== 'scrypt') {
        return false;
      }

      const paramsPart = parts[1];
      const saltHex = parts[2];
      const derivedKeyHex = parts[3];

      if (!paramsPart || !saltHex || !derivedKeyHex) {
        return false;
      }

      // Validate hex encoding and minimum length (salt must be at least 16 bytes = 32 hex chars, key at least 32 bytes = 64 hex chars)
      if (
        !/^[0-9a-fA-F]{32,}$/.test(saltHex) ||
        !/^[0-9a-fA-F]{64,}$/.test(derivedKeyHex) ||
        !paramsPart.startsWith('N=')
      ) {
        return false;
      }

      const params = new URLSearchParams(paramsPart.replace(/,/g, '&'));
      const N = parseInt(params.get('N') ?? '', 10) || DEFAULT_SCRYPT_OPTIONS.N;
      const r = parseInt(params.get('r') ?? '', 10) || DEFAULT_SCRYPT_OPTIONS.r;
      const p = parseInt(params.get('p') ?? '', 10) || DEFAULT_SCRYPT_OPTIONS.p;

      const salt = Buffer.from(saltHex, 'hex');
      const expectedKey = Buffer.from(derivedKeyHex, 'hex');

      const actualKey = await scryptAsync(password, salt, expectedKey.length, {
        cost: N,
        blockSize: r,
        parallelization: p,
        maxmem: 32 * 1024 * 1024,
      });

      if (actualKey.length !== expectedKey.length) {
        return false;
      }

      return crypto.timingSafeEqual(actualKey, expectedKey);
    } catch {
      return false;
    }
  }
}

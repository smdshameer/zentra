import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import { computeSha256Hex } from '../src/domain/repositories/sha256';

describe('Cryptographic SHA-256 Engine (FIPS PUB 180-4)', () => {
  it('computes exact hash for empty byte array', () => {
    const input = new Uint8Array(0);
    const expected = crypto.createHash('sha256').update(input).digest('hex');
    const result = computeSha256Hex(input);
    expect(result).toBe(expected);
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('computes exact hash for ASCII test vectors', () => {
    const vectors = ['abc', 'hello world', 'ZENTRA-FIELD-SERVICE-FSM-2026'];
    for (const text of vectors) {
      const bytes = new Uint8Array(Buffer.from(text, 'utf-8'));
      const expected = crypto.createHash('sha256').update(bytes).digest('hex');
      expect(computeSha256Hex(bytes)).toBe(expected);
    }
  });

  it('computes exact hash for multi-kilobyte binary media buffers', () => {
    const randomBuffer = crypto.randomBytes(1024 * 250); // 250 KB
    const bytes = new Uint8Array(randomBuffer);
    const expected = crypto.createHash('sha256').update(bytes).digest('hex');
    expect(computeSha256Hex(bytes)).toBe(expected);
  });
});

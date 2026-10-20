import { describe, it, expect } from 'vitest';
import {
  calculateHaversineDistanceMeters,
  nowUtcIso,
  formatUtcToIst,
  generateCorrelationId,
} from '../src/index';

describe('Shared Utilities Smoke Tests', () => {
  it('calculates Haversine distance between two coordinates accurately', () => {
    // Chennai Central (13.0827, 80.2707) to Egmore (13.0784, 80.2606) ~ 1.2km
    const distance = calculateHaversineDistanceMeters(13.0827, 80.2707, 13.0784, 80.2606);
    expect(distance).toBeGreaterThan(1000);
    expect(distance).toBeLessThan(1500);
  });

  it('calculates zero distance for identical coordinates', () => {
    const distance = calculateHaversineDistanceMeters(10.7654, 79.8432, 10.7654, 79.8432);
    expect(distance).toBe(0);
  });

  it('formats UTC timestamp to valid IST representation', () => {
    const utcTime = '2026-10-05T00:00:00.000Z';
    const ist = formatUtcToIst(utcTime);
    expect(ist).toBeDefined();
    expect(typeof ist).toBe('string');
  });

  it('generates a valid UUID string for correlation', () => {
    const id = generateCorrelationId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('returns valid ISO timestamp ending with Z', () => {
    const iso = nowUtcIso();
    expect(iso.endsWith('Z')).toBe(true);
  });
});

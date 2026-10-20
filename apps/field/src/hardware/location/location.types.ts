/**
 * ZENTRA Field — Hardware Location Types & Contracts
 * apps/field/src/hardware/location/location.types.ts
 *
 * Defines strongly typed contracts for mobile GPS acquisition,
 * permission management, accuracy verification, and geofencing.
 *
 * ARCHITECTURAL BOUNDARY:
 * Phase 11 hardware foundation only.
 * Does NOT create field visits, triggers no check-in/out, and implements no sync.
 */

export type LocationPermissionStatus =
  | 'UNKNOWN'
  | 'GRANTED'
  | 'DENIED'
  | 'BLOCKED'
  | 'UNAVAILABLE';

export type AccuracyValidationResult =
  | 'VALID_ACCURACY'
  | 'INSUFFICIENT_ACCURACY'
  | 'LOCATION_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'LOCATION_ERROR';

export type LocationSource = 'GPS' | 'NETWORK' | 'MOCK' | 'PASSIVE';

export interface LocationSample {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string; // ISO 8601 device capture timestamp
  source?: LocationSource;
  altitudeMeters?: number | null;
  heading?: number | null;
  speed?: number | null;
}

export interface GeofenceResult {
  distanceMeters: number;
  insideGeofence: boolean;
  radiusMeters: number;
  targetLatitude: number;
  targetLongitude: number;
  sampleLatitude: number;
  sampleLongitude: number;
}

export type LocationErrorKind =
  | 'PERMISSION_DENIED'
  | 'PERMISSION_BLOCKED'
  | 'SERVICES_DISABLED'
  | 'TIMEOUT'
  | 'POSITION_UNAVAILABLE'
  | 'INSUFFICIENT_ACCURACY'
  | 'INVALID_COORDINATES'
  | 'UNKNOWN';

export class LocationHardwareError extends Error {
  constructor(
    message: string,
    public readonly kind: LocationErrorKind,
    public readonly rawError?: unknown,
  ) {
    super(message);
    this.name = 'LocationHardwareError';
    Object.setPrototypeOf(this, LocationHardwareError.prototype);
  }
}

export interface LocationOptions {
  timeoutMs?: number;
  highAccuracy?: boolean;
  maximumAgeMs?: number;
}

export interface LocationConfig {
  /** Maximum acceptable accuracy radius in meters (ZENTRA Standard: ≤ 50m) */
  maxAccuracyThresholdMeters: number;
  /** Acquisition timeout in milliseconds */
  timeoutMs: number;
  /**
   * Geofence radius in meters.
   *
   * BUSINESS RULE STATUS:
   * School geofence radius: REQUIRES CLARIFICATION.
   * 500m is currently retained only as a configurable/provisional development default
   * and is NOT an approved operational policy.
   */
  defaultGeofenceRadiusMeters: number;
}

/**
 * Authoritative default configuration for ZENTRA GPS validation.
 * Centralizes the 50m accuracy requirement to avoid scattered magic numbers.
 *
 * NOTE ON GEOFENCE RADIUS:
 * 500m is a PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY.
 * Retained solely for development and unit testing until customer/domain clarification.
 */
export const DEFAULT_LOCATION_CONFIG: Readonly<LocationConfig> = Object.freeze({
  maxAccuracyThresholdMeters: 50,
  timeoutMs: 15000,
  defaultGeofenceRadiusMeters: 500,
});

/**
 * Pluggable provider interface decoupling business logic from Expo/native APIs
 */
export interface ILocationProvider {
  getPermissionStatus(): Promise<LocationPermissionStatus>;
  requestPermission(): Promise<LocationPermissionStatus>;
  getCurrentPosition(options?: LocationOptions): Promise<LocationSample>;
  isLocationServicesEnabled(): Promise<boolean>;
}

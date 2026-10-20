/**
 * ZENTRA Field — Hardware Location Service
 * apps/field/src/hardware/location/location-service.ts
 *
 * Provides a unified facade for device GPS acquisition, permission verification,
 * accuracy validation (≤ 50m target), and geofence distance calculation.
 *
 * ARCHITECTURAL BOUNDARY:
 * Phase 11 hardware capability only.
 * Does NOT create field visits, triggers no check-in/out, and executes no case transitions.
 */

import {
  type AccuracyValidationResult,
  type GeofenceResult,
  type ILocationProvider,
  type LocationConfig,
  type LocationOptions,
  type LocationPermissionStatus,
  type LocationSample,
  DEFAULT_LOCATION_CONFIG,
} from './location.types';
import { AccuracyValidator } from './accuracy-validator';
import { GeofenceService } from './geofence-service';

export interface ValidatedLocationAcquisition {
  sample: LocationSample;
  accuracyResult: AccuracyValidationResult;
  isValidAccuracy: boolean;
}

export class LocationService {
  private readonly config: LocationConfig;

  constructor(
    private readonly provider: ILocationProvider,
    config: Partial<LocationConfig> = {},
  ) {
    this.config = {
      ...DEFAULT_LOCATION_CONFIG,
      ...config,
    };
  }

  /**
   * Retrieves the current system permission state for location.
   */
  async getPermissionStatus(): Promise<LocationPermissionStatus> {
    return await this.provider.getPermissionStatus();
  }

  /**
   * Requests location permission from the system.
   */
  async requestPermission(): Promise<LocationPermissionStatus> {
    return await this.provider.requestPermission();
  }

  /**
   * Acquires the current raw GPS location sample from device hardware.
   * Does NOT fabricate fallback coordinates if unavailable.
   */
  async acquireCurrentLocation(options?: LocationOptions): Promise<LocationSample> {
    return await this.provider.getCurrentPosition(options);
  }

  /**
   * Acquires current GPS fix and evaluates whether it satisfies the
   * ZENTRA accuracy threshold (default ≤ 50m).
   */
  async acquireValidatedLocation(options?: LocationOptions): Promise<ValidatedLocationAcquisition> {
    const sample = await this.acquireCurrentLocation(options);
    const accuracyResult = AccuracyValidator.validate(sample, this.config.maxAccuracyThresholdMeters);

    return {
      sample,
      accuracyResult,
      isValidAccuracy: accuracyResult === 'VALID_ACCURACY',
    };
  }

  /**
   * Checks whether a given location sample meets the configured accuracy threshold.
   */
  isAccuracyValid(sample: LocationSample | null | undefined): boolean {
    return AccuracyValidator.isValid(sample, this.config.maxAccuracyThresholdMeters);
  }

  /**
   * Verifies geofence proximity against target coordinates using Haversine calculation.
   *
   * @param sample Current device GPS location sample
   * @param targetLat Target latitude in decimal degrees
   * @param targetLon Target longitude in decimal degrees
   * @param radiusMeters Optional geofence radius. When omitted, uses `config.defaultGeofenceRadiusMeters`,
   *                     which is a PROVISIONAL / CONFIGURABLE DEFAULT and NOT an approved operational policy.
   */
  verifyGeofence(
    sample: LocationSample,
    targetLat: number,
    targetLon: number,
    radiusMeters?: number,
  ): GeofenceResult {
    const effectiveRadius = radiusMeters ?? this.config.defaultGeofenceRadiusMeters;
    return GeofenceService.evaluateGeofence(sample, targetLat, targetLon, effectiveRadius);
  }

  /**
   * Verifies geofence proximity against a school master dossier entity.
   * Returns null if school does not have coordinates defined.
   *
   * @param sample Current device GPS location sample
   * @param school School entity with optional latitude/longitude
   * @param radiusMeters Optional geofence radius (falls back to configurable provisional default)
   */
  verifySchoolProximity(
    sample: LocationSample,
    school: { latitude: number | null; longitude: number | null; schoolName?: string },
    radiusMeters?: number,
  ): GeofenceResult | null {
    if (
      school.latitude === null ||
      school.longitude === null ||
      typeof school.latitude !== 'number' ||
      typeof school.longitude !== 'number'
    ) {
      return null;
    }

    return this.verifyGeofence(sample, school.latitude, school.longitude, radiusMeters);
  }

  /**
   * Returns the active location configuration.
   */
  getConfig(): Readonly<LocationConfig> {
    return this.config;
  }
}

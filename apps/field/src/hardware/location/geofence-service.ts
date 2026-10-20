/**
 * ZENTRA Field — Geospatial Distance & Geofence Service
 * apps/field/src/hardware/location/geofence-service.ts
 *
 * Implements high-precision Haversine distance calculations and geofence evaluation.
 *
 * ARCHITECTURAL BOUNDARY:
 * Phase 11 hardware calculation capability only.
 * Does NOT create field visits, triggers no check-in/out, and executes no case transitions.
 */

import {
  type GeofenceResult,
  type LocationSample,
  LocationHardwareError,
} from './location.types';

const EARTH_RADIUS_METERS = 6371000;

export class GeofenceService {
  /**
   * Calculates the great-circle distance between two geographic points using Haversine formula.
   *
   * @param lat1 Latitude of point 1 in decimal degrees
   * @param lon1 Longitude of point 1 in decimal degrees
   * @param lat2 Latitude of point 2 in decimal degrees
   * @param lon2 Longitude of point 2 in decimal degrees
   * @returns Distance in meters rounded to one decimal place
   */
  static calculateDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    this.validateCoordinates(lat1, lon1, 'Source coordinates');
    this.validateCoordinates(lat2, lon2, 'Target coordinates');

    // Identical point fast path
    if (lat1 === lat2 && lon1 === lon2) {
      return 0;
    }

    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

    const phi1 = toRadians(lat1);
    const phi2 = toRadians(lat2);
    const deltaPhi = toRadians(lat2 - lat1);
    const deltaLambda = toRadians(lon2 - lon1);

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));

    const distance = EARTH_RADIUS_METERS * c;
    return Math.round(distance * 10) / 10;
  }

  /**
   * Evaluates whether a location sample is within a configured radius of a target location.
   */
  static evaluateGeofence(
    sample: LocationSample | { latitude: number; longitude: number },
    targetLat: number,
    targetLon: number,
    radiusMeters: number,
  ): GeofenceResult {
    if (radiusMeters < 0 || !Number.isFinite(radiusMeters)) {
      throw new LocationHardwareError(
        `Invalid geofence radius: ${radiusMeters}m. Radius must be a non-negative finite number.`,
        'INVALID_COORDINATES',
      );
    }

    const distanceMeters = this.calculateDistanceMeters(
      sample.latitude,
      sample.longitude,
      targetLat,
      targetLon,
    );

    return {
      distanceMeters,
      insideGeofence: distanceMeters <= radiusMeters,
      radiusMeters,
      targetLatitude: targetLat,
      targetLongitude: targetLon,
      sampleLatitude: sample.latitude,
      sampleLongitude: sample.longitude,
    };
  }

  /**
   * Validates latitude and longitude ranges.
   */
  private static validateCoordinates(
    lat: number,
    lon: number,
    label = 'Coordinates',
  ): void {
    if (
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      throw new LocationHardwareError(
        `${label} must be finite numbers: lat=${lat}, lon=${lon}`,
        'INVALID_COORDINATES',
      );
    }

    if (lat < -90 || lat > 90) {
      throw new LocationHardwareError(
        `${label} latitude must be between -90 and 90 degrees: lat=${lat}`,
        'INVALID_COORDINATES',
      );
    }

    if (lon < -180 || lon > 180) {
      throw new LocationHardwareError(
        `${label} longitude must be between -180 and 180 degrees: lon=${lon}`,
        'INVALID_COORDINATES',
      );
    }
  }
}

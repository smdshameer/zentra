/**
 * ZENTRA Field — Hardware Location Test Suite (Phase 11)
 * apps/field/test/hardware-location.spec.ts
 *
 * Verifies mobile GPS hardware integration, permission handling,
 * accuracy validation (≤ 50m threshold), and Haversine geofence calculations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocationService,
  MockLocationAdapter,
  GeofenceService,
  AccuracyValidator,
  DEFAULT_LOCATION_CONFIG,
  LocationHardwareError,
  type LocationSample,
} from '../src/hardware/location';

describe('Phase 11 — Mobile Hardware Location Module', () => {
  let mockAdapter: MockLocationAdapter;
  let locationService: LocationService;

  beforeEach(() => {
    mockAdapter = new MockLocationAdapter();
    locationService = new LocationService(mockAdapter);
  });

  // --- 1. Permission Handling ---

  describe('Location Permissions', () => {
    it('reports UNKNOWN initially when permissions are undetermined', async () => {
      mockAdapter.setPermissionStatus('UNKNOWN');
      const status = await locationService.getPermissionStatus();
      expect(status).toBe('UNKNOWN');
    });

    it('reports GRANTED when user grants location access', async () => {
      mockAdapter.setPermissionStatus('GRANTED');
      const status = await locationService.getPermissionStatus();
      expect(status).toBe('GRANTED');
    });

    it('reports DENIED when user denies location access', async () => {
      mockAdapter.setPermissionStatus('DENIED');
      const status = await locationService.getPermissionStatus();
      expect(status).toBe('DENIED');
    });

    it('reports BLOCKED when permission is permanently denied in system settings', async () => {
      mockAdapter.setPermissionStatus('BLOCKED');
      const status = await locationService.getPermissionStatus();
      expect(status).toBe('BLOCKED');
    });

    it('requests permission and updates state cleanly', async () => {
      mockAdapter.setPermissionStatus('UNKNOWN');
      const requested = await locationService.requestPermission();
      expect(requested).toBe('GRANTED');
      expect(await locationService.getPermissionStatus()).toBe('GRANTED');
    });

    it('throws deterministic error when acquiring location while permission is DENIED', async () => {
      mockAdapter.setPermissionStatus('DENIED');
      await expect(locationService.acquireCurrentLocation()).rejects.toThrow(LocationHardwareError);

      try {
        await locationService.acquireCurrentLocation();
      } catch (err: any) {
        expect(err.kind).toBe('PERMISSION_DENIED');
      }
    });

    it('throws deterministic error when acquiring location while permission is BLOCKED', async () => {
      mockAdapter.setPermissionStatus('BLOCKED');
      try {
        await locationService.acquireCurrentLocation();
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(LocationHardwareError);
        expect(err.kind).toBe('PERMISSION_BLOCKED');
      }
    });

    it('throws deterministic error when device location services are disabled', async () => {
      mockAdapter.setLocationServicesEnabled(false);
      try {
        await locationService.acquireCurrentLocation();
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(LocationHardwareError);
        expect(err.kind).toBe('SERVICES_DISABLED');
      }
    });
  });

  // --- 2. GPS Accuracy Validation ---

  describe('GPS Accuracy Validation (≤ 50m Target)', () => {
    it('validates samples satisfying the default ≤ 50m accuracy threshold', () => {
      const validSample: LocationSample = {
        latitude: 11.2724,
        longitude: 77.5833,
        accuracyMeters: 18.5,
        capturedAt: new Date().toISOString(),
      };

      const result = AccuracyValidator.validate(validSample);
      expect(result).toBe('VALID_ACCURACY');
      expect(AccuracyValidator.isValid(validSample)).toBe(true);
      expect(locationService.isAccuracyValid(validSample)).toBe(true);
    });

    it('rejects samples exceeding the 50m threshold as INSUFFICIENT_ACCURACY', () => {
      const noisySample: LocationSample = {
        latitude: 11.2724,
        longitude: 77.5833,
        accuracyMeters: 85.0, // Cell-tower / coarse fix > 50m
        capturedAt: new Date().toISOString(),
      };

      const result = AccuracyValidator.validate(noisySample);
      expect(result).toBe('INSUFFICIENT_ACCURACY');
      expect(AccuracyValidator.isValid(noisySample)).toBe(false);
      expect(locationService.isAccuracyValid(noisySample)).toBe(false);
    });

    it('accepts boundary edge case accuracy exactly equal to 50.0m', () => {
      const boundarySample: LocationSample = {
        latitude: 11.2724,
        longitude: 77.5833,
        accuracyMeters: 50.0,
        capturedAt: new Date().toISOString(),
      };

      expect(AccuracyValidator.validate(boundarySample)).toBe('VALID_ACCURACY');
      expect(AccuracyValidator.isValid(boundarySample)).toBe(true);
    });

    it('supports single configurable threshold without hardcoded magic numbers', () => {
      expect(DEFAULT_LOCATION_CONFIG.maxAccuracyThresholdMeters).toBe(50);

      const customService = new LocationService(mockAdapter, {
        maxAccuracyThresholdMeters: 30,
      });

      const sample40m: LocationSample = {
        latitude: 11.2724,
        longitude: 77.5833,
        accuracyMeters: 40.0,
        capturedAt: new Date().toISOString(),
      };

      // Valid under 50m standard, but invalid under custom 30m threshold
      expect(locationService.isAccuracyValid(sample40m)).toBe(true);
      expect(customService.isAccuracyValid(sample40m)).toBe(false);
    });

    it('evaluates null or undefined sample as LOCATION_UNAVAILABLE', () => {
      expect(AccuracyValidator.validate(null)).toBe('LOCATION_UNAVAILABLE');
      expect(AccuracyValidator.validate(undefined)).toBe('LOCATION_UNAVAILABLE');
    });

    it('evaluates negative or non-finite accuracy as LOCATION_ERROR', () => {
      const invalidSample: LocationSample = {
        latitude: 11.2724,
        longitude: 77.5833,
        accuracyMeters: -5,
        capturedAt: new Date().toISOString(),
      };
      expect(AccuracyValidator.validate(invalidSample)).toBe('LOCATION_ERROR');
    });

    it('acquires validated location and returns sample with validation verdict', async () => {
      mockAdapter.setLocation({
        latitude: 11.2724,
        longitude: 77.5833,
        accuracyMeters: 22.0,
      });

      const { sample, accuracyResult, isValidAccuracy } =
        await locationService.acquireValidatedLocation();

      expect(sample.latitude).toBe(11.2724);
      expect(sample.longitude).toBe(77.5833);
      expect(accuracyResult).toBe('VALID_ACCURACY');
      expect(isValidAccuracy).toBe(true);
    });
  });

  // --- 3. Haversine Distance & Geofencing ---

  describe('Geospatial Distance & Geofencing', () => {
    it('calculates zero distance for identical coordinates', () => {
      const dist = GeofenceService.calculateDistanceMeters(11.2724, 77.5833, 11.2724, 77.5833);
      expect(dist).toBe(0);
    });

    it('calculates accurate distance between known geographic points', () => {
      // Perundurai School to a point ~176 meters away
      const lat1 = 11.2724;
      const lon1 = 77.5833;
      const lat2 = 11.2735;
      const lon2 = 77.5845;

      const dist = GeofenceService.calculateDistanceMeters(lat1, lon1, lat2, lon2);
      expect(dist).toBeGreaterThan(160);
      expect(dist).toBeLessThan(190);
    });

    it('evaluates sample as insideGeofence using centralized provisional default radius (500m)', () => {
      const sample: LocationSample = {
        latitude: 11.2724,
        longitude: 77.5833,
        accuracyMeters: 15,
        capturedAt: new Date().toISOString(),
      };

      // Target is 176m away; verifyGeofence uses centralized defaultGeofenceRadiusMeters (500m provisional default)
      const geo = locationService.verifyGeofence(sample, 11.2735, 77.5845);
      expect(geo.insideGeofence).toBe(true);
      expect(geo.radiusMeters).toBe(500);
      expect(geo.distanceMeters).toBeGreaterThan(160);
      expect(geo.distanceMeters).toBeLessThan(190);
    });

    it('evaluates sample as outsideGeofence when exceeding custom configured radius (e.g. 100m)', () => {
      const sample: LocationSample = {
        latitude: 11.2724,
        longitude: 77.5833,
        accuracyMeters: 15,
        capturedAt: new Date().toISOString(),
      };

      // Target is 176m away, custom radius is tight 100m
      const geo = GeofenceService.evaluateGeofence(sample, 11.2735, 77.5845, 100);
      expect(geo.insideGeofence).toBe(false);
      expect(geo.radiusMeters).toBe(100);
      expect(geo.distanceMeters).toBeGreaterThan(100);
    });

    it('proves geofence radius can be dynamically configured without modifying the calculation algorithm', () => {
      const sample: LocationSample = {
        latitude: 11.2724,
        longitude: 77.5833,
        accuracyMeters: 10,
        capturedAt: new Date().toISOString(),
      };
      const targetLat = 11.2735;
      const targetLon = 77.5845;

      // 1. Calculate underlying Haversine distance (~176.4m)
      const baselineDistance = GeofenceService.calculateDistanceMeters(
        sample.latitude,
        sample.longitude,
        targetLat,
        targetLon,
      );
      expect(baselineDistance).toBeGreaterThan(160);
      expect(baselineDistance).toBeLessThan(190);

      // 2. Strict evaluation with radius < distance (150m) -> OUTSIDE
      const tightGeo = GeofenceService.evaluateGeofence(sample, targetLat, targetLon, 150);
      expect(tightGeo.insideGeofence).toBe(false);
      expect(tightGeo.radiusMeters).toBe(150);
      expect(tightGeo.distanceMeters).toBe(baselineDistance);

      // 3. Evaluation with radius > distance (200m) -> INSIDE
      const relaxedGeo = GeofenceService.evaluateGeofence(sample, targetLat, targetLon, 200);
      expect(relaxedGeo.insideGeofence).toBe(true);
      expect(relaxedGeo.radiusMeters).toBe(200);
      expect(relaxedGeo.distanceMeters).toBe(baselineDistance);

      // 4. Evaluation via LocationService configured with a custom provisional radius (e.g., 75m)
      const customConfigService = new LocationService(mockAdapter, {
        maxAccuracyThresholdMeters: 50,
        timeoutMs: 10000,
        defaultGeofenceRadiusMeters: 75,
      });
      const customGeo = customConfigService.verifyGeofence(sample, targetLat, targetLon);
      expect(customGeo.insideGeofence).toBe(false);
      expect(customGeo.radiusMeters).toBe(75);
      expect(customGeo.distanceMeters).toBe(baselineDistance);

      // Confirms algorithm remains constant while radius is 100% configurable
    });

    it('evaluates proximity to school master domain coordinates', () => {
      const sample: LocationSample = {
        latitude: 11.2724,
        longitude: 77.5833,
        accuracyMeters: 20,
        capturedAt: new Date().toISOString(),
      };

      const school = {
        schoolName: 'GHSS Perundurai',
        latitude: 11.2725,
        longitude: 77.5834,
      };

      const geo = locationService.verifySchoolProximity(sample, school, 200);
      expect(geo).not.toBeNull();
      expect(geo?.insideGeofence).toBe(true);
      expect(geo?.distanceMeters).toBeLessThan(50);
    });

    it('returns null when school has null coordinates without throwing', () => {
      const sample: LocationSample = {
        latitude: 11.2724,
        longitude: 77.5833,
        accuracyMeters: 20,
        capturedAt: new Date().toISOString(),
      };

      const schoolNoGps = {
        schoolName: 'Remote Primary School',
        latitude: null,
        longitude: null,
      };

      const geo = locationService.verifySchoolProximity(sample, schoolNoGps);
      expect(geo).toBeNull();
    });

    it('throws INVALID_COORDINATES on out-of-range latitude or longitude', () => {
      expect(() => {
        GeofenceService.calculateDistanceMeters(95.0, 77.0, 11.0, 77.0);
      }).toThrow(LocationHardwareError);

      expect(() => {
        GeofenceService.calculateDistanceMeters(11.0, 195.0, 11.0, 77.0);
      }).toThrow(LocationHardwareError);
    });

    it('throws INVALID_COORDINATES on negative geofence radius', () => {
      const sample = { latitude: 11.0, longitude: 77.0 };
      expect(() => {
        GeofenceService.evaluateGeofence(sample, 11.0, 77.0, -100);
      }).toThrow(LocationHardwareError);
    });
  });

  // --- 4. Metadata Integrity ---

  describe('Location Metadata Integrity', () => {
    it('captures device-side ISO timestamp and platform source without server sync claim', async () => {
      const beforeTime = new Date().toISOString();
      const sample = await locationService.acquireCurrentLocation();
      const afterTime = new Date().toISOString();

      expect(sample.capturedAt >= beforeTime).toBe(true);
      expect(sample.capturedAt <= afterTime).toBe(true);
      expect(sample.source).toBe('MOCK');
      expect(sample.latitude).toBeDefined();
      expect(sample.longitude).toBeDefined();
      expect(sample.accuracyMeters).toBeDefined();
    });
  });
});

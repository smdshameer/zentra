/**
 * ZENTRA Field — Expo Native Location Adapter
 * apps/field/src/hardware/location/expo-location-adapter.ts
 *
 * Implements ILocationProvider using the official Expo Location API.
 * Uses lazy module resolution to ensure safe execution across native devices
 * and non-native/headless test environments.
 */

import {
  type ILocationProvider,
  type LocationOptions,
  type LocationPermissionStatus,
  type LocationSample,
  LocationHardwareError,
} from './location.types';

export class ExpoLocationAdapter implements ILocationProvider {
  private locationModule: any = null;

  constructor() {
    try {
      this.locationModule = require('expo-location');
    } catch {
      this.locationModule = null;
    }
  }

  async getPermissionStatus(): Promise<LocationPermissionStatus> {
    if (!this.locationModule) return 'UNAVAILABLE';
    try {
      const { status, canAskAgain } = await this.locationModule.getForegroundPermissionsAsync();
      return this.mapExpoPermission(status, canAskAgain);
    } catch {
      return 'UNAVAILABLE';
    }
  }

  async requestPermission(): Promise<LocationPermissionStatus> {
    if (!this.locationModule) return 'UNAVAILABLE';
    try {
      const { status, canAskAgain } = await this.locationModule.requestForegroundPermissionsAsync();
      return this.mapExpoPermission(status, canAskAgain);
    } catch (err) {
      throw new LocationHardwareError(
        'Failed to request location permission from system',
        'UNKNOWN',
        err,
      );
    }
  }

  async isLocationServicesEnabled(): Promise<boolean> {
    if (!this.locationModule) return false;
    try {
      return await this.locationModule.hasServicesEnabledAsync();
    } catch {
      return false;
    }
  }

  async getCurrentPosition(options: LocationOptions = {}): Promise<LocationSample> {
    if (!this.locationModule) {
      throw new LocationHardwareError(
        'Native location hardware module is unavailable in this runtime environment',
        'POSITION_UNAVAILABLE',
      );
    }

    const isEnabled = await this.isLocationServicesEnabled();
    if (!isEnabled) {
      throw new LocationHardwareError(
        'Device location services are turned off in system settings',
        'SERVICES_DISABLED',
      );
    }

    let permission = await this.getPermissionStatus();
    if (permission !== 'GRANTED' && permission !== 'BLOCKED') {
      try {
        permission = await this.requestPermission();
      } catch {
        // Fall through to permission check below
      }
    }
    if (permission === 'BLOCKED') {
      throw new LocationHardwareError(
        'Location permission is permanently blocked. Enable it in App Settings.',
        'PERMISSION_BLOCKED',
      );
    }
    if (permission !== 'GRANTED') {
      throw new LocationHardwareError(
        'Location permission not granted',
        'PERMISSION_DENIED',
      );
    }

    try {
      const location = await this.locationModule.getCurrentPositionAsync({
        accuracy: options.highAccuracy !== false ? 5 : 3, // Accuracy.High = 5, Balanced = 3
      });

      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracyMeters: Math.round((location.coords.accuracy || 999) * 10) / 10,
        capturedAt: new Date(location.timestamp).toISOString(),
        source: 'GPS',
        altitudeMeters: location.coords.altitude,
        heading: location.coords.heading,
        speed: location.coords.speed,
      };
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('timeout') || msg.includes('timed out')) {
        throw new LocationHardwareError('GPS acquisition timed out', 'TIMEOUT', err);
      }
      throw new LocationHardwareError(
        'Failed to acquire native GPS fix: ' + msg,
        'POSITION_UNAVAILABLE',
        err,
      );
    }
  }

  private mapExpoPermission(status: string, canAskAgain: boolean): LocationPermissionStatus {
    switch (status) {
      case 'granted':
        return 'GRANTED';
      case 'denied':
        return canAskAgain ? 'DENIED' : 'BLOCKED';
      case 'undetermined':
        return 'UNKNOWN';
      default:
        return 'UNAVAILABLE';
    }
  }
}

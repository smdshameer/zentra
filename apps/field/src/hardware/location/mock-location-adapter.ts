/**
 * ZENTRA Field — Mock Location Provider Adapter
 * apps/field/src/hardware/location/mock-location-adapter.ts
 *
 * Deterministic in-memory location provider for unit tests, headless CI, and diagnostics.
 */

import {
  type ILocationProvider,
  type LocationOptions,
  type LocationPermissionStatus,
  type LocationSample,
  LocationHardwareError,
} from './location.types';

export class MockLocationAdapter implements ILocationProvider {
  private permissionStatus: LocationPermissionStatus = 'GRANTED';
  private servicesEnabled = true;
  private currentSample: LocationSample = {
    latitude: 11.2724, // Perundurai, Erode
    longitude: 77.5833,
    accuracyMeters: 18.5, // Well within ≤ 50m threshold
    capturedAt: new Date().toISOString(),
    source: 'MOCK',
    altitudeMeters: 260,
    heading: 0,
    speed: 0,
  };
  private simulatedError: Error | null = null;

  async getPermissionStatus(): Promise<LocationPermissionStatus> {
    return this.permissionStatus;
  }

  async requestPermission(): Promise<LocationPermissionStatus> {
    if (this.permissionStatus === 'BLOCKED') {
      return 'BLOCKED';
    }
    this.permissionStatus = 'GRANTED';
    return this.permissionStatus;
  }

  async isLocationServicesEnabled(): Promise<boolean> {
    return this.servicesEnabled;
  }

  async getCurrentPosition(_options?: LocationOptions): Promise<LocationSample> {
    if (this.simulatedError) {
      throw this.simulatedError;
    }

    if (!this.servicesEnabled) {
      throw new LocationHardwareError(
        'Device location services are disabled by the user',
        'SERVICES_DISABLED',
      );
    }

    if (this.permissionStatus === 'BLOCKED') {
      throw new LocationHardwareError(
        'Location permission is permanently blocked in system settings',
        'PERMISSION_BLOCKED',
      );
    }

    if (this.permissionStatus !== 'GRANTED') {
      throw new LocationHardwareError(
        'Location permission has not been granted by user',
        'PERMISSION_DENIED',
      );
    }

    return {
      ...this.currentSample,
      capturedAt: new Date().toISOString(),
    };
  }

  // --- Test & Diagnostic Controls ---

  setPermissionStatus(status: LocationPermissionStatus): void {
    this.permissionStatus = status;
  }

  setLocationServicesEnabled(enabled: boolean): void {
    this.servicesEnabled = enabled;
  }

  setLocation(sample: Partial<LocationSample>): void {
    this.currentSample = {
      ...this.currentSample,
      ...sample,
      capturedAt: sample.capturedAt || new Date().toISOString(),
    };
  }

  setSimulatedError(error: Error | null): void {
    this.simulatedError = error;
  }
}

import { describe, it, expect } from 'vitest';
import appConfig from '../app.json';
import { SYSTEM_CONSTANTS } from '@zentra/config';
import * as FieldModule from '../src/index';

describe('ZENTRA Field Foundation & Boundary Smoke Tests', () => {
  it('loads valid Expo configuration matching Phase 2 specifications', () => {
    expect(appConfig.expo).toBeDefined();
    expect(appConfig.expo.name).toBe('ZENTRA Field');
    expect(appConfig.expo.slug).toBe('zentra-field');
    expect(appConfig.expo.android.package).toBe('com.zentra.field.dev');
    expect(appConfig.expo.ios.bundleIdentifier).toBe('com.zentra.field.dev');
  });

  it('consumes shared architecture constants in mobile client context', () => {
    expect(SYSTEM_CONSTANTS.APP_NAME).toBe('ZENTRA');
    expect(SYSTEM_CONSTANTS.TIME_STANDARD).toBe('UTC');
    expect(SYSTEM_CONSTANTS.DISPLAY_TIMEZONE).toBe('Asia/Kolkata');
  });

  it('confirms Phase 11 GPS and geofence services are exported and available', () => {
    // Phase 11 capability verification
    expect(FieldModule.LocationService).toBeDefined();
    expect(FieldModule.GeofenceService).toBeDefined();
    expect(FieldModule.AccuracyValidator).toBeDefined();
    expect(FieldModule.DEFAULT_LOCATION_CONFIG).toBeDefined();
  });

  it('confirms Phase 11 Camera and temporary media services are exported and available', () => {
    // Phase 11 capability verification
    expect(FieldModule.CameraService).toBeDefined();
    expect(FieldModule.TemporaryMediaManager).toBeDefined();
    expect(FieldModule.DEFAULT_CAMERA_CONFIG).toBeDefined();
  });

  it('confirms no field visit execution workflow exists in Phase 11 (Phase 13 boundary)', () => {
    // Phase 13 boundary verification: Field visit execution belongs strictly to Phase 13
    expect((FieldModule as any).FieldVisitService).toBeUndefined();
    expect((FieldModule as any).VisitCheckInManager).toBeUndefined();
    expect((FieldModule as any).MultiVisitCoordinator).toBeUndefined();
  });

  it('confirms no S3 evidence pipeline or photo upload modules exist in Phase 11 (Phase 14 boundary)', () => {
    // Phase 14 boundary verification: Evidence pipeline & S3 upload belong strictly to Phase 14
    expect((FieldModule as any).EvidenceUploadPipeline).toBeUndefined();
    expect((FieldModule as any).S3DirectUploader).toBeUndefined();
    expect((FieldModule as any).DigitalSignatureCapture).toBeUndefined();
  });

  it('confirms no conveyance claim calculation or web portal modules exist in Phase 11 (Phase 15 boundary)', () => {
    // Phase 15 boundary verification: Conveyance and web portal belong strictly to Phase 15
    expect((FieldModule as any).ConveyanceCalculator).toBeUndefined();
    expect((FieldModule as any).ManagementWebPortal).toBeUndefined();
  });
});

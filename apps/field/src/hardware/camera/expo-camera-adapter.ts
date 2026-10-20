/**
 * ZENTRA Field — Expo Native Camera Adapter
 * apps/field/src/hardware/camera/expo-camera-adapter.ts
 *
 * Implements ICameraProvider using Expo Camera API.
 * Uses lazy module resolution to ensure safe execution across native devices
 * and non-native/headless test environments.
 */

import {
  type CameraFacing,
  type CameraPermissionStatus,
  type CapturedPhoto,
  type ICameraProvider,
  type PhotoCaptureOptions,
  CameraHardwareError,
  DEFAULT_CAMERA_CONFIG,
} from './camera.types';

export class ExpoCameraAdapter implements ICameraProvider {
  private cameraModule: any = null;
  private activeCameraRef: any = null;

  constructor() {
    try {
      this.cameraModule = require('expo-camera');
    } catch {
      this.cameraModule = null;
    }
  }

  /**
   * Attaches an active CameraView instance ref for imperative picture capture.
   */
  attachCameraRef(ref: any): void {
    this.activeCameraRef = ref;
  }

  /**
   * Detaches and clears the active CameraView instance ref.
   */
  detachCameraRef(): void {
    this.activeCameraRef = null;
  }

  private getPermissionFn(name: 'getCameraPermissionsAsync' | 'requestCameraPermissionsAsync') {
    if (!this.cameraModule) return null;
    return (
      this.cameraModule[name] ||
      this.cameraModule.Camera?.[name] ||
      this.cameraModule.default?.[name] ||
      this.cameraModule.default?.Camera?.[name]
    );
  }

  async getPermissionStatus(): Promise<CameraPermissionStatus> {
    const fn = this.getPermissionFn('getCameraPermissionsAsync');
    if (!fn) return 'UNAVAILABLE';
    try {
      const response = await fn();
      return this.mapPermissionStatus(response.status, response.canAskAgain);
    } catch {
      return 'UNAVAILABLE';
    }
  }

  async requestPermission(): Promise<CameraPermissionStatus> {
    const fn = this.getPermissionFn('requestCameraPermissionsAsync');
    if (!fn) {
      throw new CameraHardwareError(
        'Neither requestCameraPermissionsAsync nor Camera.requestCameraPermissionsAsync found on expo-camera module',
        'HARDWARE_UNAVAILABLE',
      );
    }
    try {
      const response = await fn();
      return this.mapPermissionStatus(response.status, response.canAskAgain);
    } catch (err: any) {
      throw new CameraHardwareError(
        'Failed to request camera permission from system: ' + (err?.message || String(err)),
        'UNKNOWN',
        err,
      );
    }
  }

  async isCameraAvailable(): Promise<boolean> {
    const status = await this.getPermissionStatus();
    return status === 'GRANTED' || status === 'UNKNOWN' || status === 'DENIED';
  }

  async capturePhoto(options: PhotoCaptureOptions = {}): Promise<CapturedPhoto> {
    const permission = await this.getPermissionStatus();
    if (permission === 'BLOCKED') {
      throw new CameraHardwareError(
        'Camera permission is permanently blocked. Enable it in App Settings.',
        'PERMISSION_BLOCKED',
      );
    }
    if (permission !== 'GRANTED') {
      throw new CameraHardwareError(
        'Camera permission has not been granted by user',
        'PERMISSION_DENIED',
      );
    }

    const facing: CameraFacing = options.facing || DEFAULT_CAMERA_CONFIG.defaultFacing;
    const requestedRatio = options.aspectRatio || DEFAULT_CAMERA_CONFIG.defaultAspectRatio;

    if (!this.activeCameraRef) {
      throw new CameraHardwareError(
        'Camera preview is not active or hardware is not mounted. CameraView ref required.',
        'HARDWARE_UNAVAILABLE',
      );
    }

    try {
      const picture = await this.activeCameraRef.takePictureAsync({
        quality: options.quality ?? DEFAULT_CAMERA_CONFIG.defaultQuality,
        skipProcessing: options.skipProcessing ?? false,
      });

      if (!picture || !picture.uri) {
        throw new CameraHardwareError(
          'Camera capture returned empty photo response',
          'CAPTURE_FAILED',
        );
      }

      const width = picture.width || 1600;
      const height = picture.height || 1200;

      return {
        localUri: picture.uri,
        mimeType: 'image/jpeg',
        width,
        height,
        aspectRatio: requestedRatio,
        capturedAt: new Date().toISOString(),
        facing,
        isTemporary: true,
      };
    } catch (err: any) {
      if (err instanceof CameraHardwareError) {
        throw err;
      }
      throw new CameraHardwareError(
        'Native camera capture failed: ' + (err?.message || 'Unknown error'),
        'CAPTURE_FAILED',
        err,
      );
    }
  }

  private mapPermissionStatus(status: string, canAskAgain: boolean): CameraPermissionStatus {
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

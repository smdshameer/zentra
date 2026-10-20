/**
 * ZENTRA Field — Mock Camera Adapter
 * apps/field/src/hardware/camera/mock-camera-adapter.ts
 *
 * Deterministic in-memory camera provider for unit tests, headless CI, and diagnostics.
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

export class MockCameraAdapter implements ICameraProvider {
  private permissionStatus: CameraPermissionStatus = 'GRANTED';
  private cameraAvailable = true;
  private simulatedError: Error | null = null;
  private photoSequence = 1;
  private attachedCameraRef: any = null;

  attachCameraRef(ref: any): void {
    this.attachedCameraRef = ref;
  }

  detachCameraRef(): void {
    this.attachedCameraRef = null;
  }

  getAttachedCameraRef(): any {
    return this.attachedCameraRef;
  }

  async getPermissionStatus(): Promise<CameraPermissionStatus> {
    return this.permissionStatus;
  }

  async requestPermission(): Promise<CameraPermissionStatus> {
    if (this.permissionStatus === 'BLOCKED') {
      return 'BLOCKED';
    }
    this.permissionStatus = 'GRANTED';
    return this.permissionStatus;
  }

  async isCameraAvailable(): Promise<boolean> {
    return this.cameraAvailable;
  }

  async capturePhoto(options: PhotoCaptureOptions = {}): Promise<CapturedPhoto> {
    if (this.simulatedError) {
      throw this.simulatedError;
    }

    if (!this.cameraAvailable) {
      throw new CameraHardwareError(
        'Camera hardware is unavailable or in use by another process',
        'HARDWARE_UNAVAILABLE',
      );
    }

    if (this.permissionStatus === 'BLOCKED') {
      throw new CameraHardwareError(
        'Camera permission is permanently blocked. Enable it in App Settings.',
        'PERMISSION_BLOCKED',
      );
    }

    if (this.permissionStatus !== 'GRANTED') {
      throw new CameraHardwareError(
        'Camera permission has not been granted by user',
        'PERMISSION_DENIED',
      );
    }

    const facing: CameraFacing = options.facing || DEFAULT_CAMERA_CONFIG.defaultFacing;
    const requestedRatio = options.aspectRatio || DEFAULT_CAMERA_CONFIG.defaultAspectRatio;

    let width = 1600;
    let height = 1200; // 4:3 default

    if (requestedRatio === '16:9') {
      width = 1920;
      height = 1080;
    } else if (requestedRatio === '1:1') {
      width = 1200;
      height = 1200;
    }

    const id = this.photoSequence++;
    let localUri = `file:///data/user/0/com.zentra.field/cache/mock_photo_${id}.jpg`;
    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node built-ins are needed only for Node test execution and must not become static imports in the React Native bundle
        const fs = require('node:fs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node built-ins are needed only for Node test execution and must not become static imports in the React Native bundle
        const os = require('node:os');
        // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node built-ins are needed only for Node test execution and must not become static imports in the React Native bundle
        const path = require('node:path');
        const tmpDir = path.join(os.tmpdir(), 'zentra_camera_mock');
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }
        const tmpFile = path.join(tmpDir, `mock_photo_${id}_${Date.now()}.jpg`);
        fs.writeFileSync(tmpFile, Buffer.from(`MOCK_CAMERA_PHOTO_PAYLOAD_${id}_${Date.now()}`));
        const normalized = tmpFile.replace(/\\/g, '/');
        localUri = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
      } catch {
        // Fallback to synthetic URI
      }
    }

    return {
      localUri,
      mimeType: 'image/jpeg',
      width,
      height,
      aspectRatio: requestedRatio,
      sizeBytes: Math.round(width * height * 0.15), // Approximate JPEG compressed size
      capturedAt: new Date().toISOString(),
      facing,
      isTemporary: true,
    };
  }

  // --- Test & Diagnostic Controls ---

  setPermissionStatus(status: CameraPermissionStatus): void {
    this.permissionStatus = status;
  }

  setCameraAvailable(available: boolean): void {
    this.cameraAvailable = available;
  }

  setSimulatedError(error: Error | null): void {
    this.simulatedError = error;
  }
}

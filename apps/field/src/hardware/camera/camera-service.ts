/**
 * ZENTRA Field — Hardware Camera Service
 * apps/field/src/hardware/camera/camera-service.ts
 *
 * Provides a unified facade for device camera permission handling,
 * rear-camera photo capture, metadata computation, and temporary media tracking.
 *
 * ARCHITECTURAL BOUNDARY:
 * Phase 11 hardware capability only.
 * Does NOT upload to S3, does NOT generate pre-signed URLs,
 * does NOT compute Phase 14 evidence checksums, and creates no evidence entities.
 */

import {
  type AspectRatio,
  type CameraConfig,
  type CameraPermissionStatus,
  type CapturedPhoto,
  type ICameraProvider,
  type PhotoCaptureOptions,
  DEFAULT_CAMERA_CONFIG,
} from './camera.types';
import { TemporaryMediaManager } from './temporary-media-manager';

export class CameraService {
  private readonly config: CameraConfig;

  constructor(
    private readonly provider: ICameraProvider,
    private readonly mediaManager: TemporaryMediaManager = new TemporaryMediaManager(),
    config: Partial<CameraConfig> = {},
  ) {
    this.config = {
      ...DEFAULT_CAMERA_CONFIG,
      ...config,
    };
  }

  /**
   * Retrieves the current camera permission status.
   */
  async getPermissionStatus(): Promise<CameraPermissionStatus> {
    return await this.provider.getPermissionStatus();
  }

  /**
   * Requests camera permission from the operating system.
   */
  async requestPermission(): Promise<CameraPermissionStatus> {
    return await this.provider.requestPermission();
  }

  /**
   * Captures a photo using the native camera hardware.
   * Defaults to rear camera ('back') and controlled aspect ratio ('4:3').
   */
  async capturePhoto(options: PhotoCaptureOptions = {}): Promise<CapturedPhoto> {
    const effectiveOptions: PhotoCaptureOptions = {
      facing: options.facing || this.config.defaultFacing,
      aspectRatio: options.aspectRatio || this.config.defaultAspectRatio,
      quality: options.quality ?? this.config.defaultQuality,
      metadata: options.metadata,
    };

    const photo = await this.provider.capturePhoto(effectiveOptions);

    // Compute aspect ratio string if not already exact
    const computedRatio = this.calculateAspectRatioString(photo.width, photo.height);
    const enrichedPhoto: CapturedPhoto = {
      ...photo,
      aspectRatio: computedRatio || photo.aspectRatio,
    };

    // Track in temporary media manager
    this.mediaManager.register(enrichedPhoto);

    return enrichedPhoto;
  }

  /**
   * Validates whether a captured photo matches the requested or default aspect ratio.
   */
  validateAspectRatio(
    photo: CapturedPhoto,
    expectedRatio: AspectRatio = this.config.defaultAspectRatio,
  ): boolean {
    if (!photo.width || !photo.height) return false;
    const ratio = photo.width / photo.height;

    switch (expectedRatio) {
      case '4:3':
        // 4/3 ≈ 1.3333, also allow portrait 3/4 ≈ 0.75
        return Math.abs(ratio - 4 / 3) < 0.05 || Math.abs(ratio - 3 / 4) < 0.05;
      case '16:9':
        return Math.abs(ratio - 16 / 9) < 0.05 || Math.abs(ratio - 9 / 16) < 0.05;
      case '1:1':
        return Math.abs(ratio - 1) < 0.05;
      default:
        return false;
    }
  }

  /**
   * Computes human-readable aspect ratio string from dimensions.
   */
  calculateAspectRatioString(width: number, height: number): string {
    if (!width || !height) return 'UNKNOWN';
    const ratio = width / height;

    if (Math.abs(ratio - 4 / 3) < 0.05 || Math.abs(ratio - 3 / 4) < 0.05) return '4:3';
    if (Math.abs(ratio - 16 / 9) < 0.05 || Math.abs(ratio - 9 / 16) < 0.05) return '16:9';
    if (Math.abs(ratio - 1) < 0.05) return '1:1';

    return `${width}:${height}`;
  }

  /**
   * Returns the underlying temporary media manager.
   */
  getTemporaryMediaManager(): TemporaryMediaManager {
    return this.mediaManager;
  }

  /**
   * Returns the active camera configuration.
   */
  getConfig(): Readonly<CameraConfig> {
    return this.config;
  }

  /**
   * Attaches an active CameraView instance ref to the camera provider.
   */
  attachCameraRef(ref: any): void {
    if (this.provider && typeof (this.provider as any).attachCameraRef === 'function') {
      (this.provider as any).attachCameraRef(ref);
    }
  }

  /**
   * Detaches and clears the active CameraView instance ref.
   */
  detachCameraRef(): void {
    if (this.provider && typeof (this.provider as any).detachCameraRef === 'function') {
      (this.provider as any).detachCameraRef();
    } else if (this.provider && typeof (this.provider as any).attachCameraRef === 'function') {
      (this.provider as any).attachCameraRef(null);
    }
  }
}


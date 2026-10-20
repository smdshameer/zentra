/**
 * ZENTRA Field — Hardware Camera Types & Contracts
 * apps/field/src/hardware/camera/camera.types.ts
 *
 * Defines strongly typed contracts for mobile rear-camera capture,
 * permission management, photo metadata, and temporary media tracking.
 *
 * ARCHITECTURAL BOUNDARY:
 * Phase 11 hardware capture foundation only.
 * Does NOT upload to S3, does NOT generate pre-signed URLs, and creates no evidence entities.
 */

export type CameraPermissionStatus =
  | 'UNKNOWN'
  | 'GRANTED'
  | 'DENIED'
  | 'BLOCKED'
  | 'UNAVAILABLE';

export type CameraFacing = 'back' | 'front';

export type AspectRatio = '4:3' | '16:9' | '1:1';

export interface PhotoCaptureOptions {
  /** Camera lens facing; defaults to 'back' (rear camera) */
  facing?: CameraFacing;
  /** Compression quality between 0.0 and 1.0 (defaults to 0.85) */
  quality?: number;
  /** Requested aspect ratio; defaults to '4:3' */
  aspectRatio?: AspectRatio;
  /** Skip platform image post-processing for fast capture */
  skipProcessing?: boolean;
  /** Optional metadata tags */
  metadata?: Record<string, string>;
}

export interface CapturedPhoto {
  /** Local device file path or URI (e.g., file:///data/user/0/...) */
  localUri: string;
  /** MIME type of the image (standard: 'image/jpeg') */
  mimeType: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Computed aspect ratio string (e.g. '4:3', '16:9') */
  aspectRatio: string;
  /** File size in bytes if available */
  sizeBytes?: number | null;
  /** Device-side capture timestamp in ISO 8601 UTC */
  capturedAt: string;
  /** Camera lens facing used for capture */
  facing: CameraFacing;
  /** Indicates file is currently in local temporary storage */
  isTemporary: boolean;
}

export type CameraErrorKind =
  | 'PERMISSION_DENIED'
  | 'PERMISSION_BLOCKED'
  | 'HARDWARE_UNAVAILABLE'
  | 'CAPTURE_FAILED'
  | 'STORAGE_ERROR'
  | 'UNKNOWN';

export class CameraHardwareError extends Error {
  constructor(
    message: string,
    public readonly kind: CameraErrorKind,
    public readonly rawError?: unknown,
  ) {
    super(message);
    this.name = 'CameraHardwareError';
    Object.setPrototypeOf(this, CameraHardwareError.prototype);
  }
}

export interface CameraConfig {
  /** Default camera facing (ZENTRA Standard: rear camera) */
  defaultFacing: CameraFacing;
  /** Default aspect ratio (ZENTRA Standard: 4:3) */
  defaultAspectRatio: AspectRatio;
  /** Default JPEG compression quality */
  defaultQuality: number;
}

export const DEFAULT_CAMERA_CONFIG: Readonly<CameraConfig> = Object.freeze({
  defaultFacing: 'back',
  defaultAspectRatio: '4:3',
  defaultQuality: 0.85,
});

/**
 * Pluggable provider interface decoupling camera hardware from business logic
 */
export interface ICameraProvider {
  getPermissionStatus(): Promise<CameraPermissionStatus>;
  requestPermission(): Promise<CameraPermissionStatus>;
  capturePhoto(options?: PhotoCaptureOptions): Promise<CapturedPhoto>;
  isCameraAvailable(): Promise<boolean>;
  attachCameraRef?(ref: any): void;
  detachCameraRef?(): void;
}


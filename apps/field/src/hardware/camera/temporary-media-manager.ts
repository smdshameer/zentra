/**
 * ZENTRA Field — Temporary Media Manager
 * apps/field/src/hardware/camera/temporary-media-manager.ts
 *
 * Manages local references to captured photos in device temporary storage.
 *
 * ARCHITECTURAL BOUNDARY:
 * Phase 11 local media handling only.
 * Does NOT create Phase 14 evidence entities, does NOT maintain an S3 queue,
 * and does NOT serialize binary images into the WatermelonDB operation queue.
 */

import { type CapturedPhoto, CameraHardwareError } from './camera.types';

export interface TemporaryMediaItem {
  id: string;
  localUri: string;
  mimeType: string;
  width: number;
  height: number;
  aspectRatio: string;
  sizeBytes: number | null;
  capturedAt: string;
  isTemporary: boolean;
}

export class TemporaryMediaManager {
  private readonly mediaRegistry = new Map<string, TemporaryMediaItem>();

  /**
   * Registers a newly captured photo in the temporary media registry.
   */
  register(photo: CapturedPhoto, customId?: string): TemporaryMediaItem {
    if (!photo.localUri) {
      throw new CameraHardwareError(
        'Cannot register photo with empty local URI',
        'STORAGE_ERROR',
      );
    }

    const id = customId || `temp_img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const item: TemporaryMediaItem = {
      id,
      localUri: photo.localUri,
      mimeType: photo.mimeType,
      width: photo.width,
      height: photo.height,
      aspectRatio: photo.aspectRatio,
      sizeBytes: photo.sizeBytes ?? null,
      capturedAt: photo.capturedAt,
      isTemporary: true,
    };

    this.mediaRegistry.set(id, item);
    return item;
  }

  /**
   * Retrieves a temporary media item by identifier.
   */
  get(id: string): TemporaryMediaItem | undefined {
    return this.mediaRegistry.get(id);
  }

  /**
   * Lists all currently tracked temporary media items.
   */
  listAll(): TemporaryMediaItem[] {
    return Array.from(this.mediaRegistry.values());
  }

  /**
   * Removes a media item from the local registry.
   */
  remove(id: string): boolean {
    return this.mediaRegistry.delete(id);
  }

  /**
   * Clears the entire registry.
   */
  clear(): void {
    this.mediaRegistry.clear();
  }

  /**
   * Returns the count of tracked temporary media items.
   */
  count(): number {
    return this.mediaRegistry.size;
  }
}

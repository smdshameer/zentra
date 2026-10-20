/**
 * ZENTRA Field — Hardware Camera Test Suite (Phase 11)
 * apps/field/test/hardware-camera.spec.ts
 *
 * Verifies mobile camera hardware integration, permission handling,
 * rear-camera photo capture, aspect ratio evaluation, and temporary media handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CameraService,
  TemporaryMediaManager,
  CameraHardwareError,
  DEFAULT_CAMERA_CONFIG,
} from '../src/hardware/camera';
import { MockCameraAdapter } from '../src/hardware/camera/mock-camera-adapter';

describe('Phase 11 — Mobile Hardware Camera Module', () => {
  let mockAdapter: MockCameraAdapter;
  let mediaManager: TemporaryMediaManager;
  let cameraService: CameraService;

  beforeEach(() => {
    mockAdapter = new MockCameraAdapter();
    mediaManager = new TemporaryMediaManager();
    cameraService = new CameraService(mockAdapter, mediaManager);
  });

  // --- 1. Permission Handling ---

  describe('Camera Permissions', () => {
    it('reports UNKNOWN initially when permissions are undetermined', async () => {
      mockAdapter.setPermissionStatus('UNKNOWN');
      const status = await cameraService.getPermissionStatus();
      expect(status).toBe('UNKNOWN');
    });

    it('reports GRANTED when camera permission is granted', async () => {
      mockAdapter.setPermissionStatus('GRANTED');
      const status = await cameraService.getPermissionStatus();
      expect(status).toBe('GRANTED');
    });

    it('reports DENIED when camera permission is denied', async () => {
      mockAdapter.setPermissionStatus('DENIED');
      const status = await cameraService.getPermissionStatus();
      expect(status).toBe('DENIED');
    });

    it('reports BLOCKED when camera permission is permanently blocked in settings', async () => {
      mockAdapter.setPermissionStatus('BLOCKED');
      const status = await cameraService.getPermissionStatus();
      expect(status).toBe('BLOCKED');
    });

    it('requests camera permission and updates state cleanly', async () => {
      mockAdapter.setPermissionStatus('UNKNOWN');
      const result = await cameraService.requestPermission();
      expect(result).toBe('GRANTED');
      expect(await cameraService.getPermissionStatus()).toBe('GRANTED');
    });

    it('throws deterministic error when capturing while permission is DENIED', async () => {
      mockAdapter.setPermissionStatus('DENIED');
      try {
        await cameraService.capturePhoto();
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CameraHardwareError);
        expect(err.kind).toBe('PERMISSION_DENIED');
      }
    });

    it('throws deterministic error when capturing while permission is BLOCKED', async () => {
      mockAdapter.setPermissionStatus('BLOCKED');
      try {
        await cameraService.capturePhoto();
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CameraHardwareError);
        expect(err.kind).toBe('PERMISSION_BLOCKED');
      }
    });

    it('throws deterministic error when camera hardware is unavailable', async () => {
      mockAdapter.setCameraAvailable(false);
      try {
        await cameraService.capturePhoto();
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CameraHardwareError);
        expect(err.kind).toBe('HARDWARE_UNAVAILABLE');
      }
    });
  });

  // --- 2. Rear Camera Capture & Aspect Ratio ---

  describe('Rear Camera Capture & Aspect Ratio', () => {
    it('defaults to rear camera (facing: back) and standard 4:3 aspect ratio', async () => {
      expect(DEFAULT_CAMERA_CONFIG.defaultFacing).toBe('back');
      expect(DEFAULT_CAMERA_CONFIG.defaultAspectRatio).toBe('4:3');

      const photo = await cameraService.capturePhoto();

      expect(photo.facing).toBe('back');
      expect(photo.aspectRatio).toBe('4:3');
      expect(photo.mimeType).toBe('image/jpeg');
      expect(photo.width).toBe(1600);
      expect(photo.height).toBe(1200);
      expect(photo.localUri).toMatch(/^file:\/\//);
      expect(photo.isTemporary).toBe(true);
    });

    it('validates 4:3 aspect ratio correctly for landscape and portrait orientations', () => {
      const landscapePhoto = {
        localUri: 'file:///temp/test.jpg',
        mimeType: 'image/jpeg',
        width: 1600,
        height: 1200, // 1600 / 1200 = 1.333
        aspectRatio: '4:3',
        capturedAt: new Date().toISOString(),
        facing: 'back' as const,
        isTemporary: true,
      };

      const portraitPhoto = {
        ...landscapePhoto,
        width: 1200,
        height: 1600, // 1200 / 1600 = 0.75
      };

      expect(cameraService.validateAspectRatio(landscapePhoto, '4:3')).toBe(true);
      expect(cameraService.validateAspectRatio(portraitPhoto, '4:3')).toBe(true);
    });

    it('supports 16:9 and 1:1 aspect ratio configurations', async () => {
      const photo169 = await cameraService.capturePhoto({ aspectRatio: '16:9' });
      expect(photo169.aspectRatio).toBe('16:9');
      expect(photo169.width).toBe(1920);
      expect(photo169.height).toBe(1080);
      expect(cameraService.validateAspectRatio(photo169, '16:9')).toBe(true);

      const photo11 = await cameraService.capturePhoto({ aspectRatio: '1:1' });
      expect(photo11.aspectRatio).toBe('1:1');
      expect(photo11.width).toBe(1200);
      expect(photo11.height).toBe(1200);
      expect(cameraService.validateAspectRatio(photo11, '1:1')).toBe(true);
    });

    it('rejects mismatching aspect ratio validation', () => {
      const squarePhoto = {
        localUri: 'file:///temp/test.jpg',
        mimeType: 'image/jpeg',
        width: 1000,
        height: 1000,
        aspectRatio: '1:1',
        capturedAt: new Date().toISOString(),
        facing: 'back' as const,
        isTemporary: true,
      };

      expect(cameraService.validateAspectRatio(squarePhoto, '4:3')).toBe(false);
      expect(cameraService.validateAspectRatio(squarePhoto, '16:9')).toBe(false);
      expect(cameraService.validateAspectRatio(squarePhoto, '1:1')).toBe(true);
    });
  });

  // --- 3. Temporary Media Management ---

  describe('Temporary Media Management', () => {
    it('automatically registers captured photo in TemporaryMediaManager', async () => {
      expect(mediaManager.count()).toBe(0);

      const photo = await cameraService.capturePhoto();

      expect(mediaManager.count()).toBe(1);
      const items = mediaManager.listAll();
      expect(items.length).toBe(1);
      expect(items[0]?.localUri).toBe(photo.localUri);
      expect(items[0]?.isTemporary).toBe(true);
      expect(items[0]?.mimeType).toBe('image/jpeg');
    });

    it('retrieves and removes individual temporary media items by id', async () => {
      const photo = await cameraService.capturePhoto();
      const items = mediaManager.listAll();
      const itemId = items[0]!.id;

      const retrieved = mediaManager.get(itemId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.localUri).toBe(photo.localUri);

      const removed = mediaManager.remove(itemId);
      expect(removed).toBe(true);
      expect(mediaManager.count()).toBe(0);
      expect(mediaManager.get(itemId)).toBeUndefined();
    });

    it('clears all temporary media items on command', async () => {
      await cameraService.capturePhoto();
      await cameraService.capturePhoto();
      expect(mediaManager.count()).toBe(2);

      mediaManager.clear();
      expect(mediaManager.count()).toBe(0);
      expect(mediaManager.listAll()).toEqual([]);
    });

    it('throws error when attempting to register a photo with empty localUri', () => {
      expect(() => {
        mediaManager.register({
          localUri: '',
          mimeType: 'image/jpeg',
          width: 100,
          height: 100,
          aspectRatio: '1:1',
          capturedAt: new Date().toISOString(),
          facing: 'back',
          isTemporary: true,
        });
      }).toThrow(CameraHardwareError);
    });
  });
});

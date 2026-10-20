/**
 * ZENTRA Field — Native Camera Viewfinder Modal
 * apps/field/src/components/camera/CameraViewfinderModal.tsx
 *
 * Provides a mounted CameraView lifecycle adhering to Expo Camera API (SDK 52):
 * - Attaches active CameraView ref to CameraService upon mount
 * - Safely detaches ref upon unmount, modal close, or app backgrounding
 * - Prevents duplicate captures during in-flight operations
 * - Displays slot-specific guidance (Slot 1 HM Signed Report vs Slot 2 Equipment Photo)
 * - Provides error display and retry handling
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { CameraView } from 'expo-camera';
import {
  CameraService,
  type CapturedPhoto,
} from '../../hardware/camera';
import type { EvidenceSlot } from '@zentra/types';


export interface CameraViewfinderModalProps {
  visible: boolean;
  slot: EvidenceSlot | null;
  cameraService: CameraService;
  onPhotoCaptured: (photo: CapturedPhoto) => Promise<void> | void;
  onClose: () => void;
}

export function CameraViewfinderModal({
  visible,
  slot,
  cameraService,
  onPhotoCaptured,
  onClose,
}: CameraViewfinderModalProps) {
  const cameraRef = useRef<any>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Safely detach camera ref when closing
  const handleClose = useCallback(() => {
    if (isCapturing) return; // Prevent closing mid-capture
    cameraService.detachCameraRef();
    cameraRef.current = null;
    setCaptureError(null);
    onClose();
  }, [cameraService, isCapturing, onClose]);

  // Handle app backgrounding lifecycle to prevent stale references
  useEffect(() => {
    if (!visible) return;

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active') {
        cameraService.detachCameraRef();
        cameraRef.current = null;
        onClose();
      }
    });

    return () => {
      subscription.remove();
      cameraService.detachCameraRef();
      cameraRef.current = null;
    };
  }, [visible, cameraService, onClose]);

  const handleCameraMount = (ref: any) => {
    cameraRef.current = ref;
    if (ref) {
      cameraService.attachCameraRef(ref);
    } else {
      cameraService.detachCameraRef();
    }
  };

  const handleCapture = async () => {
    if (isCapturing) return; // Prevent duplicate rapid taps
    if (!cameraRef.current) {
      setCaptureError('Camera hardware is not mounted or active. Please retry.');
      return;
    }

    setIsCapturing(true);
    setCaptureError(null);

    try {
      const photo = await cameraService.capturePhoto({
        facing: 'back',
        aspectRatio: '4:3',
        quality: 0.85,
      });

      // Detach immediately on success before handing off
      cameraService.detachCameraRef();
      cameraRef.current = null;

      await onPhotoCaptured(photo);
    } catch (err: any) {
      setCaptureError(err?.message || 'Native photo capture failed. Please retry.');
    } finally {
      setIsCapturing(false);
    }
  };

  if (!visible) return null;

  const isSlot1 = slot === 'SLOT_1_HM_SIGNED_REPORT';
  const slotTitle = isSlot1
    ? 'SLOT 1: HM SIGNED REPORT'
    : 'SLOT 2: EQUIPMENT WORKING PHOTO';
  const slotGuidance = isSlot1
    ? 'Frame the signed and stamped completion report flat with all 4 corners visible.'
    : 'Frame the operational lab equipment clearly, including power/status lights.';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={styles.container}>
        {/* Real Mounted CameraView */}
        {CameraView ? (
          <CameraView
            ref={handleCameraMount}
            style={StyleSheet.absoluteFillObject}
            facing="back"
          />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, styles.unavailablePlaceholder]}>
            <Text style={styles.unavailableText}>CameraView module is not available in this environment.</Text>
          </View>
        )}

        <SafeAreaView style={styles.overlayContainer}>
          {/* Top Header */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleClose}
              disabled={isCapturing}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelText}>&#x2715; Cancel</Text>
            </TouchableOpacity>
            <View style={styles.titleContainer}>
              <Text style={styles.slotTitleText}>{slotTitle}</Text>
            </View>
          </View>

          {/* Framing Guidance Banner */}
          <View style={styles.guidanceBanner}>
            <Text style={styles.guidanceText}>{slotGuidance}</Text>
          </View>

          {/* Center Viewfinder Reticle */}
          <View style={styles.reticleContainer} pointerEvents="none">
            <View style={styles.reticleBox}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
          </View>

          {/* Error Banner if capture failed */}
          {captureError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{captureError}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => setCaptureError(null)}
                activeOpacity={0.7}
              >
                <Text style={styles.retryButtonText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Bottom Shutter Controls */}
          <View style={styles.bottomBar}>
            <View style={styles.shutterRow}>
              <TouchableOpacity
                style={[styles.shutterButton, isCapturing && styles.shutterDisabled]}
                onPress={handleCapture}
                disabled={isCapturing}
                activeOpacity={0.8}
              >
                {isCapturing ? (
                  <ActivityIndicator color="#0F172A" size="large" />
                ) : (
                  <View style={styles.shutterInner} />
                )}
              </TouchableOpacity>
            </View>
            <Text style={styles.shutterHint}>
              {isCapturing ? 'Capturing high-resolution photo...' : 'Tap shutter to capture photo'}
            </Text>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  unavailablePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: 24,
  },
  unavailableText: {
    color: '#EF4444',
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '600',
  },
  overlayContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  cancelButton: {
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
  },
  cancelText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  titleContainer: {
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  slotTitleText: {
    color: '#93C5FD',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  guidanceBanner: {
    marginHorizontal: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  guidanceText: {
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  reticleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  reticleBox: {
    width: '90%',
    aspectRatio: 4 / 3,
    position: 'relative',
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderWidth: 1,
    borderRadius: 8,
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: '#F59E0B',
  },
  cornerTL: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  cornerTR: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  cornerBL: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  cornerBR: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  errorBanner: {
    marginHorizontal: 16,
    backgroundColor: 'rgba(127, 29, 29, 0.95)',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  errorText: {
    color: '#FEE2E2',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  retryButton: {
    backgroundColor: '#991B1B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  bottomBar: {
    alignItems: 'center',
    paddingBottom: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingTop: 16,
  },
  shutterRow: {
    marginBottom: 8,
  },
  shutterButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  shutterDisabled: {
    opacity: 0.5,
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F59E0B',
  },
  shutterHint: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
});

/**
 * ZENTRA Field — Hardware Diagnostics Screen (Phase 11)
 * apps/field/src/screens/HardwareDiagnosticsScreen.tsx
 *
 * Dedicated diagnostic and verification interface for Phase 11 hardware capabilities:
 * - GPS location acquisition, permission states, and ≤ 50m accuracy verification
 * - Geofence distance calculation using Haversine formula
 * - Rear-camera permission checks, controlled capture, and photo metadata
 * Redesigned with enterprise light theme tokens and reusable UI primitives.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import {
  LocationService,
  type LocationPermissionStatus,
  type LocationSample,
  type GeofenceResult,
} from '../hardware/location';
import {
  CameraService,
  type CameraPermissionStatus,
  type CapturedPhoto,
} from '../hardware/camera';
import { colors, spacing, typography, radii } from '../theme';
import { Card, Badge, Button, Icon } from '../components/ui';

interface HardwareDiagnosticsScreenProps {
  locationService: LocationService;
  cameraService: CameraService;
  onBack: () => void;
}

export function HardwareDiagnosticsScreen({
  locationService,
  cameraService,
  onBack,
}: HardwareDiagnosticsScreenProps) {
  // Location States
  const [locPermission, setLocPermission] = useState<LocationPermissionStatus>('UNKNOWN');
  const [isAcquiringLocation, setIsAcquiringLocation] = useState(false);
  const [currentSample, setCurrentSample] = useState<LocationSample | null>(null);
  const [geofenceResult, setGeofenceResult] = useState<GeofenceResult | null>(null);

  // Camera States
  const [camPermission, setCamPermission] = useState<CameraPermissionStatus>('UNKNOWN');
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);

  useEffect(() => {
    checkInitialPermissions();
  }, []);

  const checkInitialPermissions = async () => {
    try {
      const locStatus = await locationService.getPermissionStatus();
      setLocPermission(locStatus);
      const camStatus = await cameraService.getPermissionStatus();
      setCamPermission(camStatus);
    } catch (err: any) {
      console.warn('Failed to query initial hardware permissions:', err);
    }
  };

  // --- Location Handlers ---

  const handleRequestLocationPermission = async () => {
    try {
      const status = await locationService.requestPermission();
      setLocPermission(status);
      Alert.alert('Location Permission', `Status updated: ${status}`);
    } catch (err: any) {
      Alert.alert('Permission Error', err.message || 'Failed to request location permission');
    }
  };

  const handleAcquireLocation = async () => {
    setIsAcquiringLocation(true);
    try {
      const { sample } = await locationService.acquireValidatedLocation();
      setCurrentSample(sample);

      // Evaluate test geofence against reference school (Perundurai: 11.2724, 77.5833)
      const targetLat = 11.2724;
      const targetLon = 77.5833;
      const geo = locationService.verifyGeofence(sample, targetLat, targetLon);
      setGeofenceResult(geo);
    } catch (err: any) {
      Alert.alert('GPS Fix Failed', err.message || 'Unable to acquire native GPS fix');
    } finally {
      setIsAcquiringLocation(false);
    }
  };

  // --- Camera Handlers ---

  const handleRequestCameraPermission = async () => {
    try {
      const status = await cameraService.requestPermission();
      setCamPermission(status);
      Alert.alert('Camera Permission', `Status updated: ${status}`);
    } catch (err: any) {
      Alert.alert('Permission Error', err.message || 'Failed to request camera permission');
    }
  };

  const handleCapturePhoto = async () => {
    setIsCapturingPhoto(true);
    try {
      const photo = await cameraService.capturePhoto({
        facing: 'back',
        aspectRatio: '4:3',
      });
      setCapturedPhoto(photo);
      Alert.alert(
        'Photo Captured',
        `Successfully captured rear-camera test photo at ${photo.width}x${photo.height} (${photo.aspectRatio}). Registered in local temporary storage.`,
      );
    } catch (err: any) {
      Alert.alert('Capture Failed', err.message || 'Failed to capture photo');
    } finally {
      setIsCapturingPhoto(false);
    }
  };

  const isAccuracyValid = currentSample
    ? locationService.isAccuracyValid(currentSample)
    : false;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
          <Icon name="arrow-left" size={16} color={colors.primary} />
          <Text style={styles.backText}>Profile</Text>
        </TouchableOpacity>
        <Text style={styles.barTitle}>Hardware Diagnostics</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Scope Disclaimer Banner */}
      <Card variant="primary" style={styles.scopeBanner}>
        <View style={styles.scopeHeader}>
          <Icon name="alert" size={16} color={colors.primary} />
          <Text style={styles.scopeBannerTitle}>HARDWARE VERIFICATION INTERFACE</Text>
        </View>
        <Text style={styles.scopeBannerText}>
          Validates native GPS acquisition, ≤ 50m accuracy checks, geofencing, and rear-camera capture.
        </Text>
      </Card>

      {/* 1. GPS & LOCATION SECTION */}
      <Card variant="default" style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.headerTitleWrap}>
            <Icon name="location" size={16} color={colors.primary} />
            <Text style={styles.cardHeader}>1. GPS & LOCATION HARDWARE</Text>
          </View>
          <Badge
            label={locPermission}
            variant={locPermission === 'GRANTED' ? 'success' : 'danger'}
            size="sm"
          />
        </View>

        <Text style={styles.infoText}>
          Target GPS Accuracy: ≤ {locationService.getConfig().maxAccuracyThresholdMeters} meters
        </Text>

        <View style={styles.buttonRow}>
          <Button
            title="REQUEST PERMISSION"
            variant="outline"
            size="md"
            onPress={handleRequestLocationPermission}
            style={{ flex: 1 }}
          />
          <Button
            title="ACQUIRE GPS FIX"
            variant="primary"
            size="md"
            loading={isAcquiringLocation}
            onPress={handleAcquireLocation}
            style={{ flex: 1 }}
          />
        </View>

        {currentSample && (
          <View style={styles.metadataContainer}>
            <Text style={styles.metaTitle}>CURRENT LOCATION FIX</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Latitude:</Text>
              <Text style={styles.metaCoord}>{currentSample.latitude.toFixed(6)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Longitude:</Text>
              <Text style={styles.metaCoord}>{currentSample.longitude.toFixed(6)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Accuracy:</Text>
              <Badge
                label={`${currentSample.accuracyMeters}m (${isAccuracyValid ? 'VALID \u2264 50m' : 'INSUFFICIENT > 50m'})`}
                variant={isAccuracyValid ? 'success' : 'danger'}
                size="sm"
                dot
              />
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Timestamp:</Text>
              <Text style={styles.metaValue}>{currentSample.capturedAt}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Source:</Text>
              <Text style={styles.metaValue}>{currentSample.source || 'GPS'}</Text>
            </View>
          </View>
        )}

        {geofenceResult && (
          <View style={styles.geofenceContainer}>
            <Text style={styles.metaTitle}>GEOFENCE PROXIMITY TEST</Text>
            <Text style={styles.geofenceTarget}>
              Target: Reference School (Perundurai — 11.2724, 77.5833)
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Haversine Distance:</Text>
              <Text style={styles.metaValue}>{geofenceResult.distanceMeters} meters</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Geofence Status:</Text>
              <Badge
                label={geofenceResult.insideGeofence ? 'INSIDE GEOFENCE (\u2264 500m)' : 'OUTSIDE GEOFENCE'}
                variant={geofenceResult.insideGeofence ? 'success' : 'danger'}
                size="sm"
              />
            </View>
          </View>
        )}
      </Card>

      {/* 2. REAR CAMERA SECTION */}
      <Card variant="default" style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.headerTitleWrap}>
            <Icon name="camera" size={16} color={colors.primary} />
            <Text style={styles.cardHeader}>2. REAR CAMERA HARDWARE</Text>
          </View>
          <Badge
            label={camPermission}
            variant={camPermission === 'GRANTED' ? 'success' : 'danger'}
            size="sm"
          />
        </View>

        <Text style={styles.infoText}>
          Facing: {cameraService.getConfig().defaultFacing.toUpperCase()} | Aspect Ratio: {cameraService.getConfig().defaultAspectRatio}
        </Text>

        <View style={styles.buttonRow}>
          <Button
            title="REQUEST PERMISSION"
            variant="outline"
            size="md"
            onPress={handleRequestCameraPermission}
            style={{ flex: 1 }}
          />
          <Button
            title="CAPTURE TEST PHOTO"
            variant="primary"
            size="md"
            loading={isCapturingPhoto}
            onPress={handleCapturePhoto}
            style={{ flex: 1 }}
          />
        </View>

        {capturedPhoto && (
          <View style={styles.metadataContainer}>
            <Text style={styles.metaTitle}>CAPTURED PHOTO METADATA</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Dimensions:</Text>
              <Text style={styles.metaValue}>
                {capturedPhoto.width} &times; {capturedPhoto.height}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Aspect Ratio:</Text>
              <Text style={styles.metaValue}>{capturedPhoto.aspectRatio}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>MIME Type:</Text>
              <Text style={styles.metaValue}>{capturedPhoto.mimeType}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Captured At:</Text>
              <Text style={styles.metaValue}>{capturedPhoto.capturedAt}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Local Storage:</Text>
              <Text style={styles.metaCoord} numberOfLines={1}>
                {capturedPhoto.localUri}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Temporary Queue:</Text>
              <Text style={styles.metaValue}>
                {cameraService.getTemporaryMediaManager().count()} items registered
              </Text>
            </View>
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  backText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  barTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  scopeBanner: {
    marginBottom: spacing.md,
  },
  scopeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 4,
  },
  scopeBannerTitle: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  scopeBannerText: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  card: {
    marginBottom: spacing.md,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cardHeader: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  infoText: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  metadataContainer: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginTop: spacing.xs,
  },
  geofenceContainer: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginTop: spacing.sm,
  },
  geofenceTarget: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  metaTitle: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  metaLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  metaValue: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  metaCoord: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '600',
    fontFamily: 'monospace',
    flex: 1,
    textAlign: 'right',
  },
});

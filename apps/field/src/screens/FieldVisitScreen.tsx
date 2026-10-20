/**
 * ZENTRA Field — Field Visit Execution Screen
 * apps/field/src/screens/FieldVisitScreen.tsx
 *
 * Implements mobile outdoor high-contrast interface for Field Visit Execution:
 * - Deterministic sequence tracking (Visit #1, Visit #2...)
 * - GPS proximity check-in with accuracy gating (<= 50m) and provisional geofence indicator
 * - On-site work diagnostic & repair logging (IN_PROGRESS)
 * - Check-out with structured outcome selection (RESOLVED_ON_SITE, PENDING_PARTS, etc.)
 * - Dual evidence slot capture with SHA-256 metadata display
 * - Multi-visit history drawer preserving immutable records
 * - Phase 15 Conveyance Claim logging with rate calculation
 * - Fully redesigned with enterprise light theme tokens and reusable UI primitives
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import type { ServiceCaseModel } from '../database/models/ServiceCaseModel';
import type { FieldVisitModel } from '../database/models/FieldVisitModel';
import type { SchoolModel } from '../database/models/SchoolModel';
import type { EvidenceModel } from '../database/models/EvidenceModel';
import type { EquipmentModel } from '../database/models/EquipmentModel';
import type { LocationService } from '../hardware/location/location-service';
import type { CameraService, CapturedPhoto } from '../hardware/camera';
import type { VisitOutcome, TravelMode, EvidenceSlot } from '@zentra/types';
import { CameraViewfinderModal } from '../components/camera/CameraViewfinderModal';
import { colors, spacing, typography, radii } from '../theme';
import { Card, Badge, Button, Icon } from '../components/ui';

export interface CaptureEvidenceCallbackParams {
  visitId: string;
  serviceCaseId: string;
  slot: EvidenceSlot;
  photo: CapturedPhoto;
  gps?: { latitude?: number | null; longitude?: number | null; accuracyMeters?: number | null };
}

export interface FieldVisitScreenProps {
  serviceCase: ServiceCaseModel;
  school?: SchoolModel | null;
  visits: FieldVisitModel[];
  activeVisit?: FieldVisitModel | null;
  locationService: LocationService;
  cameraService?: CameraService;
  evidenceItems?: EvidenceModel[];
  labEquipment?: EquipmentModel[];
  selectedEquipmentId?: string;
  onSelectEquipment?: (equipmentId: string) => void;
  onCreateVisit: (notes?: string) => Promise<void>;
  onCheckIn: (visitId: string, equipmentCondition?: string, notes?: string) => Promise<void>;
  onStartWork: (visitId: string, diagnosis?: string, condition?: string, notes?: string) => Promise<void>;
  onCheckOut: (
    visitId: string,
    outcome: VisitOutcome,
    workPerformed?: string,
    diagnosis?: string,
    pendingReason?: string,
    nextVisitDate?: string,
  ) => Promise<void>;
  onCaptureEvidence?: (params: CaptureEvidenceCallbackParams) => Promise<EvidenceModel>;
  onLogConveyanceClaim?: (params: {
    travelMode: TravelMode;
    startingOdometerKm?: number | null;
    endingOdometerKm?: number | null;
    claimedDistanceKm: number;
    remarks?: string | null;
  }) => Promise<void>;
  existingConveyanceClaim?: {
    claimStatus: string;
    claimedDistanceKm: number;
    calculatedAmount: number;
    appliedRatePerKm: number;
    travelMode: string;
    remarks?: string | null;
  } | null;
  onBack: () => void;
}

export function FieldVisitScreen({
  serviceCase,
  school,
  visits,
  activeVisit,
  locationService,
  cameraService,
  evidenceItems = [],
  labEquipment = [],
  selectedEquipmentId,
  onSelectEquipment,
  onCreateVisit,
  onCheckIn,
  onStartWork,
  onCheckOut,
  onCaptureEvidence,
  onLogConveyanceClaim,
  existingConveyanceClaim,
  onBack,
}: FieldVisitScreenProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [equipmentCondition, setEquipmentCondition] = useState('');
  const [selectedEquipId, setSelectedEquipId] = useState<string>(
    selectedEquipmentId || (labEquipment.length > 0 ? labEquipment[0]?.id || '' : ''),
  );
  const [onSiteDiagnosis, setOnSiteDiagnosis] = useState('');
  const [workPerformed, setWorkPerformed] = useState('');
  const [pendingReason, setPendingReason] = useState('');
  const [nextVisitDate, setNextVisitDate] = useState('');
  const [selectedOutcome, setSelectedOutcome] = useState<VisitOutcome>('RESOLVED_ON_SITE');
  const [notes, setNotes] = useState('');
  const [isCreatingVisit, setIsCreatingVisit] = useState(false);
  const [activeCameraSlot, setActiveCameraSlot] = useState<EvidenceSlot | null>(null);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);

  const handleCreateVisitPress = async () => {
    if (isCreatingVisit || isBusy) return;
    setIsCreatingVisit(true);
    try {
      if (onCreateVisit) {
        await onCreateVisit(notes);
      }
    } catch (err: any) {
      Alert.alert('Visit Creation Failed', err?.message || 'Failed to create field visit');
    } finally {
      setIsCreatingVisit(false);
    }
  };

  // Phase 15 Conveyance Claims state
  const [claimTravelMode, setClaimTravelMode] = useState<TravelMode>('BIKE');
  const [startingOdometer, setStartingOdometer] = useState('');
  const [endingOdometer, setEndingOdometer] = useState('');
  const [claimDistance, setClaimDistance] = useState('');
  const [claimRemarks, setClaimRemarks] = useState('');

  // Proximity acquisition state
  const [gpsSample, setGpsSample] = useState<{
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    distanceMeters?: number | null;
    insideGeofence?: boolean;
  } | null>(null);

  const handleAcquireLocation = async () => {
    setIsBusy(true);
    try {
      const permStatus = await locationService.getPermissionStatus();
      if (permStatus !== 'GRANTED') {
        const req = await locationService.requestPermission();
        if (req !== 'GRANTED') {
          Alert.alert(
            'Location Permission Denied',
            'Location permission is required to acquire GPS coordinates for on-site check-in. Please grant location access.',
          );
          return;
        }
      }
      const acquisition = await locationService.acquireValidatedLocation();
      let distanceMeters: number | null = null;
      let insideGeofence = true;

      if (school?.latitude && school?.longitude) {
        const geo = locationService.verifyGeofence(
          acquisition.sample,
          school.latitude,
          school.longitude,
        );
        distanceMeters = geo.distanceMeters;
        insideGeofence = geo.insideGeofence;
      }

      setGpsSample({
        latitude: acquisition.sample.latitude,
        longitude: acquisition.sample.longitude,
        accuracyMeters: acquisition.sample.accuracyMeters,
        distanceMeters,
        insideGeofence,
      });

      if (!acquisition.isValidAccuracy) {
        Alert.alert(
          'Low GPS Accuracy',
          `GPS accuracy is ${acquisition.sample.accuracyMeters}m. ZENTRA requires <= 50m for valid on-site physical check-in.`,
        );
      }
    } catch (err: any) {
      Alert.alert('GPS Acquisition Failed', err.message || 'Could not acquire GPS fix.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleCheckIn = async () => {
    if (!activeVisit) return;
    setIsBusy(true);
    try {
      await onCheckIn(activeVisit.id, equipmentCondition, notes);
      Alert.alert('Check-In Successful', 'Visit checked in on-site. GPS coordinates and device timestamp persisted.');
    } catch (err: any) {
      Alert.alert('Check-In Failed', err.message || 'Check-in failed');
    } finally {
      setIsBusy(false);
    }
  };

  const handleStartWork = async () => {
    if (!activeVisit) return;
    setIsBusy(true);
    try {
      await onStartWork(activeVisit.id, onSiteDiagnosis, equipmentCondition, notes);
      Alert.alert('Work Started', 'Visit status moved to IN_PROGRESS.');
    } catch (err: any) {
      Alert.alert('Start Work Failed', err.message || 'Failed to start work');
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Resolves the active evidence record for a specific slot on the active visit.
   * Deterministically orders by capturedAt / createdAt DESC so latest retake is displayed.
   */
  const getSlotEvidence = (slot: EvidenceSlot): EvidenceModel | undefined => {
    if (!evidenceItems || evidenceItems.length === 0) return undefined;
    const matching = evidenceItems.filter(
      (e) =>
        e.evidenceSlot === slot &&
        (!activeVisit || e.visitId === activeVisit.id || e.visitId === activeVisit.serverId),
    );
    if (matching.length === 0) return undefined;
    return matching.slice().sort((a, b) => {
      const timeA = a.capturedAt || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const timeB = b.capturedAt || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return timeB - timeA;
    })[0];
  };

  const handleCaptureSlotPhoto = async (slot: EvidenceSlot) => {
    if (!cameraService) {
      Alert.alert('Camera Unavailable', 'Camera service is not initialized on this device.');
      return;
    }
    if (!activeVisit) {
      Alert.alert('No Active Visit', 'Cannot capture evidence without an active field visit.');
      return;
    }

    try {
      const status = await cameraService.getPermissionStatus();
      if (status !== 'GRANTED') {
        const requested = await cameraService.requestPermission();
        if (requested !== 'GRANTED') {
          Alert.alert(
            'Camera Permission Denied',
            'Camera permission is required to capture mandatory on-site evidence. Please enable camera access in app settings.',
          );
          return;
        }
      }

      setActiveCameraSlot(slot);
      setIsCameraModalOpen(true);
    } catch (err: any) {
      Alert.alert('Camera Error', err?.message || 'Failed to initialize camera');
    }
  };

  const handlePhotoCapturedFromViewfinder = async (photo: CapturedPhoto) => {
    const slot = activeCameraSlot;
    if (!slot) return;

    if (!activeVisit || !activeVisit.id) {
      Alert.alert(
        'Evidence Capture Blocked',
        'No active field visit is selected. Cannot attach evidence without a valid visit.',
      );
      setIsCameraModalOpen(false);
      setActiveCameraSlot(null);
      return;
    }

    const targetServiceCaseId = activeVisit.serviceCaseId || serviceCase?.id || serviceCase?.serverId;
    if (!targetServiceCaseId) {
      Alert.alert(
        'Evidence Capture Blocked',
        'Target service case could not be identified for the active visit.',
      );
      setIsCameraModalOpen(false);
      setActiveCameraSlot(null);
      return;
    }

    setIsCameraModalOpen(false);
    setActiveCameraSlot(null);

    const gpsMetadata = gpsSample
      ? {
          latitude: gpsSample.latitude,
          longitude: gpsSample.longitude,
          accuracyMeters: gpsSample.accuracyMeters,
        }
      : undefined;

    if (onCaptureEvidence) {
      try {
        await onCaptureEvidence({
          visitId: activeVisit.id,
          serviceCaseId: targetServiceCaseId,
          slot,
          photo,
          gps: gpsMetadata,
        });
        Alert.alert(
          'Evidence Captured & Queued',
          `Photo for ${slot === 'SLOT_1_HM_SIGNED_REPORT' ? 'Slot 1 (HM Signed Report)' : 'Slot 2 (Equipment Photo)'} has been saved and queued locally in WatermelonDB.`,
        );
      } catch (err: any) {
        Alert.alert('Evidence Capture Failed', err?.message || 'Failed to store evidence');
      }
    } else {
      Alert.alert('Photo Captured', `Captured photo at ${photo.localUri}.`);
    }
  };

  const handleCheckOut = async () => {
    if (!activeVisit) return;

    if (
      (selectedOutcome === 'PENDING_PARTS' || selectedOutcome === 'RETURN_VISIT_REQUIRED') &&
      !pendingReason.trim()
    ) {
      Alert.alert('Pending Reason Required', 'Please provide reason/part details for return visit.');
      return;
    }

    // Validate mandatory evidence for on-site resolution
    if (selectedOutcome === 'RESOLVED_ON_SITE') {
      const slot1 = getSlotEvidence('SLOT_1_HM_SIGNED_REPORT');
      const slot2 = getSlotEvidence('SLOT_2_EQUIPMENT_WORKING_PHOTO');
      if (!slot1 || !slot2) {
        Alert.alert(
          'Mandatory Evidence Required',
          'Resolving a case on site requires BOTH:\n1. Slot 1: Headmaster Signed & Stamped Report\n2. Slot 2: Equipment Working Photo\n\nPlease capture both photos before executing check-out.',
        );
        return;
      }
    }

    setIsBusy(true);
    try {
      await onCheckOut(
        activeVisit.id,
        selectedOutcome,
        workPerformed,
        onSiteDiagnosis,
        pendingReason,
        nextVisitDate || undefined,
      );
      Alert.alert('Check-Out Recorded', `Visit completed with outcome: ${selectedOutcome}.`);
    } catch (err: any) {
      Alert.alert('Check-Out Failed', err.message || 'Check-out failed');
    } finally {
      setIsBusy(false);
    }
  };

  const currentVisit = activeVisit || (visits.length > 0 ? visits[visits.length - 1] : null);

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Navigation Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
            <Icon name="arrow-left" size={16} color={colors.primary} />
            <Text style={styles.backText}>Case</Text>
          </TouchableOpacity>
          <Text style={styles.barTitle}>VISIT EXECUTION</Text>
          <View style={{ width: 44 }} />
        </View>

        {/* Case & School Context Card */}
        <Card variant="elevated" style={styles.contextCard}>
          <View style={styles.headerRow}>
            <Text style={styles.caseCode}>{serviceCase.zentraCaseCode}</Text>
            <Badge
              label={serviceCase.operationalStatus.replace(/_/g, ' ')}
              variant={
                serviceCase.operationalStatus === 'RESOLVED' || serviceCase.operationalStatus === 'CLOSED'
                  ? 'success'
                  : 'primary'
              }
              size="sm"
            />
          </View>
          <View style={styles.schoolRow}>
            <Icon name="building" size={16} color={colors.primary} />
            <Text style={styles.schoolName}>{school?.schoolName || 'School Information'}</Text>
          </View>
          {school?.latitude && school?.longitude && (
            <View style={styles.coordsRow}>
              <Icon name="location" size={13} color={colors.textMuted} />
              <Text style={styles.coords}>
                Target GPS: {school.latitude.toFixed(5)}, {school.longitude.toFixed(5)}
              </Text>
            </View>
          )}
        </Card>

        {/* Active Visit Workflow Card */}
        {currentVisit ? (
          <Card variant="primary" style={styles.visitCard}>
            <View style={styles.visitHeaderRow}>
              <View>
                <Text style={styles.visitTitle}>
                  VISIT #{currentVisit.visitSequenceNumber}
                  {currentVisit.visitSequenceNumber > 1 ? ' (Return Visit)' : ''}
                </Text>
                <Text style={styles.visitDateText}>Date: {currentVisit.visitDate}</Text>
              </View>
              <Badge
                label={currentVisit.status}
                variant={
                  currentVisit.status === 'COMPLETED'
                    ? 'success'
                    : currentVisit.status === 'IN_PROGRESS'
                    ? 'warning'
                    : 'primary'
                }
                size="md"
                dot
              />
            </View>

            {/* Equipment Under Service Selection */}
            {labEquipment && labEquipment.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>EQUIPMENT UNDER SERVICE</Text>
                <Text style={styles.helpText}>
                  Select the laboratory hardware asset undergoing diagnostic inspection or repair:
                </Text>
                <View style={styles.equipmentList}>
                  {labEquipment.map((eq) => {
                    const isSelected = selectedEquipId === eq.serverId || selectedEquipId === eq.id;
                    return (
                      <TouchableOpacity
                        key={eq.id}
                        style={[
                          styles.equipmentCard,
                          isSelected && styles.equipmentCardSelected,
                        ]}
                        onPress={() => {
                          const idToSet = eq.serverId || eq.id;
                          setSelectedEquipId(idToSet);
                          if (onSelectEquipment) {
                            onSelectEquipment(idToSet);
                          }
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={styles.equipmentHeader}>
                          <Text style={styles.equipmentName}>
                            {eq.equipmentTypeName || 'Hardware Asset'}
                          </Text>
                          <Badge
                            label={eq.functionalStatus || 'UNKNOWN'}
                            variant={eq.functionalStatus === 'FUNCTIONAL' ? 'success' : 'danger'}
                            size="sm"
                          />
                        </View>
                        <Text style={styles.equipmentMeta}>
                          {eq.oemName} {eq.modelNumber} • S/N: {eq.serialNumber}
                        </Text>
                        {isSelected && (
                          <View style={styles.selectedRow}>
                            <Icon name="check" size={13} color={colors.primary} />
                            <Text style={styles.equipmentSelectedLabel}>SELECTED FOR SERVICE</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* GPS Proximity Section (PLANNED / EN_ROUTE) */}
            {(currentVisit.status === 'PLANNED' || currentVisit.status === 'EN_ROUTE') && (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>GPS PROXIMITY CHECK-IN</Text>
                <Text style={styles.helpText}>
                  Acquire high-precision GPS fix (required &le; 50m accuracy). Standard geofence threshold is 500m.
                </Text>

                {gpsSample ? (
                  <View style={styles.gpsInfoCard}>
                    <View style={styles.gpsRow}>
                      <Icon name="location" size={14} color={colors.textSecondary} />
                      <Text style={styles.gpsText}>
                        {gpsSample.latitude.toFixed(6)}, {gpsSample.longitude.toFixed(6)}
                      </Text>
                    </View>
                    <View style={styles.gpsRow}>
                      <Badge
                        label={`Accuracy: ${gpsSample.accuracyMeters.toFixed(1)}m (${
                          gpsSample.accuracyMeters <= 50 ? 'VALID \u2264 50m' : 'INSUFFICIENT > 50m'
                        })`}
                        variant={gpsSample.accuracyMeters <= 50 ? 'success' : 'danger'}
                        size="sm"
                        dot
                      />
                    </View>
                    {gpsSample.distanceMeters !== undefined && gpsSample.distanceMeters !== null && (
                      <Text style={styles.distanceText}>
                        Distance to School: {Math.round(gpsSample.distanceMeters)}m
                      </Text>
                    )}
                    <View style={styles.geofenceRow}>
                      <Badge
                        label={gpsSample.insideGeofence ? 'INSIDE GEOFENCE' : 'OUTSIDE GEOFENCE'}
                        variant={gpsSample.insideGeofence ? 'success' : 'danger'}
                        size="sm"
                      />
                    </View>
                  </View>
                ) : (
                  <Button
                    title="ACQUIRE LIVE GPS FIX"
                    variant="outline"
                    loading={isBusy}
                    onPress={handleAcquireLocation}
                    style={styles.gpsButton}
                  />
                )}

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Equipment Condition Observed</Text>
                  <TextInput
                    style={styles.input}
                    value={equipmentCondition}
                    onChangeText={setEquipmentCondition}
                    placeholder="e.g. Broken hinge, power supply intact"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Visit Notes (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Enter optional notes"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>

                <Button
                  title="EXECUTE GPS CHECK-IN"
                  variant="primary"
                  size="lg"
                  loading={isBusy}
                  onPress={handleCheckIn}
                />
              </View>
            )}

            {/* Work In Progress Section (CHECKED_IN / IN_PROGRESS) */}
            {currentVisit.status === 'CHECKED_IN' && (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>ON-SITE DIAGNOSTICS</Text>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Preliminary On-Site Diagnosis</Text>
                  <TextInput
                    style={styles.textArea}
                    value={onSiteDiagnosis}
                    onChangeText={setOnSiteDiagnosis}
                    placeholder="Enter initial diagnosis"
                    placeholderTextColor={colors.textMuted}
                    multiline
                  />
                </View>

                <Button
                  title="START WORK (IN_PROGRESS)"
                  variant="primary"
                  size="lg"
                  loading={isBusy}
                  onPress={handleStartWork}
                />
              </View>
            )}

            {/* Work & Check-Out Section (IN_PROGRESS) */}
            {currentVisit.status === 'IN_PROGRESS' && (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>WORK PERFORMED & OUTCOME</Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Work Performed Summary</Text>
                  <TextInput
                    style={styles.textArea}
                    value={workPerformed}
                    onChangeText={setWorkPerformed}
                    placeholder="Describe maintenance or repair operations executed"
                    placeholderTextColor={colors.textMuted}
                    multiline
                  />
                </View>

                <Text style={styles.label}>Structured Visit Outcome</Text>
                <View style={styles.outcomeGrid}>
                  {(
                    [
                      'RESOLVED_ON_SITE',
                      'PENDING_PARTS',
                      'PENDING_OEM_ESCALATION',
                      'ABORTED_SCHOOL_CLOSED',
                      'RETURN_VISIT_REQUIRED',
                    ] as VisitOutcome[]
                  ).map((outcome) => {
                    const isSelected = selectedOutcome === outcome;
                    return (
                      <TouchableOpacity
                        key={outcome}
                        style={[
                          styles.outcomePill,
                          isSelected && styles.outcomePillActive,
                        ]}
                        onPress={() => setSelectedOutcome(outcome)}
                      >
                        <Text
                          style={[
                            styles.outcomeText,
                            isSelected && styles.outcomeTextActive,
                          ]}
                        >
                          {outcome.replace(/_/g, ' ')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {(selectedOutcome === 'PENDING_PARTS' ||
                  selectedOutcome === 'RETURN_VISIT_REQUIRED' ||
                  selectedOutcome === 'PENDING_OEM_ESCALATION') && (
                  <>
                    <View style={styles.inputGroup}>
                      <Text style={styles.label}>Pending Reason / Required Parts *</Text>
                      <TextInput
                        style={styles.textArea}
                        value={pendingReason}
                        onChangeText={setPendingReason}
                        placeholder="Specify spare part, OEM ticket, or delay reason"
                        placeholderTextColor={colors.textMuted}
                        multiline
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={styles.label}>Target Next Visit Date (YYYY-MM-DD)</Text>
                      <TextInput
                        style={styles.input}
                        value={nextVisitDate}
                        onChangeText={setNextVisitDate}
                        placeholder="e.g. 2026-10-15"
                        placeholderTextColor={colors.textMuted}
                      />
                    </View>
                  </>
                )}

                {/* Evidence Section */}
                <View style={styles.evidenceSection}>
                  <View style={styles.evidenceSectionHeaderRow}>
                    <View style={styles.evidenceHeaderLeft}>
                      <Icon name="camera" size={16} color={colors.primary} />
                      <Text style={styles.evidenceSectionTitle}>FIELD EVIDENCE CAPTURE</Text>
                    </View>
                    <Badge label="OFFLINE QUEUE & SHA-256" variant="primary" size="sm" />
                  </View>
                  <Text style={styles.evidenceSubtext}>
                    Photographs are cryptographically hashed and saved locally before background sync.
                  </Text>

                  {/* SLOT 1 */}
                  {(() => {
                    const ev = getSlotEvidence('SLOT_1_HM_SIGNED_REPORT');
                    const isCapturing = isCameraModalOpen && activeCameraSlot === 'SLOT_1_HM_SIGNED_REPORT';
                    return (
                      <Card variant="default" style={styles.slotCard}>
                        <View style={styles.slotHeader}>
                          <View style={styles.slotTitleRow}>
                            <Text style={styles.slotTitle}>SLOT 1: HM SIGNED REPORT</Text>
                            <Badge label="MANDATORY" variant="warning" size="sm" />
                          </View>
                          {ev ? (
                            <Badge
                              label={ev.uploadStatus === 'FINALIZED' ? 'UPLOADED' : 'QUEUED LOCALLY'}
                              variant="success"
                              size="sm"
                              dot
                            />
                          ) : (
                            <Badge label="NOT CAPTURED" variant="neutral" size="sm" />
                          )}
                        </View>
                        <Text style={styles.slotDesc}>
                          Physical completion report signed and stamped by School Headmaster.
                        </Text>

                        {ev && (
                          <View style={styles.evidenceMetaBox}>
                            <Text style={styles.evidenceMetaText}>
                              Checksum: {ev.fileChecksumSha256.substring(0, 16)}...
                            </Text>
                            <Text style={styles.evidenceMetaText}>
                              Size: {Math.round(ev.fileSizeBytes / 1024)} KB • Status: {ev.uploadStatus}
                            </Text>
                          </View>
                        )}

                        <Button
                          title={ev ? 'RETAKE SIGNED REPORT' : 'CAPTURE SIGNED REPORT'}
                          variant={ev ? 'secondary' : 'primary'}
                          size="md"
                          loading={isCapturing || isBusy}
                          onPress={() => handleCaptureSlotPhoto('SLOT_1_HM_SIGNED_REPORT')}
                          style={styles.slotButton}
                        />
                      </Card>
                    );
                  })()}

                  {/* SLOT 2 */}
                  {(() => {
                    const ev =
                      getSlotEvidence('SLOT_2_EQUIPMENT_WORKING_PHOTO') ||
                      getSlotEvidence('SLOT_2_EQUIPMENT_PHOTO');
                    const isCapturing =
                      isCameraModalOpen &&
                      (activeCameraSlot === 'SLOT_2_EQUIPMENT_WORKING_PHOTO' ||
                        activeCameraSlot === 'SLOT_2_EQUIPMENT_PHOTO');
                    return (
                      <Card variant="default" style={styles.slotCard}>
                        <View style={styles.slotHeader}>
                          <View style={styles.slotTitleRow}>
                            <Text style={styles.slotTitle}>SLOT 2: EQUIPMENT WORKING PHOTO</Text>
                            <Badge label="MANDATORY" variant="warning" size="sm" />
                          </View>
                          {ev ? (
                            <Badge
                              label={ev.uploadStatus === 'FINALIZED' ? 'UPLOADED' : 'QUEUED LOCALLY'}
                              variant="success"
                              size="sm"
                              dot
                            />
                          ) : (
                            <Badge label="NOT CAPTURED" variant="neutral" size="sm" />
                          )}
                        </View>
                        <Text style={styles.slotDesc}>
                          Rear-camera photo showing serviced equipment operational on site.
                        </Text>

                        {ev && (
                          <View style={styles.evidenceMetaBox}>
                            <Text style={styles.evidenceMetaText}>
                              Checksum: {ev.fileChecksumSha256.substring(0, 16)}...
                            </Text>
                            <Text style={styles.evidenceMetaText}>
                              Size: {Math.round(ev.fileSizeBytes / 1024)} KB • Status: {ev.uploadStatus}
                            </Text>
                          </View>
                        )}

                        <Button
                          title={ev ? 'RETAKE EQUIPMENT PHOTO' : 'CAPTURE EQUIPMENT PHOTO'}
                          variant={ev ? 'secondary' : 'primary'}
                          size="md"
                          loading={isCapturing || isBusy}
                          onPress={() => handleCaptureSlotPhoto('SLOT_2_EQUIPMENT_WORKING_PHOTO')}
                          style={styles.slotButton}
                        />
                      </Card>
                    );
                  })()}
                </View>

                <Button
                  title="EXECUTE CHECK-OUT"
                  variant="danger"
                  size="lg"
                  loading={isBusy}
                  onPress={handleCheckOut}
                  style={styles.checkOutButton}
                />
              </View>
            )}

            {/* Completed State */}
            {currentVisit.status === 'COMPLETED' && (
              <View style={styles.section}>
                <View style={styles.completedBanner}>
                  <Icon name="check" size={18} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.successTitle}>
                      Visit #{currentVisit.visitSequenceNumber} Completed
                    </Text>
                    <Text style={styles.successText}>
                      Outcome: {currentVisit.visitOutcome}. Record is locally immutable.
                    </Text>
                  </View>
                </View>

                {/* Conveyance Claim Card */}
                <Card variant="default" style={styles.conveyanceBox}>
                  <Text style={styles.conveyanceHeader}>TRAVEL & CONVEYANCE REIMBURSEMENT</Text>
                  {existingConveyanceClaim ? (
                    <View style={styles.existingClaimContainer}>
                      <View style={styles.claimStatusRow}>
                        <Text style={styles.claimLabel}>Status:</Text>
                        <Badge
                          label={existingConveyanceClaim.claimStatus}
                          variant="success"
                          size="sm"
                        />
                      </View>
                      <Text style={styles.claimDetailText}>
                        Mode: {existingConveyanceClaim.travelMode} | Distance: {existingConveyanceClaim.claimedDistanceKm} km
                      </Text>
                      <Text style={styles.claimAmountText}>
                        Amount: ₹{existingConveyanceClaim.calculatedAmount} (₹{existingConveyanceClaim.appliedRatePerKm}/km)
                      </Text>
                      <Text style={styles.provisionalDisclaimer}>
                        PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY
                      </Text>
                    </View>
                  ) : (
                    <View>
                      <Text style={styles.label}>Travel Mode</Text>
                      <View style={styles.outcomeGrid}>
                        {(['BIKE', 'BUS', 'TRAIN', 'AUTO', 'OTHER'] as TravelMode[]).map((mode) => {
                          const isSelected = claimTravelMode === mode;
                          return (
                            <TouchableOpacity
                              key={mode}
                              style={[
                                styles.outcomePill,
                                isSelected && styles.outcomePillActive,
                              ]}
                              onPress={() => setClaimTravelMode(mode)}
                            >
                              <Text
                                style={[
                                  styles.outcomeText,
                                  isSelected && styles.outcomeTextActive,
                                ]}
                              >
                                {mode}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <View style={styles.odometerRow}>
                        <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                          <Text style={styles.label}>Starting Odometer (km)</Text>
                          <TextInput
                            style={styles.input}
                            keyboardType="numeric"
                            placeholder="e.g. 10240"
                            placeholderTextColor={colors.textMuted}
                            value={startingOdometer}
                            onChangeText={setStartingOdometer}
                          />
                        </View>
                        <View style={[styles.inputGroup, { flex: 1 }]}>
                          <Text style={styles.label}>Ending Odometer (km)</Text>
                          <TextInput
                            style={styles.input}
                            keyboardType="numeric"
                            placeholder="e.g. 10265"
                            placeholderTextColor={colors.textMuted}
                            value={endingOdometer}
                            onChangeText={setEndingOdometer}
                          />
                        </View>
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>Claimed Distance (km) *</Text>
                        <TextInput
                          style={styles.input}
                          keyboardType="numeric"
                          placeholder="e.g. 25"
                          placeholderTextColor={colors.textMuted}
                          value={claimDistance}
                          onChangeText={setClaimDistance}
                        />
                      </View>

                      {/* Transparent Calculation Preview */}
                      {parseFloat(claimDistance) > 0 && (
                        <View style={styles.calculationPreview}>
                          <Text style={styles.calcPreviewTitle}>
                            Estimated Reimbursement: ₹
                            {Math.round(
                              parseFloat(claimDistance) *
                                (claimTravelMode === 'BIKE'
                                  ? 5
                                  : claimTravelMode === 'BUS'
                                  ? 2.5
                                  : claimTravelMode === 'TRAIN'
                                  ? 2
                                  : claimTravelMode === 'AUTO'
                                  ? 8
                                  : 5) *
                                100,
                            ) / 100}
                          </Text>
                          <Text style={styles.calcRateText}>
                            Applied Rate: ₹
                            {claimTravelMode === 'BIKE'
                              ? 5
                              : claimTravelMode === 'BUS'
                              ? 2.5
                              : claimTravelMode === 'TRAIN'
                              ? 2
                              : claimTravelMode === 'AUTO'
                              ? 8
                              : 5}
                            /km for {claimTravelMode}
                          </Text>
                          <Text style={styles.provisionalDisclaimer}>
                            PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY
                          </Text>
                        </View>
                      )}

                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>Remarks (Optional)</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="Travel route details, toll, etc."
                          placeholderTextColor={colors.textMuted}
                          value={claimRemarks}
                          onChangeText={setClaimRemarks}
                        />
                      </View>

                      {onLogConveyanceClaim && (
                        <Button
                          title="RECORD CONVEYANCE CLAIM"
                          variant="primary"
                          size="lg"
                          loading={isBusy}
                          onPress={async () => {
                            const dist = parseFloat(claimDistance);
                            if (!dist || dist <= 0) {
                              Alert.alert('Validation Error', 'Claimed distance must be greater than 0 km');
                              return;
                            }
                            const startKm = startingOdometer ? parseFloat(startingOdometer) : null;
                            const endKm = endingOdometer ? parseFloat(endingOdometer) : null;
                            if (startKm !== null && endKm !== null && endKm < startKm) {
                              Alert.alert('Odometer Error', 'Ending odometer cannot be less than starting odometer');
                              return;
                            }

                            setIsBusy(true);
                            try {
                              await onLogConveyanceClaim({
                                travelMode: claimTravelMode,
                                startingOdometerKm: startKm,
                                endingOdometerKm: endKm,
                                claimedDistanceKm: dist,
                                remarks: claimRemarks || null,
                              });
                              Alert.alert('Success', 'Conveyance claim logged successfully');
                            } catch (err: any) {
                              Alert.alert('Claim Error', err.message || 'Failed to log conveyance claim');
                            } finally {
                              setIsBusy(false);
                            }
                          }}
                        />
                      )}
                    </View>
                  )}
                </Card>
              </View>
            )}
          </Card>
        ) : (
          <Card variant="elevated" style={styles.emptyCard}>
            <Icon name="clock" size={24} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>NO VISITS RECORDED</Text>
            <Text style={styles.emptySubtitle}>
              This assigned service case does not have an active field visit yet.
            </Text>
            <Button
              title="CREATE INITIAL VISIT (VISIT #1)"
              variant="primary"
              size="lg"
              loading={isCreatingVisit || isBusy}
              onPress={handleCreateVisitPress}
              style={{ width: '100%' }}
            />
          </Card>
        )}

        {/* Multi-Visit History Card */}
        {visits.length > 0 && (
          <Card variant="default" style={styles.historyCard}>
            <View style={styles.headerRow}>
              <View style={styles.historyTitleWrap}>
                <Icon name="clock" size={16} color={colors.primary} />
                <Text style={styles.sectionHeader}>VISIT HISTORY ({visits.length})</Text>
              </View>
              {currentVisit && currentVisit.status === 'COMPLETED' && (
                <Button
                  title={isCreatingVisit ? 'CREATING...' : '+ NEW RETURN VISIT'}
                  variant="outline"
                  size="sm"
                  loading={isCreatingVisit || isBusy}
                  onPress={handleCreateVisitPress}
                />
              )}
            </View>

            {visits.map((v) => (
              <View key={v.id} style={styles.historyItem}>
                <View style={styles.historyRow}>
                  <Text style={styles.historySeq}>Visit #{v.visitSequenceNumber}</Text>
                  <Text style={styles.historyDate}>{v.visitDate}</Text>
                  <Badge
                    label={v.status}
                    variant={v.status === 'COMPLETED' ? 'success' : 'primary'}
                    size="sm"
                  />
                </View>
                {v.visitOutcome && (
                  <Text style={styles.historyOutcome}>Outcome: {v.visitOutcome}</Text>
                )}
                {v.workPerformed && (
                  <Text style={styles.historyWork} numberOfLines={2}>
                    {v.workPerformed}
                  </Text>
                )}
              </View>
            ))}
          </Card>
        )}
      </ScrollView>

      {/* Real Mounted Native Camera Viewfinder Modal */}
      {cameraService && (
        <CameraViewfinderModal
          visible={isCameraModalOpen}
          slot={activeCameraSlot}
          cameraService={cameraService}
          onPhotoCaptured={handlePhotoCapturedFromViewfinder}
          onClose={() => {
            setIsCameraModalOpen(false);
            setActiveCameraSlot(null);
          }}
        />
      )}
    </>
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
  contextCard: {
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  caseCode: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  schoolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  schoolName: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    fontSize: 14,
  },
  coordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
  },
  coords: {
    ...typography.caption,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  visitCard: {
    marginBottom: spacing.md,
    backgroundColor: '#FFFFFF',
    borderColor: colors.primaryLight,
  },
  visitHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  visitTitle: {
    ...typography.h3,
    color: colors.primary,
  },
  visitDateText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  section: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  sectionHeader: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
  },
  helpText: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  equipmentList: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  equipmentCard: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  equipmentCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
  },
  equipmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  equipmentName: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  equipmentMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  equipmentSelectedLabel: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.primary,
  },
  gpsInfoCard: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  gpsText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  distanceText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  geofenceRow: {
    marginTop: 2,
  },
  gpsButton: {
    marginBottom: spacing.md,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    color: colors.textPrimary,
    fontSize: 13,
  },
  textArea: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    color: colors.textPrimary,
    fontSize: 13,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  outcomeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  outcomePill: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  outcomePillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  outcomeText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  outcomeTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  evidenceSection: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  evidenceSectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  evidenceHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  evidenceSectionTitle: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  evidenceSubtext: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 16,
  },
  slotCard: {
    marginBottom: spacing.sm,
    backgroundColor: '#FFFFFF',
  },
  slotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  slotTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  slotTitle: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  slotDesc: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 16,
    marginBottom: 6,
  },
  evidenceMetaBox: {
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.xs,
    borderRadius: radii.sm,
    marginVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  evidenceMetaText: {
    ...typography.caption,
    color: colors.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
  },
  slotButton: {
    marginTop: spacing.xs,
  },
  checkOutButton: {
    marginTop: spacing.xs,
  },
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#F0FDF4',
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    marginBottom: spacing.md,
  },
  successTitle: {
    ...typography.bodyBold,
    color: colors.success,
  },
  successText: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  conveyanceBox: {
    marginTop: spacing.xs,
  },
  conveyanceHeader: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  existingClaimContainer: {
    padding: spacing.md,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  claimStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  claimLabel: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
    marginRight: spacing.xs,
  },
  claimDetailText: {
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: 4,
    fontSize: 13,
  },
  claimAmountText: {
    ...typography.h3,
    color: colors.success,
    marginBottom: spacing.xs,
  },
  odometerRow: {
    flexDirection: 'row',
  },
  calculationPreview: {
    backgroundColor: '#EFF6FF',
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  calcPreviewTitle: {
    ...typography.bodyBold,
    color: colors.primary,
    marginBottom: 2,
  },
  calcRateText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  provisionalDisclaimer: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '700',
    fontSize: 10,
  },
  emptyCard: {
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  emptySubtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  historyCard: {
    marginBottom: spacing.md,
  },
  historyTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  historyItem: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  historySeq: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  historyDate: {
    ...typography.caption,
    color: colors.textMuted,
  },
  historyOutcome: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '600',
    marginTop: 2,
  },
  historyWork: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
});

/**
 * ZENTRA Field — Case Detail Screen
 * apps/field/src/screens/CaseDetailScreen.tsx
 *
 * Detailed offline view and atomic local mutation interface for a service case.
 * Enforces transactional local persistence and queues mutations for future sync.
 * Enterprise Light UI redesign with standardized design tokens and components.
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
import { colors, spacing, typography, radii } from '../theme';
import { Card, Badge, Button, Icon } from '../components/ui';

interface CaseDetailScreenProps {
  serviceCase: ServiceCaseModel;
  onUpdateStatusLocally: (targetStatus: string, reason?: string, notes?: string) => Promise<void>;
  onViewSchool: (schoolId: string) => void;
  onNavigateToVisit: (caseId: string) => void;
  activeVisit?: FieldVisitModel | null;
  visitCount?: number;
  onBack: () => void;
}

export function CaseDetailScreen({
  serviceCase,
  onUpdateStatusLocally,
  onViewSchool,
  onNavigateToVisit,
  activeVisit,
  visitCount = 0,
  onBack,
}: CaseDetailScreenProps) {
  const [notes, setNotes] = useState(serviceCase.resolutionNotes || '');
  const [isUpdating, setIsUpdating] = useState(false);
  const [showOverride, setShowOverride] = useState(false);

  const handleTransition = async (targetStatus: string) => {
    setIsUpdating(true);
    try {
      await onUpdateStatusLocally(targetStatus, 'Field engineer status change', notes);
      Alert.alert(
        'Offline Mutation Persisted',
        `Service case updated locally to '${targetStatus}'. A persistent mutation has been queued in local SQLite/WatermelonDB.`,
      );
    } catch (err: any) {
      Alert.alert('Mutation Failed', err.message || 'Failed to persist local mutation');
    } finally {
      setIsUpdating(false);
    }
  };

  const isPending = serviceCase.syncState === 'PENDING_SYNC';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Navigation Header */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
          <Icon name="arrow-left" size={16} color={colors.primary} />
          <Text style={styles.backText}>Cases</Text>
        </TouchableOpacity>
        <Text style={styles.barTitle} numberOfLines={1}>
          {serviceCase.zentraCaseCode}
        </Text>
        <Badge
          label={isPending ? 'OFFLINE QUEUED' : 'SYNCED'}
          variant={isPending ? 'warning' : 'success'}
          size="sm"
          dot
        />
      </View>

      {/* Case Overview Card */}
      <Card variant="elevated" style={styles.mainCard}>
        <View style={styles.statusRow}>
          <Badge
            label={serviceCase.operationalStatus.replace(/_/g, ' ')}
            variant={
              serviceCase.operationalStatus === 'RESOLVED' || serviceCase.operationalStatus === 'CLOSED'
                ? 'success'
                : serviceCase.operationalStatus === 'IN_PROGRESS' || serviceCase.operationalStatus === 'IN_TRANSIT'
                ? 'primary'
                : 'warning'
            }
            size="md"
            dot
          />
          <Badge
            label={serviceCase.priority}
            variant={
              serviceCase.priority === 'CRITICAL' || serviceCase.priority === 'HIGH'
                ? 'danger'
                : 'neutral'
            }
            size="sm"
          />
        </View>

        <Text style={styles.sectionLabel}>FAULT DESCRIPTION</Text>
        <Text style={styles.faultDescription}>{serviceCase.faultDescription}</Text>

        {/* School Link Button */}
        <TouchableOpacity
          style={styles.schoolLink}
          onPress={() => onViewSchool(serviceCase.schoolId)}
          activeOpacity={0.8}
        >
          <View style={styles.schoolLinkLeft}>
            <View style={styles.schoolIconWrap}>
              <Icon name="building" size={16} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.schoolLinkTitle}>School Master Dossier</Text>
              <Text style={styles.schoolLinkSubtitle}>ID: {serviceCase.schoolId}</Text>
            </View>
          </View>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </Card>

      {/* Field Visit Execution Card */}
      <Card variant="primary" style={styles.visitCard}>
        <View style={styles.visitHeaderRow}>
          <View style={styles.visitHeaderLeft}>
            <Icon name="location" size={18} color={colors.primary} />
            <Text style={styles.visitHeaderTitle}>FIELD VISIT WORKFLOW</Text>
          </View>
          {activeVisit && (
            <Badge
              label={activeVisit.status}
              variant={activeVisit.status === 'COMPLETED' ? 'success' : 'primary'}
              size="sm"
            />
          )}
        </View>

        {activeVisit ? (
          <View style={styles.visitBody}>
            <View style={styles.visitDetailBox}>
              <View style={styles.visitRow}>
                <Text style={styles.visitLabel}>Visit Number</Text>
                <Text style={styles.visitValue}>#{activeVisit.visitSequenceNumber}</Text>
              </View>
              <View style={styles.visitRow}>
                <Text style={styles.visitLabel}>Date</Text>
                <Text style={styles.visitValue}>{activeVisit.visitDate}</Text>
              </View>
              <View style={styles.visitRow}>
                <Text style={styles.visitLabel}>Outcome</Text>
                <Text style={styles.visitValue}>{activeVisit.visitOutcome || 'IN PROGRESS'}</Text>
              </View>
              {activeVisit.checkInLatitude !== null && activeVisit.checkInLatitude !== undefined && (
                <View style={styles.visitRow}>
                  <Text style={styles.visitLabel}>GPS Check-in</Text>
                  <Text style={styles.visitValueCoord}>
                    {activeVisit.checkInLatitude.toFixed(5)}, {activeVisit.checkInLongitude?.toFixed(5)} ({Math.round(activeVisit.checkInAccuracyMeters || 0)}m)
                  </Text>
                </View>
              )}
            </View>

            <Button
              title={`CONTINUE VISIT #${activeVisit.visitSequenceNumber} (WORK & EVIDENCE)`}
              variant="primary"
              size="lg"
              onPress={() => onNavigateToVisit(serviceCase.id)}
              style={styles.visitButton}
            />
          </View>
        ) : visitCount > 0 ? (
          <View style={styles.visitBody}>
            <Text style={styles.visitNotice}>
              All previous visits ({visitCount}) for this case have concluded. Start a new return visit if further on-site lab attendance is required.
            </Text>
            <Button
              title="VIEW VISITS / START RETURN VISIT"
              variant="primary"
              size="lg"
              onPress={() => onNavigateToVisit(serviceCase.id)}
              style={styles.visitButton}
            />
          </View>
        ) : (
          <View style={styles.visitBody}>
            <Text style={styles.visitNotice}>
              Execute an on-site physical visit with GPS proximity validation (&le; 50m), lab equipment inspection, and required photographic evidence capture.
            </Text>
            <Button
              title="START FIELD VISIT (CHECK-IN)"
              variant="primary"
              size="lg"
              onPress={() => onNavigateToVisit(serviceCase.id)}
              style={styles.visitButton}
            />
          </View>
        )}
      </Card>

      {/* Manual Status Override (Accordion / Secondary) */}
      <Card variant="default" style={styles.overrideCard}>
        <TouchableOpacity
          style={styles.overrideHeader}
          onPress={() => setShowOverride(!showOverride)}
          activeOpacity={0.7}
        >
          <View style={styles.overrideTitleRow}>
            <Icon name="clock" size={16} color={colors.textMuted} />
            <Text style={styles.overrideTitle}>Manual Status Override</Text>
          </View>
          <Icon name={showOverride ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </TouchableOpacity>

        {showOverride && (
          <View style={styles.overrideContent}>
            <Text style={styles.helpText}>
              Direct status mutations are legacy manual overrides. Standard field service lifecycle progression is driven by Field Visit check-in, execution, and check-out.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Engineer Notes / Observations</Text>
              <TextInput
                style={styles.textArea}
                value={notes}
                onChangeText={setNotes}
                placeholder="Enter diagnosis or parts required notes"
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.buttonStack}>
              {serviceCase.operationalStatus === 'ASSIGNED' && (
                <Button
                  title="COMMENCE TRAVEL (IN_TRANSIT)"
                  variant="secondary"
                  loading={isUpdating}
                  onPress={() => handleTransition('IN_TRANSIT')}
                />
              )}

              {serviceCase.operationalStatus === 'IN_TRANSIT' && (
                <Button
                  title="COMMENCE WORK (IN_PROGRESS)"
                  variant="primary"
                  loading={isUpdating}
                  onPress={() => handleTransition('IN_PROGRESS')}
                />
              )}

              {serviceCase.operationalStatus === 'IN_PROGRESS' && (
                <>
                  <Button
                    title="REQUEST SPARE PARTS (PENDING_PARTS)"
                    variant="warning"
                    loading={isUpdating}
                    onPress={() => handleTransition('PENDING_PARTS')}
                  />
                  <Button
                    title="MARK REPAIRED (RESOLVED)"
                    variant="success"
                    loading={isUpdating}
                    onPress={() => handleTransition('RESOLVED')}
                  />
                </>
              )}

              {serviceCase.operationalStatus === 'PENDING_PARTS' && (
                <Button
                  title="RESUME WORK (IN_PROGRESS)"
                  variant="primary"
                  loading={isUpdating}
                  onPress={() => handleTransition('IN_PROGRESS')}
                />
              )}
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
    paddingRight: spacing.sm,
  },
  backText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  barTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  mainCard: {
    marginBottom: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionLabel: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  faultDescription: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  schoolLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  schoolLinkLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  schoolIconWrap: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  schoolLinkTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    fontSize: 13,
  },
  schoolLinkSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
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
    marginBottom: spacing.sm,
  },
  visitHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  visitHeaderTitle: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  visitBody: {
    marginTop: spacing.xs,
  },
  visitNotice: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  visitDetailBox: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  visitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  visitLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  visitValue: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  visitValueCoord: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  visitButton: {
    marginTop: spacing.xs,
  },
  overrideCard: {
    marginBottom: spacing.md,
  },
  overrideHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  overrideTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  overrideTitle: {
    ...typography.bodyBold,
    color: colors.textSecondary,
    fontSize: 13,
  },
  overrideContent: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  helpText: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
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
  buttonStack: {
    gap: spacing.sm,
  },
});

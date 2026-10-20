/**
 * ZENTRA Field — School Detail Screen
 * apps/field/src/screens/SchoolDetailScreen.tsx
 *
 * Offline school master dossier view for field engineers.
 * Redesigned with enterprise light theme tokens and reusable UI primitives.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import type { SchoolModel } from '../database/models/SchoolModel';
import type { HiTechLabModel } from '../database/models/HiTechLabModel';
import type { EquipmentModel } from '../database/models/EquipmentModel';
import { colors, spacing, typography, radii } from '../theme';
import { Card, Badge, Icon } from '../components/ui';

interface SchoolDetailScreenProps {
  school: SchoolModel | null;
  labs?: HiTechLabModel[];
  equipmentByLab?: Record<string, EquipmentModel[]>;
  onBack: () => void;
}

export function SchoolDetailScreen({
  school,
  labs,
  equipmentByLab,
  onBack,
}: SchoolDetailScreenProps) {
  if (!school) {
    return (
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
            <Icon name="arrow-left" size={16} color={colors.primary} />
            <Text style={styles.backText}>Cases</Text>
          </TouchableOpacity>
          <Text style={styles.barTitle}>School Dossier</Text>
          <View style={{ width: 44 }} />
        </View>
        <Card variant="default" style={styles.emptyCard}>
          <Text style={styles.emptyText}>School record not found in local cache.</Text>
        </Card>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Navigation Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
          <Icon name="arrow-left" size={16} color={colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.barTitle}>School Master Dossier</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Main School Card */}
      <Card variant="elevated" style={styles.mainCard}>
        <View style={styles.schoolHeader}>
          <Badge label={`UDISE: ${school.udiseCode}`} variant="primary" size="sm" />
          <Badge label={school.category} variant="neutral" size="sm" />
        </View>

        <Text style={styles.schoolName}>{school.schoolName}</Text>

        <View style={styles.divider} />

        <Text style={styles.sectionHeader}>CONTACT DETAILS</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Headmaster</Text>
          <Text style={styles.infoValue}>{school.headmasterName || 'Not specified'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Phone</Text>
          <Text style={styles.infoValue}>{school.headmasterPhone || 'Not specified'}</Text>
        </View>

        <View style={styles.divider} />

        <Text style={styles.sectionHeader}>LOCATION METADATA</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Latitude</Text>
          <Text style={styles.infoCoord}>
            {school.latitude !== null && school.latitude !== undefined ? school.latitude.toFixed(6) : 'N/A'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Longitude</Text>
          <Text style={styles.infoCoord}>
            {school.longitude !== null && school.longitude !== undefined ? school.longitude.toFixed(6) : 'N/A'}
          </Text>
        </View>
      </Card>

      {/* Hi-Tech Laboratories & Equipment */}
      <Card variant="default" style={styles.labsCard}>
        <Text style={styles.sectionHeader}>HI-TECH LABORATORIES & EQUIPMENT</Text>
        {labs && labs.length > 0 ? (
          labs.map((lab) => {
            const labEquipment = equipmentByLab?.[lab.serverId] || equipmentByLab?.[lab.id] || [];
            return (
              <View key={lab.id} style={styles.labItem}>
                <View style={styles.labHeader}>
                  <Text style={styles.labTypeTitle}>{lab.labType || 'Hi-Tech Lab'}</Text>
                  <Badge
                    label={lab.isFunctional ? 'FUNCTIONAL' : 'NON-FUNCTIONAL'}
                    variant={lab.isFunctional ? 'success' : 'danger'}
                    size="sm"
                  />
                </View>
                <Text style={styles.labMeta}>
                  Room: {lab.roomNumber || 'Main Lab'} • Total Systems: {lab.totalSystems || 0}
                </Text>

                {labEquipment.length > 0 ? (
                  <View style={styles.labEquipmentList}>
                    <Text style={styles.labEquipmentHeader}>
                      EQUIPMENT DOSSIER ({labEquipment.length} ASSETS)
                    </Text>
                    {labEquipment.map((eq) => (
                      <View key={eq.id} style={styles.equipmentItem}>
                        <View style={styles.equipmentRow}>
                          <Text style={styles.equipmentItemName}>
                            {eq.equipmentTypeName || 'Hardware Asset'}
                          </Text>
                          <Badge
                            label={eq.functionalStatus || 'UNKNOWN'}
                            variant={eq.functionalStatus === 'FUNCTIONAL' ? 'success' : 'danger'}
                            size="sm"
                          />
                        </View>
                        <Text style={styles.equipmentItemSub}>
                          {eq.oemName} {eq.modelNumber} • S/N: {eq.serialNumber}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.noEquipmentText}>No equipment registered for this lab.</Text>
                )}
              </View>
            );
          })
        ) : (
          <Text style={styles.noLabsText}>No Hi-Tech Lab records found in local offline cache.</Text>
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
  mainCard: {
    marginBottom: spacing.md,
  },
  schoolHeader: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  schoolName: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginVertical: spacing.md,
  },
  sectionHeader: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  infoLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  infoValue: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  infoCoord: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  labsCard: {
    marginBottom: spacing.md,
  },
  labItem: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  labHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  labTypeTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  labMeta: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  labEquipmentList: {
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.xs,
  },
  labEquipmentHeader: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.textMuted,
    marginBottom: 4,
    letterSpacing: 0.5,
    fontSize: 10,
  },
  equipmentItem: {
    paddingVertical: 4,
  },
  equipmentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  equipmentItemName: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  equipmentItemSub: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  noEquipmentText: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 4,
  },
  noLabsText: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 4,
  },
  emptyCard: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
});

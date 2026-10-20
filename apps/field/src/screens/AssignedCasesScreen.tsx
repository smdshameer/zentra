/**
 * ZENTRA Field — Assigned Cases List Screen (Redesigned)
 * apps/field/src/screens/AssignedCasesScreen.tsx
 *
 * Enterprise scannable ticket list for Field Engineers:
 * - High-contrast case cards with priority and local sync badges
 * - Instant local search filter across case codes and fault summaries
 * - Clear distinction between locally pending changes and server-confirmed state
 * - Accessible touch targets with polished elevation
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
} from 'react-native';
import type { ServiceCaseModel } from '../database/models/ServiceCaseModel';
import { colors, spacing, typography, radii } from '../theme/tokens';
import { Card, Badge, Icon } from '../components/ui';

interface AssignedCasesScreenProps {
  cases: ServiceCaseModel[];
  onSelectCase: (caseId: string) => void;
  onBack: () => void;
}

export function AssignedCasesScreen({
  cases,
  onSelectCase,
  onBack,
}: AssignedCasesScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter cases in-memory
  const filteredCases = useMemo(() => {
    if (!searchQuery.trim()) return cases;
    const query = searchQuery.toLowerCase().trim();
    return cases.filter(
      (c) =>
        c.zentraCaseCode.toLowerCase().includes(query) ||
        (c.faultDescription && c.faultDescription.toLowerCase().includes(query)) ||
        c.operationalStatus.toLowerCase().includes(query),
    );
  }, [cases, searchQuery]);

  const renderItem = ({ item }: { item: ServiceCaseModel }) => {
    const isPending = item.syncState === 'PENDING_SYNC';

    return (
      <TouchableOpacity
        onPress={() => onSelectCase(item.id)}
        activeOpacity={0.8}
        style={styles.cardTouchWrapper}
      >
        <Card style={styles.caseCard}>
          {/* Header Row: Case Code + Badges */}
          <View style={styles.cardHeader}>
            <View style={styles.codeColumn}>
              <Text style={styles.caseCode}>{item.zentraCaseCode}</Text>
            </View>
            <View style={styles.badgesWrapper}>
              {isPending ? (
                <Badge label="LOCAL / PENDING" variant="warning" size="sm" showDot />
              ) : (
                <Badge label="SERVER CONFIRMED" variant="success" size="sm" />
              )}
              <Badge label={item.priority} variant={getPriorityVariant(item.priority)} size="sm" />
            </View>
          </View>

          {/* Fault Summary */}
          <Text style={styles.faultSummary} numberOfLines={2}>
            {item.faultDescription || 'No initial fault description logged.'}
          </Text>

          {/* Footer Row: Status Pill + View Prompt */}
          <View style={styles.cardFooter}>
            <Badge label={item.operationalStatus.replace(/_/g, ' ')} variant="info" size="sm" />
            <View style={styles.viewAction}>
              <Text style={styles.viewActionText}>View Details</Text>
              <Icon name="chevron-right" size={14} color={colors.accentBlue} />
            </View>
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header Navigation */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}
        >
          <Icon name="arrow-left" size={16} color={colors.textPrimary} />
          <Text style={styles.backText}>Dashboard</Text>
        </TouchableOpacity>
        <View style={styles.titleWrapper}>
          <Text style={styles.barTitle}>Assigned Calls</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{cases.length}</Text>
          </View>
        </View>
      </View>

      {/* Search & Filter Bar */}
      {cases.length > 0 && (
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search case code or symptoms..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              clearButtonMode="while-editing"
            />
          </View>
        </View>
      )}

      {/* Case List or Empty State */}
      {cases.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconCircle}>
            <Icon name="briefcase" size={28} color={colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No Assigned Cases Cached</Text>
          <Text style={styles.emptyBody}>
            There are no service cases in local offline storage. Tap "Preload Assigned Dossier" on the Dashboard when connected to download your workload.
          </Text>
        </View>
      ) : filteredCases.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No Matching Cases</Text>
          <Text style={styles.emptyBody}>
            No service cases matched your search query "{searchQuery}".
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredCases}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

function getPriorityVariant(priority: string) {
  switch (priority?.toUpperCase()) {
    case 'CRITICAL':
      return 'danger' as const;
    case 'HIGH':
      return 'warning' as const;
    case 'MEDIUM':
      return 'info' as const;
    default:
      return 'neutral' as const;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingRight: spacing.sm,
  },
  backText: {
    ...typography.captionMedium,
    color: colors.textPrimary,
    marginLeft: 6,
    fontSize: 13,
  },
  titleWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  barTitle: {
    ...typography.h2,
    fontSize: 15,
    color: colors.textPrimary,
  },
  countBadge: {
    backgroundColor: colors.accentBlueLight,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.full,
  },
  countBadgeText: {
    color: colors.accentBlue,
    fontSize: 11,
    fontWeight: '700',
  },
  searchContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    height: 40,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: spacing.sm,
    opacity: 0.6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    height: '100%',
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  cardTouchWrapper: {
    marginBottom: spacing.xs,
  },
  caseCard: {
    marginBottom: spacing.sm,
    padding: spacing.md + 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  codeColumn: {
    flex: 1,
  },
  caseCode: {
    ...typography.code,
    fontSize: 14,
    fontWeight: '800',
    color: colors.primaryNavy,
  },
  badgesWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: spacing.xs,
  },
  faultSummary: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  viewAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewActionText: {
    ...typography.captionMedium,
    color: colors.accentBlue,
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxxl,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  emptyBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 19,
  },
});

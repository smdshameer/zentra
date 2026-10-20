/**
 * ZENTRA Field — Profile Screen
 * apps/field/src/screens/ProfileScreen.tsx
 *
 * User profile, session controls, and local operation queue inspector.
 * Redesigned with enterprise light theme tokens and reusable UI primitives.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import type { MobileSessionUser } from '../auth/session-manager';
import type { OperationQueueStats } from '../domain/queue/operation-types';
import { colors, spacing, typography } from '../theme';
import { Card, Badge, Button, Icon } from '../components/ui';

interface ProfileScreenProps {
  user: MobileSessionUser;
  queueStats: OperationQueueStats;
  onLogout: () => Promise<void>;
  onRetryFailedOps: () => Promise<void>;
  onNavigateToDiagnostics?: () => void;
}

export function ProfileScreen({
  user,
  queueStats,
  onLogout,
  onRetryFailedOps,
  onNavigateToDiagnostics,
}: ProfileScreenProps) {
  const handleLogout = () => {
    if (queueStats.totalPending > 0) {
      Alert.alert(
        'Pending Local Work',
        `You have ${queueStats.totalPending} pending local operation(s) in the queue. They remain safely stored on this device, but will not sync until you log back in. Proceed with logout?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Log Out', style: 'destructive', onPress: onLogout },
        ],
      );
    } else {
      onLogout();
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile Card */}
      <Card variant="elevated" style={styles.profileCard}>
        <View style={styles.avatarBadge}>
          <Text style={styles.avatarText}>{user.fullName.charAt(0)}</Text>
        </View>

        <Text style={styles.name}>{user.fullName}</Text>
        <Text style={styles.username}>@{user.username}</Text>
        <Text style={styles.email}>
          {user.email.replace(/@zentra\.local@zentra\.gov\.in$/, '@zentra.gov.in')}
        </Text>

        <View style={styles.roleWrap}>
          <Badge label={user.activeRole.replace(/_/g, ' ')} variant="primary" size="md" />
        </View>
      </Card>

      {/* Operation Queue Inspector */}
      <Card variant="default" style={styles.queueCard}>
        <View style={styles.queueHeaderRow}>
          <Icon name="refresh" size={16} color={colors.primary} />
          <Text style={styles.sectionHeader}>LOCAL OPERATION QUEUE STATUS</Text>
        </View>
        <Text style={styles.queueHelp}>
          Offline mutations are safely recorded in local SQLite/WatermelonDB before being synchronized by Phase 12.
        </Text>

        <View style={styles.queueRow}>
          <Text style={styles.queueLabel}>Total Pending Operations</Text>
          <Badge
            label={String(queueStats.totalPending)}
            variant={queueStats.totalPending > 0 ? 'warning' : 'success'}
            size="sm"
          />
        </View>

        <View style={styles.queueRow}>
          <Text style={styles.queueLabel}>Queued Locally</Text>
          <Text style={styles.queueValue}>{queueStats.queuedCount}</Text>
        </View>

        <View style={styles.queueRow}>
          <Text style={styles.queueLabel}>In-Flight Requests</Text>
          <Text style={styles.queueValue}>{queueStats.inFlightCount}</Text>
        </View>

        <View style={styles.queueRow}>
          <Text style={styles.queueLabel}>Failed Retries</Text>
          <Text style={[styles.queueValue, queueStats.failedCount > 0 && styles.errorColor]}>
            {queueStats.failedCount}
          </Text>
        </View>

        {queueStats.failedCount > 0 && (
          <Button
            title="RE-QUEUE FAILED OPERATIONS"
            variant="warning"
            size="md"
            onPress={onRetryFailedOps}
            style={styles.retryButton}
          />
        )}
      </Card>

      {/* Hardware Diagnostics */}
      {onNavigateToDiagnostics && (
        <Button
          title="HARDWARE DIAGNOSTICS (GPS & CAMERA)"
          variant="outline"
          size="lg"
          onPress={onNavigateToDiagnostics}
          style={styles.diagButton}
        />
      )}

      {/* Logout Action */}
      <Button
        title="SIGN OUT OF ZENTRA FIELD"
        variant="danger"
        size="lg"
        onPress={handleLogout}
        style={styles.logoutButton}
      />

      <Text style={styles.footerNote}>
        ZENTRA Field v0.1.0 • Enterprise Field Service Management
      </Text>
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
  profileCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    marginBottom: spacing.md,
  },
  avatarBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatarText: {
    color: colors.primary,
    fontSize: 28,
    fontWeight: '900',
  },
  name: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  username: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  email: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  roleWrap: {
    marginTop: spacing.sm,
  },
  queueCard: {
    marginBottom: spacing.md,
  },
  queueHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  sectionHeader: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  queueHelp: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  queueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  queueLabel: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
  },
  queueValue: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    fontSize: 13,
  },
  errorColor: {
    color: colors.danger,
  },
  retryButton: {
    marginTop: spacing.md,
  },
  diagButton: {
    marginBottom: spacing.sm,
  },
  logoutButton: {
    marginBottom: spacing.md,
  },
  footerNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});

/**
 * ZENTRA Field — Enterprise Status & Priority Badge
 * apps/field/src/components/ui/Badge.tsx
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, radii, typography } from '../../theme/tokens';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'neutral' | 'offline';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  style?: ViewStyle;
  showDot?: boolean;
  dot?: boolean;
}

export function Badge({
  label,
  variant,
  size = 'md',
  style,
  showDot = false,
  dot = false,
}: BadgeProps) {
  const hasDot = showDot || dot;
  // Infer variant if not explicitly provided
  const resolvedVariant: BadgeVariant = variant || inferVariant(label);

  const getVariantStyles = () => {
    switch (resolvedVariant) {
      case 'primary':
        return {
          bg: colors.accentBlueLight,
          border: colors.infoBorder,
          text: colors.accentBlue,
        };
      case 'success':
        return {
          bg: colors.successLight,
          border: colors.successBorder,
          text: colors.success,
        };
      case 'warning':
        return {
          bg: colors.warningLight,
          border: colors.warningBorder,
          text: colors.warning,
        };
      case 'danger':
        return {
          bg: colors.dangerLight,
          border: colors.dangerBorder,
          text: colors.danger,
        };
      case 'info':
        return {
          bg: colors.infoLight,
          border: colors.infoBorder,
          text: colors.info,
        };
      case 'offline':
        return {
          bg: colors.offlineLight,
          border: colors.warningBorder,
          text: colors.offline,
        };
      case 'neutral':
      default:
        return {
          bg: colors.surfaceMuted,
          border: colors.border,
          text: colors.textSecondary,
        };
    }
  };

  const v = getVariantStyles();
  const isSm = size === 'sm';

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: v.bg,
          borderColor: v.border,
          paddingHorizontal: isSm ? 6 : 8,
          paddingVertical: isSm ? 2 : 4,
        },
        style,
      ]}
    >
      {hasDot && (
        <View style={[styles.dot, { backgroundColor: v.text, marginRight: isSm ? 4 : 6 }]} />
      )}
      <Text
        style={[
          styles.label,
          {
            color: v.text,
            fontSize: isSm ? 10 : 11,
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

function inferVariant(label: string): BadgeVariant {
  const norm = label.toUpperCase();

  if (['RESOLVED', 'COMPLETED', 'RESOLVED_ON_SITE', 'SYNCED', 'SERVER CONFIRMED', 'ONLINE'].includes(norm)) {
    return 'success';
  }
  if (['HIGH', 'PENDING_PARTS', 'PENDING_SYNC', 'LOCAL / PENDING', 'QUEUED', 'LOCAL_ONLY', 'OFFLINE'].includes(norm)) {
    return 'warning';
  }
  if (['CRITICAL', 'FAILED', 'ERROR', 'CONFLICT', 'ABORTED'].includes(norm)) {
    return 'danger';
  }
  if (['IN_PROGRESS', 'CHECKED_IN', 'VISIT_STARTED', 'MEDIUM', 'ASSIGNED'].includes(norm)) {
    return 'info';
  }
  return 'neutral';
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    ...typography.label,
    letterSpacing: 0.4,
  },
});

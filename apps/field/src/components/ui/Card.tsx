/**
 * ZENTRA Field — Enterprise Card Component
 * apps/field/src/components/ui/Card.tsx
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { colors, spacing, radii, shadows, typography } from '../../theme/tokens';

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: 'default' | 'subtle' | 'highlight' | 'warning' | 'danger' | 'elevated' | 'primary';
  title?: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  noPadding?: boolean;
}

export function Card({
  children,
  style,
  variant = 'default',
  title,
  subtitle,
  headerRight,
  footer,
  noPadding = false,
}: CardProps) {
  const getVariantStyle = (): ViewStyle => {
    switch (variant) {
      case 'subtle':
        return {
          backgroundColor: colors.surfaceSubtle,
          borderColor: colors.border,
        };
      case 'highlight':
      case 'primary':
        return {
          backgroundColor: colors.surface,
          borderColor: colors.accentBlue,
          borderLeftWidth: 4,
        };
      case 'elevated':
        return {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        };
      case 'warning':
        return {
          backgroundColor: colors.warningLight,
          borderColor: colors.warningBorder,
        };
      case 'danger':
        return {
          backgroundColor: colors.dangerLight,
          borderColor: colors.dangerBorder,
        };
      default:
        return {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        };
    }
  };

  return (
    <View style={[styles.card, getVariantStyle(), shadows.card, style]}>
      {(title || headerRight) && (
        <View style={styles.header}>
          <View style={styles.headerTitleContainer}>
            {title && <Text style={styles.title}>{title}</Text>}
            {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
          {headerRight && <View style={styles.headerRight}>{headerRight}</View>}
        </View>
      )}

      <View style={noPadding ? undefined : styles.body}>{children}</View>

      {footer && <View style={styles.footer}>{footer}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleContainer: {
    flex: 1,
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  headerRight: {
    marginLeft: spacing.sm,
  },
  body: {
    padding: spacing.lg,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceSubtle,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

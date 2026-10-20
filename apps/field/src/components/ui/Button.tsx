/**
 * ZENTRA Field — Enterprise Button Component
 * apps/field/src/components/ui/Button.tsx
 */

import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import { colors, radii, spacing, shadows } from '../../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'outline' | 'success' | 'warning' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  style,
  textStyle,
}: ButtonProps) {
  const getVariantStyles = (): { btn: ViewStyle; text: TextStyle; spinner: string } => {
    switch (variant) {
      case 'accent':
        return {
          btn: {
            backgroundColor: colors.accentBlue,
            borderColor: colors.accentBlue,
          },
          text: {
            color: colors.textInverse,
          },
          spinner: colors.textInverse,
        };
      case 'secondary':
        return {
          btn: {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
          },
          text: {
            color: colors.textPrimary,
          },
          spinner: colors.textPrimary,
        };
      case 'outline':
        return {
          btn: {
            backgroundColor: 'transparent',
            borderColor: colors.borderDark,
          },
          text: {
            color: colors.textPrimary,
          },
          spinner: colors.textPrimary,
        };
      case 'success':
        return {
          btn: {
            backgroundColor: colors.success,
            borderColor: colors.success,
          },
          text: {
            color: colors.textInverse,
          },
          spinner: colors.textInverse,
        };
      case 'warning':
        return {
          btn: {
            backgroundColor: colors.warning,
            borderColor: colors.warning,
          },
          text: {
            color: colors.textInverse,
          },
          spinner: colors.textInverse,
        };
      case 'danger':
        return {
          btn: {
            backgroundColor: colors.danger,
            borderColor: colors.danger,
          },
          text: {
            color: colors.textInverse,
          },
          spinner: colors.textInverse,
        };
      case 'ghost':
        return {
          btn: {
            backgroundColor: 'transparent',
            borderColor: 'transparent',
            borderWidth: 0,
          },
          text: {
            color: colors.accentBlue,
          },
          spinner: colors.accentBlue,
        };
      case 'primary':
      default:
        return {
          btn: {
            backgroundColor: colors.primaryNavy,
            borderColor: colors.primaryNavy,
          },
          text: {
            color: colors.textInverse,
          },
          spinner: colors.textInverse,
        };
    }
  };

  const getSizeStyles = (): { btn: ViewStyle; text: TextStyle } => {
    switch (size) {
      case 'sm':
        return {
          btn: {
            paddingVertical: spacing.xs + 2,
            paddingHorizontal: spacing.md,
            minHeight: 36,
          },
          text: {
            fontSize: 12,
            fontWeight: '600',
          },
        };
      case 'lg':
        return {
          btn: {
            paddingVertical: spacing.md + 2,
            paddingHorizontal: spacing.xxl,
            minHeight: 52,
          },
          text: {
            fontSize: 15,
            fontWeight: '700',
          },
        };
      case 'md':
      default:
        return {
          btn: {
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.lg,
            minHeight: 46,
          },
          text: {
            fontSize: 13,
            fontWeight: '600',
          },
        };
    }
  };

  const v = getVariantStyles();
  const s = getSizeStyles();
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.75}
      style={[
        styles.button,
        v.btn,
        s.btn,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        variant === 'primary' || variant === 'accent' ? shadows.subtle : undefined,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.spinner} />
      ) : (
        <View style={styles.contentRow}>
          {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}
          <Text style={[styles.text, v.text, s.text, textStyle]}>{title}</Text>
          {rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 4,
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leftIcon: {
    marginRight: spacing.sm,
  },
  rightIcon: {
    marginLeft: spacing.sm,
  },
  text: {
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});

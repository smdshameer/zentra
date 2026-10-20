/**
 * ZENTRA Field — Enterprise Icon Component
 * apps/field/src/components/ui/Icon.tsx
 *
 * Professional, dependency-free vector glyph system:
 * - High legibility on mobile outdoor screens
 * - Clean enterprise aesthetics without third-party bundle overhead
 * - Replaces emojis with crisp typography and geometric iconography
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/tokens';

export type IconName =
  | 'home'
  | 'briefcase'
  | 'user'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-up'
  | 'chevron-down'
  | 'arrow-left'
  | 'camera'
  | 'location'
  | 'check'
  | 'check-circle'
  | 'alert'
  | 'alert-circle'
  | 'refresh'
  | 'clock'
  | 'shield'
  | 'school'
  | 'building'
  | 'tool'
  | 'phone'
  | 'car'
  | 'document'
  | 'info'
  | 'lock'
  | 'sync'
  | 'trending-up'
  | 'wallet';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: any;
}

export function Icon({ name, size = 18, color = colors.textSecondary, style }: IconProps) {
  const getGlyph = (): string => {
    switch (name) {
      case 'home':
        return '⌂';
      case 'briefcase':
        return '■';
      case 'user':
        return '●';
      case 'chevron-right':
        return '›';
      case 'chevron-left':
        return '‹';
      case 'chevron-up':
        return '˄';
      case 'chevron-down':
        return '˅';
      case 'arrow-left':
        return '←';
      case 'camera':
        return '▣';
      case 'location':
        return '⌖';
      case 'check':
        return '✓';
      case 'check-circle':
        return '✓';
      case 'alert':
      case 'alert-circle':
        return '!';
      case 'refresh':
        return '↻';
      case 'clock':
        return '◷';
      case 'shield':
        return '◆';
      case 'school':
      case 'building':
        return '🏛';
      case 'tool':
        return '⚙';
      case 'phone':
        return '☎';
      case 'car':
        return '▶';
      case 'document':
        return '≡';
      case 'info':
        return 'ℹ';
      case 'lock':
        return '🔒';
      case 'sync':
        return '⇄';
      case 'trending-up':
        return '↗';
      case 'wallet':
        return '▤';
      default:
        return '•';
    }
  };

  if (name === 'check-circle') {
    return (
      <View
        style={[
          styles.circleBadge,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
          style,
        ]}
      >
        <Text style={[styles.circleBadgeText, { fontSize: size * 0.7 }]}>✓</Text>
      </View>
    );
  }

  if (name === 'alert-circle') {
    return (
      <View
        style={[
          styles.circleBadge,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
          style,
        ]}
      >
        <Text style={[styles.circleBadgeText, { fontSize: size * 0.7 }]}>!</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { width: size, height: size }, style]}>
      <Text
        style={[
          styles.glyph,
          {
            fontSize: name === 'chevron-right' || name === 'chevron-left' ? size * 1.3 : size,
            color,
            lineHeight: size,
          },
        ]}
      >
        {getGlyph()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  glyph: {
    textAlign: 'center',
    fontWeight: '700',
  },
  circleBadge: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  circleBadgeText: {
    color: '#FFFFFF',
    fontWeight: '800',
    textAlign: 'center',
  },
});

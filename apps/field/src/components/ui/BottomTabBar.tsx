/**
 * ZENTRA Field — Enterprise Bottom Navigation Bar
 * apps/field/src/components/ui/BottomTabBar.tsx
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, typography, radii } from '../../theme/tokens';
import { Icon } from './Icon';
import type { ScreenName } from '../../navigation/types';

export interface BottomTabBarProps {
  currentScreen: ScreenName;
  onNavigate: (screen: ScreenName) => void;
  assignedCount: number;
}

export function BottomTabBar({
  currentScreen,
  onNavigate,
  assignedCount,
}: BottomTabBarProps) {
  const isDashboardActive = currentScreen === 'DASHBOARD';
  const isCasesActive =
    currentScreen === 'ASSIGNED_CASES' ||
    currentScreen === 'CASE_DETAIL' ||
    currentScreen === 'FIELD_VISIT' ||
    currentScreen === 'SCHOOL_DETAIL';
  const isProfileActive =
    currentScreen === 'PROFILE' || currentScreen === 'HARDWARE_DIAGNOSTICS';

  return (
    <View style={styles.bar}>
      {/* Home / Dashboard Tab */}
      <TouchableOpacity
        style={styles.tab}
        onPress={() => onNavigate('DASHBOARD')}
        activeOpacity={0.7}
      >
        <Icon
          name="home"
          size={20}
          color={isDashboardActive ? colors.accentBlue : colors.textSecondary}
        />
        <Text
          style={[
            styles.label,
            isDashboardActive ? styles.labelActive : undefined,
          ]}
        >
          Home
        </Text>
      </TouchableOpacity>

      {/* Assigned Calls Tab */}
      <TouchableOpacity
        style={styles.tab}
        onPress={() => onNavigate('ASSIGNED_CASES')}
        activeOpacity={0.7}
      >
        <View style={styles.iconWrapper}>
          <Icon
            name="briefcase"
            size={18}
            color={isCasesActive ? colors.accentBlue : colors.textSecondary}
          />
          {assignedCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{assignedCount}</Text>
            </View>
          )}
        </View>
        <Text
          style={[
            styles.label,
            isCasesActive ? styles.labelActive : undefined,
          ]}
        >
          Assigned Calls
        </Text>
      </TouchableOpacity>

      {/* Profile & Settings Tab */}
      <TouchableOpacity
        style={styles.tab}
        onPress={() => onNavigate('PROFILE')}
        activeOpacity={0.7}
      >
        <Icon
          name="user"
          size={18}
          color={isProfileActive ? colors.accentBlue : colors.textSecondary}
        />
        <Text
          style={[
            styles.label,
            isProfileActive ? styles.labelActive : undefined,
          ]}
        >
          Profile
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    height: 60,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 4,
  },
  tab: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrapper: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 3,
  },
  labelActive: {
    color: colors.accentBlue,
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -12,
    backgroundColor: colors.accentBlue,
    borderRadius: radii.full,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
});

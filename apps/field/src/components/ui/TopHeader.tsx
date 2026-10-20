/**
 * ZENTRA Field — Enterprise Top App Header
 * apps/field/src/components/ui/TopHeader.tsx
 */

import React from 'react';
import { View, Text, StyleSheet, Platform, StatusBar as RNStatusBar } from 'react-native';
import { colors, radii, spacing } from '../../theme/tokens';
import type { NetworkStatus } from '../../network/network-monitor';

export interface TopHeaderProps {
  activeRole: string;
  networkStatus: NetworkStatus;
  pendingCount: number;
}

export function TopHeader({ activeRole, networkStatus, pendingCount }: TopHeaderProps) {
  const isOnline = networkStatus === 'ONLINE';

  return (
    <View style={styles.headerWrapper}>
      <View style={styles.header}>
        {/* Brand Left */}
        <View style={styles.brandContainer}>
          <View style={styles.logoMark}>
            <Text style={styles.logoText}>Z</Text>
          </View>
          <View style={styles.brandTitles}>
            <View style={styles.titleRow}>
              <Text style={styles.appName}>ZENTRA</Text>
              <Text style={styles.appSub}>Field</Text>
            </View>
            <Text style={styles.roleLabel}>{activeRole.replace('_', ' ')}</Text>
          </View>
        </View>

        {/* Status Right */}
        <View style={styles.statusContainer}>
          <View
            style={[
              styles.networkBadge,
              isOnline ? styles.networkOnline : styles.networkOffline,
            ]}
          >
            <View
              style={[
                styles.networkDot,
                isOnline ? styles.dotOnline : styles.dotOffline,
              ]}
            />
            <Text style={styles.networkText}>{networkStatus}</Text>
          </View>

          {pendingCount > 0 && (
            <View style={styles.queueBadge}>
              <Text style={styles.queueCount}>{pendingCount}</Text>
              <Text style={styles.queueText}>QUEUE</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const androidStatusBarHeight = Platform.OS === 'android' ? (RNStatusBar.currentHeight || 28) : 0;

const styles = StyleSheet.create({
  headerWrapper: {
    backgroundColor: colors.primaryNavy,
    paddingTop: androidStatusBarHeight,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryNavyDark,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    height: 60,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  logoText: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
  },
  brandTitles: {
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  appName: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  appSub: {
    color: '#38BDF8',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 4,
  },
  roleLabel: {
    color: colors.textInverseMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  networkOnline: {
    backgroundColor: 'rgba(21, 128, 61, 0.25)',
    borderColor: '#22C55E',
  },
  networkOffline: {
    backgroundColor: 'rgba(180, 83, 9, 0.25)',
    borderColor: '#F59E0B',
  },
  networkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  dotOnline: {
    backgroundColor: '#4ADE80',
  },
  dotOffline: {
    backgroundColor: '#FBBF24',
  },
  networkText: {
    color: colors.textInverse,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  queueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#B45309',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radii.full,
    gap: 3,
  },
  queueCount: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  queueText: {
    color: '#FEF3C7',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

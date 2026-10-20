/**
 * ZENTRA Field — Design System Tokens
 * apps/field/src/theme/tokens.ts
 *
 * Professional enterprise design tokens for Tamil Nadu Hi-Tech Lab Field Operations:
 * - High-contrast outdoor legibility
 * - Consistent typography, spacing, and elevation
 * - Production-quality palette matching ZENTRA brand standards
 */

export const colors = {
  // Brand & Core
  primaryNavy: '#142B4A',
  primaryNavyDark: '#0D1E35',
  primaryNavyLight: '#1E3A8A',
  accentBlue: '#2563EB',
  accentBlueLight: '#DBEAFE',

  // Convenience Aliases
  primary: '#142B4A',
  primaryDark: '#0D1E35',
  primaryLight: '#DBEAFE',
  accent: '#2563EB',

  // Background & Surfaces
  background: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceSubtle: '#F8FAFC',
  surfaceMuted: '#F1F5F9',

  // Typography & Text
  textPrimary: '#172033',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  textInverse: '#FFFFFF',
  textInverseMuted: '#CBD5E1',

  // Borders & Dividers
  border: '#E2E8F0',
  borderSubtle: '#E2E8F0',
  borderDark: '#CBD5E1',
  borderFocus: '#2563EB',

  // Status & Feedback (Foreground / Background pairs)
  success: '#15803D',
  successLight: '#DCFCE7',
  successBorder: '#86EFAC',

  warning: '#B45309',
  warningLight: '#FEF3C7',
  warningBorder: '#FCD34D',

  danger: '#B91C1C',
  dangerLight: '#FEE2E2',
  dangerBorder: '#FCA5A5',

  info: '#1D4ED8',
  infoLight: '#EFF6FF',
  infoBorder: '#BFDBFE',

  // Offline & Sync Indicators
  offline: '#D97706',
  offlineLight: '#FFFBEB',
  synced: '#059669',
  syncedLight: '#ECFDF5',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const typography = {
  h1: {
    fontSize: 20,
    fontWeight: '700' as const,
    lineHeight: 26,
    color: colors.textPrimary,
  },
  h2: {
    fontSize: 16,
    fontWeight: '700' as const,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  h3: {
    fontSize: 14,
    fontWeight: '600' as const,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  body: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  bodyMedium: {
    fontSize: 14,
    fontWeight: '500' as const,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  bodyBold: {
    fontSize: 14,
    fontWeight: '700' as const,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  captionMedium: {
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  label: {
    fontSize: 11,
    fontWeight: '700' as const,
    lineHeight: 14,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    color: colors.textSecondary,
  },
  code: {
    fontSize: 12,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
    color: colors.primaryNavy,
  },
} as const;

export const shadows = {
  subtle: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  elevated: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;

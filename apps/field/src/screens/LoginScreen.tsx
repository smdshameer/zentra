/**
 * ZENTRA Field — Login Screen
 * apps/field/src/screens/LoginScreen.tsx
 *
 * Professional institutional authentication form for Field Engineers.
 * Redesigned with enterprise light theme tokens and reusable UI primitives.
 */

import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { colors, spacing, typography, radii } from '../theme';
import { Card, Button, Icon } from '../components/ui';

interface LoginScreenProps {
  onLogin: (credentials: { username: string; password: string }) => Promise<void>;
  isLoading: boolean;
  errorMessage?: string | null;
}

export function LoginScreen({ onLogin, isLoading, errorMessage }: LoginScreenProps) {
  const [username, setUsername] = useState('fe_erode_01');
  const [password, setPassword] = useState('Password@123');

  const handleSubmit = () => {
    if (!username.trim() || !password.trim()) return;
    onLogin({ username: username.trim(), password });
  };

  return (
    <View style={styles.container}>
      <Card variant="elevated" style={styles.card}>
        {/* Institutional Brand Header */}
        <View style={styles.logoRow}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoText}>Z</Text>
          </View>
          <View style={styles.brandTitleWrap}>
            <Text style={styles.title}>
              ZENTRA <Text style={styles.titleAccent}>Field</Text>
            </Text>
            <Text style={styles.subtitle}>Hi-Tech Lab Field Service Platform</Text>
          </View>
        </View>

        <Text style={styles.prompt}>
          Sign in with your authorized Field Engineer credentials
        </Text>

        {errorMessage ? (
          <View style={styles.errorBox}>
            <Icon name="alert" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Username</Text>
          <View style={styles.inputWrap}>
            <Icon name="user" size={16} color={colors.textMuted} />
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Enter username"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.inputWrap}>
            <Icon name="clock" size={16} color={colors.textMuted} />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>
        </View>

        <Button
          title="SIGN IN TO ZENTRA FIELD"
          variant="primary"
          size="lg"
          loading={isLoading}
          onPress={handleSubmit}
          style={styles.button}
        />

        <Text style={styles.note}>
          Outdoor high-contrast field mode active. Offline local-first persistence enabled.
        </Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    padding: spacing.xl,
    borderRadius: radii.lg,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  logoText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 22,
  },
  brandTitleWrap: {
    flex: 1,
  },
  title: {
    ...typography.h2,
    color: colors.primaryDark,
  },
  titleAccent: {
    color: colors.primary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  prompt: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    padding: spacing.sm,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '600',
    flex: 1,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: 14,
  },
  button: {
    marginTop: spacing.sm,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: spacing.md,
  },
});

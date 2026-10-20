/**
 * ZENTRA — Authentication & RBAC Shared Contracts
 * packages/contracts/src/auth/auth.contract.ts
 */

import { z } from 'zod';
import type { UserRole, AccountStatus } from '@zentra/types';

export const userRoleSchema = z.enum([
  'MASTER_ADMIN',
  'REPORTING_HEAD',
  'DISTRICT_COORDINATOR',
  'FIELD_ENGINEER',
  'AI',
  'HM',
]) as z.ZodType<UserRole>;

export const accountStatusSchema = z.enum([
  'ACTIVE',
  'SUSPENDED',
  'ON_LEAVE',
  'TERMINATED',
]) as z.ZodType<AccountStatus>;

export const loginRequestSchema = z.object({
  username: z.string().min(1, 'Username is required').max(100),
  password: z.string().min(1, 'Password is required').max(256),
  deviceId: z.string().max(128).optional(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const territoryAssignmentSchema = z.object({
  assignmentId: z.string().uuid(),
  userId: z.string().uuid(),
  districtId: z.string().uuid(),
  districtCode: z.string().optional(),
  blockId: z.string().uuid().nullable(),
  blockCode: z.string().nullable().optional(),
  isPrimaryTerritory: z.boolean(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
});

export const userProfileSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  fullName: z.string(),
  phoneNumber: z.string().nullable().optional(),
  accountStatus: accountStatusSchema,
  roles: z.array(userRoleSchema),
  territories: z.array(territoryAssignmentSchema),
});

export type UserProfileDto = z.infer<typeof userProfileSchema>;

export const loginResponseSchema = z.object({
  user: userProfileSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const refreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RefreshTokenRequest = z.infer<typeof refreshTokenRequestSchema>;

export const refreshTokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});

export type RefreshTokenResponse = z.infer<typeof refreshTokenResponseSchema>;

export const logoutRequestSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

export const switchRoleRequestSchema = z.object({
  targetRole: userRoleSchema,
});

export type SwitchRoleRequest = z.infer<typeof switchRoleRequestSchema>;

export const switchRoleResponseSchema = z.object({
  accessToken: z.string(),
  activeRole: userRoleSchema,
  expiresIn: z.number().int().positive(),
});

export type SwitchRoleResponse = z.infer<typeof switchRoleResponseSchema>;

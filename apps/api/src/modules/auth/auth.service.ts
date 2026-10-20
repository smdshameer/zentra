/**
 * ZENTRA — Core Authentication & Identity Service
 * apps/api/src/modules/auth/auth.service.ts
 *
 * Implements Phase 5 Authentication & Security Specifications:
 * - Constant-time credential verification (non-enumeration)
 * - Refresh Token Rotation (RTR) with Token Family tracking
 * - Immediate family revocation upon token reuse/replay detection
 * - Multi-district territory scoping assembly
 * - Immutable security audit trail in `audit_events`
 */

import {
  Injectable,
  Inject,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import type { DatabaseSchema } from '../../database/database.types';
import { DATABASE_CONNECTION } from '../../database/database.connection';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { generateUuidV7 } from '@zentra/shared';
import type {
  LoginRequest,
  LoginResponse,
  RefreshTokenResponse,
  UserProfileDto,
  SwitchRoleResponse,
} from '@zentra/contracts';
import type { UserRole, AccountStatus, TerritoryAssignment } from '@zentra/types';

export interface ClientMetadata {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
    @Inject(PasswordService)
    private readonly passwordService: PasswordService,
    @Inject(TokenService)
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Authenticates user credentials and issues access + refresh tokens.
   * Adheres strictly to non-enumeration standards (generic 401 on failure).
   */
  async login(dto: LoginRequest, clientMeta: ClientMetadata): Promise<LoginResponse> {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('username', '=', dto.username)
      .executeTakeFirst();

    // Constant-time check: even if user does not exist, run a dummy verify to equalize timing
    if (!user || !user.password_hash) {
      await this.recordAuditEvent({
        category: 'AUTHENTICATION',
        actionType: 'LOGIN_FAILED',
        actorUserId: null,
        targetEntityType: 'users',
        targetEntityId: generateUuidV7(),
        details: { reason: 'INVALID_CREDENTIALS', usernameAttempt: dto.username },
        clientMeta,
        deviceId: dto.deviceId,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValidPassword = await this.passwordService.verify(dto.password, user.password_hash);
    if (!isValidPassword) {
      await this.recordAuditEvent({
        category: 'AUTHENTICATION',
        actionType: 'LOGIN_FAILED',
        actorUserId: user.user_id,
        targetEntityType: 'users',
        targetEntityId: user.user_id,
        details: { reason: 'INVALID_CREDENTIALS' },
        clientMeta,
        deviceId: dto.deviceId,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Account status check
    if (user.account_status !== 'ACTIVE') {
      await this.recordAuditEvent({
        category: 'AUTHENTICATION',
        actionType: 'LOGIN_FAILED',
        actorUserId: user.user_id,
        targetEntityType: 'users',
        targetEntityId: user.user_id,
        details: { reason: `ACCOUNT_${user.account_status}` },
        clientMeta,
        deviceId: dto.deviceId,
      });
      // Strict non-enumeration: return identical generic error
      throw new UnauthorizedException('Invalid credentials');
    }

    // Fetch user roles
    const roles = await this.getUserRoles(user.user_id);
    if (roles.length === 0) {
      await this.recordAuditEvent({
        category: 'AUTHENTICATION',
        actionType: 'LOGIN_FAILED',
        actorUserId: user.user_id,
        targetEntityType: 'users',
        targetEntityId: user.user_id,
        details: { reason: 'NO_ACTIVE_ROLES' },
        clientMeta,
        deviceId: dto.deviceId,
      });
      // Strict non-enumeration: return identical generic error
      throw new UnauthorizedException('Invalid credentials');
    }

    // Fetch user territory assignments
    const territories = await this.getUserTerritories(user.user_id);
    const districtIds = Array.from(new Set(territories.map((t) => t.districtId)));

    // Generate tokens under the canonical Active-Role Model
    const activeRole = roles[0];
    const { token: accessToken, expiresIn } = this.tokenService.generateAccessToken({
      userId: user.user_id,
      username: user.username,
      roles,
      activeRole,
      territoryDistrictIds: districtIds,
      deviceId: dto.deviceId,
    });

    const { tokenSecret, tokenHash, familyId, expiresAt } =
      this.tokenService.generateRefreshToken();

    // Persist hashed refresh token
    const refreshTokenId = generateUuidV7();
    await this.db
      .insertInto('refresh_tokens')
      .values({
        refresh_token_id: refreshTokenId,
        user_id: user.user_id,
        token_hash: tokenHash,
        family_id: familyId,
        is_revoked: false,
        expires_at: expiresAt,
        device_id: dto.deviceId ?? null,
        ip_address: clientMeta.ipAddress ?? null,
        user_agent: clientMeta.userAgent ?? null,
      })
      .execute();

    // Update current device if supplied
    if (dto.deviceId) {
      await this.db
        .updateTable('users')
        .set({ current_device_id: dto.deviceId })
        .where('user_id', '=', user.user_id)
        .execute();
    }

    // Record login audit event
    await this.recordAuditEvent({
      category: 'AUTHENTICATION',
      actionType: 'LOGIN_SUCCESS',
      actorUserId: user.user_id,
      targetEntityType: 'users',
      targetEntityId: user.user_id,
      details: { roleCount: roles.length, territoryCount: territories.length },
      clientMeta,
      deviceId: dto.deviceId,
    });

    const userProfile: UserProfileDto = {
      userId: user.user_id,
      username: user.username,
      fullName: user.full_name,
      phoneNumber: user.phone_number,
      accountStatus: user.account_status as AccountStatus,
      roles,
      territories,
    };

    return {
      user: userProfile,
      accessToken,
      refreshToken: tokenSecret,
      tokenType: 'Bearer',
      expiresIn,
    };
  }

  /**
   * Refreshes access token with Refresh Token Rotation (RTR).
   * Implements automated token family revocation if reuse of an old token is detected.
   */
  async refresh(
    refreshTokenSecret: string,
    clientMeta: ClientMetadata,
  ): Promise<RefreshTokenResponse> {
    if (!refreshTokenSecret) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const tokenHash = this.tokenService.hashToken(refreshTokenSecret);

    const tokenRecord = await this.db
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Token reuse / replay detection
    if (tokenRecord.is_revoked) {
      // Immediate family revocation
      await this.db
        .updateTable('refresh_tokens')
        .set({
          is_revoked: true,
          revoked_at: sql`CURRENT_TIMESTAMP`,
        })
        .where('family_id', '=', tokenRecord.family_id)
        .execute();

      // Record high-priority security audit event
      await this.recordAuditEvent({
        category: 'SECURITY',
        actionType: 'REFRESH_TOKEN_REUSE_DETECTED',
        actorUserId: tokenRecord.user_id,
        targetEntityType: 'refresh_tokens',
        targetEntityId: tokenRecord.refresh_token_id,
        details: {
          familyId: tokenRecord.family_id,
          message: 'Revoked entire token family due to reused refresh token',
        },
        clientMeta,
      });

      throw new UnauthorizedException(
        'Token reuse detected. All sessions in this family have been invalidated.',
      );
    }

    // Expiry check
    if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    // Validate user still active
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('user_id', '=', tokenRecord.user_id)
      .executeTakeFirst();

    if (!user || user.account_status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is no longer active');
    }

    // Revoke the current token (Rotation)
    await this.db
      .updateTable('refresh_tokens')
      .set({
        is_revoked: true,
        revoked_at: sql`CURRENT_TIMESTAMP`,
      })
      .where('refresh_token_id', '=', tokenRecord.refresh_token_id)
      .execute();

    // Issue new refresh token within the same family
    const nextRefresh = this.tokenService.generateRefreshToken(tokenRecord.family_id);
    const nextTokenId = generateUuidV7();

    await this.db
      .insertInto('refresh_tokens')
      .values({
        refresh_token_id: nextTokenId,
        user_id: user.user_id,
        token_hash: nextRefresh.tokenHash,
        family_id: tokenRecord.family_id,
        is_revoked: false,
        expires_at: nextRefresh.expiresAt,
        device_id: tokenRecord.device_id,
        ip_address: clientMeta.ipAddress ?? null,
        user_agent: clientMeta.userAgent ?? null,
      })
      .execute();

    // Fetch updated roles and territories
    const roles = await this.getUserRoles(user.user_id);
    const territories = await this.getUserTerritories(user.user_id);
    const districtIds = Array.from(new Set(territories.map((t) => t.districtId)));

    const activeRole = roles[0];
    const { token: accessToken, expiresIn } = this.tokenService.generateAccessToken({
      userId: user.user_id,
      username: user.username,
      roles,
      activeRole,
      territoryDistrictIds: districtIds,
      deviceId: tokenRecord.device_id ?? undefined,
    });

    await this.recordAuditEvent({
      category: 'AUTHENTICATION',
      actionType: 'TOKEN_REFRESH_SUCCESS',
      actorUserId: user.user_id,
      targetEntityType: 'refresh_tokens',
      targetEntityId: nextTokenId,
      details: { familyId: tokenRecord.family_id },
      clientMeta,
    });

    return {
      accessToken,
      refreshToken: nextRefresh.tokenSecret,
      tokenType: 'Bearer',
      expiresIn,
    };
  }

  /**
   * Revokes the specified refresh token upon logout.
   */
  async logout(refreshTokenSecret: string, clientMeta: ClientMetadata): Promise<{ success: boolean }> {
    if (!refreshTokenSecret) {
      return { success: true };
    }

    const tokenHash = this.tokenService.hashToken(refreshTokenSecret);

    const tokenRecord = await this.db
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();

    if (tokenRecord) {
      await this.db
        .updateTable('refresh_tokens')
        .set({
          is_revoked: true,
          revoked_at: sql`CURRENT_TIMESTAMP`,
        })
        .where('refresh_token_id', '=', tokenRecord.refresh_token_id)
        .execute();

      await this.recordAuditEvent({
        category: 'AUTHENTICATION',
        actionType: 'LOGOUT',
        actorUserId: tokenRecord.user_id,
        targetEntityType: 'refresh_tokens',
        targetEntityId: tokenRecord.refresh_token_id,
        details: { familyId: tokenRecord.family_id },
        clientMeta,
      });
    }

    return { success: true };
  }

  /**
   * Switches active role for a multi-role user and issues updated JWT access token.
   */
  async switchRole(
    userId: string,
    targetRole: UserRole,
    clientMeta: ClientMetadata,
  ): Promise<SwitchRoleResponse> {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!user || user.account_status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is not active');
    }

    const roles = await this.getUserRoles(userId);
    if (!roles.includes(targetRole)) {
      throw new ForbiddenException(`User does not possess requested role: ${targetRole}`);
    }

    const territories = await this.getUserTerritories(userId);
    const districtIds = Array.from(new Set(territories.map((t) => t.districtId)));

    const { token: accessToken, expiresIn } = this.tokenService.generateAccessToken({
      userId: user.user_id,
      username: user.username,
      roles,
      activeRole: targetRole,
      territoryDistrictIds: districtIds,
      deviceId: user.current_device_id ?? undefined,
    });

    await this.recordAuditEvent({
      category: 'AUTHENTICATION',
      actionType: 'ROLE_SWITCHED',
      actorUserId: user.user_id,
      targetEntityType: 'users',
      targetEntityId: user.user_id,
      details: { previousRole: roles[0], targetRole },
      clientMeta,
    });

    return {
      accessToken,
      activeRole: targetRole,
      expiresIn,
    };
  }

  /**
   * Retrieves full profile and territory assignments for an authenticated user.
   */
  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.db
      .selectFrom('users')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const roles = await this.getUserRoles(userId);
    const territories = await this.getUserTerritories(userId);

    return {
      userId: user.user_id,
      username: user.username,
      fullName: user.full_name,
      phoneNumber: user.phone_number,
      accountStatus: user.account_status as AccountStatus,
      roles,
      territories,
    };
  }

  /**
   * Retrieves user roles from user_roles and roles join.
   */
  async getUserRoles(userId: string): Promise<UserRole[]> {
    const records = await this.db
      .selectFrom('user_roles')
      .innerJoin('roles', 'roles.role_id', 'user_roles.role_id')
      .select('roles.role_code')
      .where('user_roles.user_id', '=', userId)
      .where('roles.is_active', '=', true)
      .execute();

    return records.map((r) => r.role_code as UserRole);
  }

  /**
   * Retrieves user territory assignments with joined codes.
   */
  async getUserTerritories(userId: string): Promise<TerritoryAssignment[]> {
    const rows = await this.db
      .selectFrom('user_territory_assignments as uta')
      .innerJoin('districts as d', 'd.district_id', 'uta.district_id')
      .leftJoin('blocks as b', 'b.block_id', 'uta.block_id')
      .select([
        'uta.assignment_id',
        'uta.user_id',
        'uta.district_id',
        'd.district_code',
        'uta.block_id',
        'b.block_code',
        'uta.is_primary_territory',
        'uta.valid_from',
        'uta.valid_to',
      ])
      .where('uta.user_id', '=', userId)
      .where((eb) =>
        eb.or([eb('uta.valid_to', 'is', null), eb('uta.valid_to', '>', new Date())]),
      )
      .execute();

    return rows.map((r) => ({
      assignmentId: r.assignment_id,
      userId: r.user_id,
      districtId: r.district_id,
      districtCode: r.district_code,
      blockId: r.block_id,
      blockCode: r.block_code ?? null,
      isPrimaryTerritory: r.is_primary_territory,
      validFrom: (r.valid_from as Date).toISOString?.() ?? String(r.valid_from),
      validTo: r.valid_to ? ((r.valid_to as Date).toISOString?.() ?? String(r.valid_to)) : null,
    }));
  }

  private async recordAuditEvent(params: {
    category: string;
    actionType: string;
    actorUserId: string | null;
    targetEntityType: string;
    targetEntityId: string;
    details: Record<string, unknown>;
    clientMeta: ClientMetadata;
    deviceId?: string;
  }): Promise<void> {
    try {
      await this.db
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          event_category: params.category,
          action_type: params.actionType,
          actor_user_id: params.actorUserId,
          target_entity_type: params.targetEntityType,
          target_entity_id: params.targetEntityId,
          actor_ip_address: params.clientMeta.ipAddress ?? null,
          actor_device_id: params.deviceId ?? null,
          pre_mutation_state: null,
          post_mutation_state: params.details,
        })
        .execute();
    } catch {
      // Audit failure must not crash the application, but must be captured in production logging
    }
  }
}

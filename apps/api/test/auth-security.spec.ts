/**
 * ZENTRA — Authentication, Multi-District RBAC & RLS Integration Tests
 * apps/api/test/auth-security.spec.ts
 *
 * Implements Phase 5 Security Verification Suite:
 * - Scrypt Password Hashing & Constant-Time Verification
 * - JWT Access Token & Hashed Refresh Token Engine
 * - Non-Enumeration Credential Verification
 * - Refresh Token Rotation (RTR) & Token Family Replay Detection
 * - Role-Based Access Control (RBAC) Guard Enforcement
 * - Multi-District & Multi-Block Territory Scoping
 * - PostgreSQL Row-Level Security (RLS) Fail-Closed Data Isolation
 * - Zero Credential/Secret Leakage in Persistence & Audit Logs
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Kysely, sql } from 'kysely';
import { AppModule } from '../src/app.module';
import { createDatabaseConnection } from '../src/database/database.connection';
import type { DatabaseSchema } from '../src/database/database.types';
import { runMigrationsToLatest } from '../src/database/migration-runner';
import {
  seedSyntheticDevelopmentFixtures,
  SYNTHETIC_TEST_PASSWORD,
  type SeededEntities,
} from '../src/database/seeds/synthetic-dev-fixtures';
import { PasswordService } from '../src/modules/auth/password.service';
import { TokenService } from '../src/modules/auth/token.service';
import { RlsService } from '../src/modules/auth/rls.service';
import {
  setupDisposableIntegrationHarness,
  DISPOSABLE_INTEGRATION_TEST_DATABASE,
} from '@zentra/testing';
import type { LoginResponse, RefreshTokenResponse, UserProfileDto } from '@zentra/contracts';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  `postgresql://postgres:postgres@localhost:5432/${DISPOSABLE_INTEGRATION_TEST_DATABASE}`;

describe('ZENTRA Phase 5: Authentication, RBAC & RLS Security Suite', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let passwordService: PasswordService;
  let tokenService: TokenService;
  let rlsService: RlsService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;

    const harness = await setupDisposableIntegrationHarness(
      TEST_DB_URL,
      createDatabaseConnection,
      runMigrationsToLatest,
    );
    db = harness.db;

    // Clean up test tables in foreign-key dependency order
    await db.deleteFrom('conveyance_claims').execute();
    await db.deleteFrom('evidence_files').execute();
    await db.deleteFrom('visit_equipment_findings').execute();
    await db.deleteFrom('field_visits').execute();
    await sql`TRUNCATE TABLE assignment_history, service_case_status_history CASCADE;`.execute(db);
    await db.deleteFrom('service_cases').execute();
    await db.deleteFrom('source_complaints').execute();
    await db.deleteFrom('complaint_sources').execute();
    await db.deleteFrom('refresh_tokens').execute();
    await db.deleteFrom('user_territory_assignments').execute();
    await db.deleteFrom('user_roles').execute();
    await db.deleteFrom('role_permissions').execute();
    await db.deleteFrom('users').execute();
    await db.deleteFrom('roles').execute();
    await db.deleteFrom('permissions').execute();
    await db.deleteFrom('lab_equipment').execute();
    await db.deleteFrom('equipment_attribute_definitions').execute();
    await db.deleteFrom('equipment_types').execute();
    await db.deleteFrom('oem_manufacturers').execute();
    await db.deleteFrom('hi_tech_labs').execute();
    await db.deleteFrom('schools').execute();
    await db.deleteFrom('blocks').execute();
    await db.deleteFrom('districts').execute();
    await db.deleteFrom('audit_events').execute();

    // Seed synthetic fixtures
    seeded = await seedSyntheticDevelopmentFixtures(db);

    passwordService = new PasswordService();
    tokenService = new TokenService();
    rlsService = new RlsService(db);

    // Bootstrap NestJS Fastify testing application
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (db) {
      await db.destroy();
    }
  });

  // =========================================================================
  // 1. Password Security & Scrypt Cryptography
  // =========================================================================
  describe('1. Scrypt Password Hashing & Verification', () => {
    it('generates compliant Scrypt formatted hashes with random 16-byte salt', async () => {
      const password = 'TestSecretPassword#2026';
      const hash1 = await passwordService.hash(password);
      const hash2 = await passwordService.hash(password);

      expect(hash1).toMatch(/^scrypt\$N=16384,r=8,p=1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      expect(hash2).toMatch(/^scrypt\$N=16384,r=8,p=1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      // Different random salts produce different hashes
      expect(hash1).not.toBe(hash2);
    });

    it('successfully verifies correct password against Scrypt hash', async () => {
      const password = 'CorrectPassword#2026';
      const hash = await passwordService.hash(password);
      const isMatch = await passwordService.verify(password, hash);
      expect(isMatch).toBe(true);
    });

    it('rejects incorrect password against Scrypt hash', async () => {
      const hash = await passwordService.hash('CorrectPassword#2026');
      const isMatch = await passwordService.verify('WrongPassword#2026', hash);
      expect(isMatch).toBe(false);
    });

    it('safely handles corrupted or malformed hash strings without crashing', async () => {
      expect(await passwordService.verify('test', 'not-a-valid-hash')).toBe(false);
      expect(await passwordService.verify('test', 'scrypt$bad$salt$key')).toBe(false);
      expect(await passwordService.verify('test', '')).toBe(false);
    });
  });

  // =========================================================================
  // 2. Token Security & HMAC-SHA256 JWT
  // =========================================================================
  describe('2. JWT Access Token & Refresh Token Engine', () => {
    it('generates access token with 15-minute expiration and required claims', () => {
      const result = tokenService.generateAccessToken({
        userId: seeded.adminUserId,
        username: 'admin.demo@zentra.test',
        roles: ['MASTER_ADMIN'],
        territoryDistrictIds: [seeded.districtId],
      });

      expect(result.token).toBeDefined();
      expect(result.expiresIn).toBe(900);

      const claims = tokenService.verifyAccessToken(result.token);
      expect(claims.sub).toBe(seeded.adminUserId);
      expect(claims.username).toBe('admin.demo@zentra.test');
      expect(claims.roles).toContain('MASTER_ADMIN');
      expect(claims.territoryDistrictIds).toContain(seeded.districtId);
      expect(claims.exp - claims.iat).toBe(900);
    });

    it('rejects tampered JWT signature with UnauthorizedException', () => {
      const { token } = tokenService.generateAccessToken({
        userId: seeded.adminUserId,
        username: 'admin.demo@zentra.test',
        roles: ['MASTER_ADMIN'],
        territoryDistrictIds: [],
      });

      const parts = token.split('.');
      const tamperedSignature = parts[2]!.substring(0, parts[2]!.length - 4) + 'AAAA';
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSignature}`;

      expect(() => tokenService.verifyAccessToken(tamperedToken)).toThrow('Invalid token signature');
    });

    it('generates 32-byte hex refresh token secret and SHA-256 storage hash', () => {
      const generated = tokenService.generateRefreshToken();
      expect(generated.tokenSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(generated.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(generated.familyId).toBeDefined();
      expect(tokenService.hashToken(generated.tokenSecret)).toBe(generated.tokenHash);
    });
  });

  // =========================================================================
  // 3. Authentication API Endpoints (POST /api/v1/auth/login)
  // =========================================================================
  describe('3. Login Endpoint & Non-Enumeration Security', () => {
    it('authenticates valid credentials and returns profile with access + refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'admin.demo@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
          deviceId: 'device-test-001',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);

      const data: LoginResponse = body.data;
      expect(data.user.username).toBe('admin.demo@zentra.test');
      expect(data.user.roles).toContain('MASTER_ADMIN');
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();
      expect(data.tokenType).toBe('Bearer');
      expect(data.expiresIn).toBe(900);

      // Verify device was updated
      const user = await db
        .selectFrom('users')
        .select('current_device_id')
        .where('user_id', '=', seeded.adminUserId)
        .executeTakeFirst();
      expect(user?.current_device_id).toBe('device-test-001');

      // Verify refresh token was stored as SHA-256 hash in DB, NOT plaintext
      const storedToken = await db
        .selectFrom('refresh_tokens')
        .selectAll()
        .where('user_id', '=', seeded.adminUserId)
        .executeTakeFirst();
      expect(storedToken).toBeDefined();
      expect(storedToken?.token_hash).not.toBe(data.refreshToken);
      expect(tokenService.hashToken(data.refreshToken)).toBe(storedToken?.token_hash);
    });

    it('returns generic 401 on incorrect password (non-enumeration)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'admin.demo@zentra.test',
          password: 'WrongPassword#999',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Invalid credentials');
    });

    it('returns generic 401 on non-existent username (non-enumeration)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'nonexistent.user@zentra.test',
          password: 'SomePassword#123',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Invalid credentials');
    });

    it('rejects suspended accounts with generic 401 Invalid credentials (non-enumeration)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'engineer.suspended@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Invalid credentials');
    });

    it('rejects on-leave accounts with generic 401 Invalid credentials (non-enumeration)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'engineer.onleave@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Invalid credentials');
    });

    it('rejects terminated accounts with generic 401 Invalid credentials (non-enumeration)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'engineer.terminated@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Invalid credentials');
    });

    it('records immutable audit events for login attempts with granular internal reasons', async () => {
      const auditRows = await db
        .selectFrom('audit_events')
        .where('event_category', '=', 'AUTHENTICATION')
        .selectAll()
        .execute();

      expect(auditRows.length).toBeGreaterThan(0);
      const actions = auditRows.map((r) => r.action_type);
      expect(actions).toContain('LOGIN_SUCCESS');
      expect(actions).toContain('LOGIN_FAILED');

      // Verify internal granular reasons in audit event metadata
      const failureReasons = auditRows
        .filter((r) => r.action_type === 'LOGIN_FAILED')
        .map((r) => (r.post_mutation_state as Record<string, unknown>)?.reason);
      expect(failureReasons).toContain('ACCOUNT_SUSPENDED');
      expect(failureReasons).toContain('ACCOUNT_ON_LEAVE');
      expect(failureReasons).toContain('ACCOUNT_TERMINATED');
    });
  });

  // =========================================================================
  // 4. Refresh Token Rotation (RTR) & Replay Attack Defense
  // =========================================================================
  describe('4. Refresh Token Rotation (RTR) & Token Family Defense', () => {
    it('rotates refresh token and returns new pair on valid refresh', async () => {
      // 1. Initial login
      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'coordinator.erode@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });
      const loginData: LoginResponse = JSON.parse(loginRes.payload).data;
      const initialRefreshToken = loginData.refreshToken;

      // 2. Perform refresh
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: initialRefreshToken },
      });

      expect(refreshRes.statusCode).toBe(200);
      const refreshData: RefreshTokenResponse = JSON.parse(refreshRes.payload).data;
      expect(refreshData.accessToken).toBeDefined();
      expect(refreshData.refreshToken).toBeDefined();
      expect(refreshData.refreshToken).not.toBe(initialRefreshToken);

      // Verify the initial token is now marked is_revoked = true
      const initialTokenHash = tokenService.hashToken(initialRefreshToken);
      const initialRecord = await db
        .selectFrom('refresh_tokens')
        .selectAll()
        .where('token_hash', '=', initialTokenHash)
        .executeTakeFirst();
      expect(initialRecord?.is_revoked).toBe(true);
      expect(initialRecord?.revoked_at).toBeDefined();

      // Verify the new token is active in the same family
      const nextTokenHash = tokenService.hashToken(refreshData.refreshToken);
      const nextRecord = await db
        .selectFrom('refresh_tokens')
        .selectAll()
        .where('token_hash', '=', nextTokenHash)
        .executeTakeFirst();
      expect(nextRecord?.is_revoked).toBe(false);
      expect(nextRecord?.family_id).toBe(initialRecord?.family_id);
    });

    it('triggers family revocation when an already-revoked refresh token is replayed', async () => {
      // 1. Login
      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'coordinator.salem@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });
      const token1 = JSON.parse(loginRes.payload).data.refreshToken;

      // 2. First refresh (legitimate) -> token1 is revoked, token2 issued
      const refreshRes1 = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: token1 },
      });
      expect(refreshRes1.statusCode).toBe(200);
      const token2 = JSON.parse(refreshRes1.payload).data.refreshToken;

      // 3. Second refresh using the ALREADY-REVOKED token1 (Replay Attack!)
      const replayRes = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: token1 },
      });

      expect(replayRes.statusCode).toBe(401);
      const replayBody = JSON.parse(replayRes.payload);
      expect(replayBody.error.message).toContain('Token reuse detected');

      // 4. Verify that token2 has also been revoked as part of the family revocation
      const token2Hash = tokenService.hashToken(token2);
      const token2Record = await db
        .selectFrom('refresh_tokens')
        .selectAll()
        .where('token_hash', '=', token2Hash)
        .executeTakeFirst();
      expect(token2Record?.is_revoked).toBe(true);

      // 5. Subsequent attempt to use token2 must also fail
      const refreshRes2 = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: token2 },
      });
      expect(refreshRes2.statusCode).toBe(401);

      // 6. Security incident logged in audit_events
      const securityAudit = await db
        .selectFrom('audit_events')
        .where('event_category', '=', 'SECURITY')
        .where('action_type', '=', 'REFRESH_TOKEN_REUSE_DETECTED')
        .selectAll()
        .execute();
      expect(securityAudit.length).toBeGreaterThan(0);
    });

    it('revokes refresh token upon logout', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'engineer.demo@zentra.local',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });
      const refreshToken = JSON.parse(loginRes.payload).data.refreshToken;

      const logoutRes = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        payload: { refreshToken },
      });

      expect(logoutRes.statusCode).toBe(200);
      const logoutBody = JSON.parse(logoutRes.payload);
      expect(logoutBody.data.loggedOut).toBe(true);

      // Verify token in DB is revoked
      const tokenHash = tokenService.hashToken(refreshToken);
      const record = await db
        .selectFrom('refresh_tokens')
        .selectAll()
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();
      expect(record?.is_revoked).toBe(true);
    });
  });

  // =========================================================================
  // 5. Profile & RBAC Authorization Guards
  // =========================================================================
  describe('5. Profile (/auth/me) & RBAC Guard Enforcement', () => {
    it('returns authenticated user profile on GET /auth/me', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'coordinator.erode@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });
      const accessToken = JSON.parse(loginRes.payload).data.accessToken;

      const profileRes = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(profileRes.statusCode).toBe(200);
      const profile: UserProfileDto = JSON.parse(profileRes.payload).data;
      expect(profile.username).toBe('coordinator.erode@zentra.test');
      expect(profile.roles).toContain('DISTRICT_COORDINATOR');
      expect(profile.territories.length).toBeGreaterThan(0);
      expect(profile.territories[0]?.districtCode).toBe('DEMO_DIS');
    });

    it('rejects unauthenticated request to /auth/me with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
      });
      expect(res.statusCode).toBe(401);
    });

    it('permits MASTER_ADMIN on admin-only demonstration endpoint', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'admin.demo@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });
      const adminToken = JSON.parse(loginRes.payload).data.accessToken;

      const res = await app.inject({
        method: 'GET',
        url: '/auth/demonstration/admin-only',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).data.message).toContain('Master Admin');
    });

    it('denies FIELD_ENGINEER on admin-only demonstration endpoint with 403 Forbidden', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'engineer.demo@zentra.local',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });
      const engineerToken = JSON.parse(loginRes.payload).data.accessToken;

      const res = await app.inject({
        method: 'GET',
        url: '/auth/demonstration/admin-only',
        headers: { authorization: `Bearer ${engineerToken}` },
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.payload).error.message).toContain('insufficient role privileges');
    });

    it('allows REPORTING_HEAD to authenticate and retrieve profile with statewide monitoring scope', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'reporting.head@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });
      expect(loginRes.statusCode).toBe(200);
      const data: LoginResponse = JSON.parse(loginRes.payload).data;
      expect(data.user.roles).toContain('REPORTING_HEAD');

      const profileRes = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${data.accessToken}` },
      });
      expect(profileRes.statusCode).toBe(200);
      const profile: UserProfileDto = JSON.parse(profileRes.payload).data;
      expect(profile.roles).toContain('REPORTING_HEAD');
    });

    it('denies REPORTING_HEAD on admin-only demonstration endpoint with 403 Forbidden', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'reporting.head@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });
      const token = JSON.parse(loginRes.payload).data.accessToken;

      const res = await app.inject({
        method: 'GET',
        url: '/auth/demonstration/admin-only',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.payload).error.message).toContain('insufficient role privileges');
    });

    it('verifies REPORTING_HEAD possesses zero dispatch or mutation permissions in role_permissions', async () => {
      const perms = await db
        .selectFrom('role_permissions')
        .innerJoin('permissions', 'permissions.permission_id', 'role_permissions.permission_id')
        .select('permissions.permission_code')
        .where('role_permissions.role_id', '=', seeded.roleIds.REPORTING_HEAD)
        .execute();

      const permCodes = perms.map((p) => p.permission_code);
      expect(permCodes).toContain('schools:read');
      expect(permCodes).toContain('service_cases:read');
      expect(permCodes).toContain('audit:read');

      // Prohibited permissions for analytical/monitoring role
      expect(permCodes).not.toContain('dispatch:manage');
      expect(permCodes).not.toContain('schools:write');
      expect(permCodes).not.toContain('service_cases:write');
    });
  });

  // =========================================================================
  // 6. Multi-District Territory Scoping Guards
  // =========================================================================
  describe('6. Multi-District Territory Scoping', () => {
    it('allows District Coordinator access to their assigned district', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'coordinator.erode@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });
      const erodeToken = JSON.parse(loginRes.payload).data.accessToken;

      const res = await app.inject({
        method: 'GET',
        url: `/auth/demonstration/district-scoped/${seeded.districtId}`,
        headers: { authorization: `Bearer ${erodeToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).data.districtId).toBe(seeded.districtId);
    });

    it('blocks District Coordinator from accessing other districts with 403 Forbidden', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'coordinator.erode@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });
      const erodeToken = JSON.parse(loginRes.payload).data.accessToken;

      // Attempting to access Salem district (District B)
      const res = await app.inject({
        method: 'GET',
        url: `/auth/demonstration/district-scoped/${seeded.secondDistrictId}`,
        headers: { authorization: `Bearer ${erodeToken}` },
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.payload).error.message).toContain(
        'not assigned to this district territory',
      );
    });

    it('permits MASTER_ADMIN global access across any district', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'admin.demo@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });
      const adminToken = JSON.parse(loginRes.payload).data.accessToken;

      // Access District A
      const resA = await app.inject({
        method: 'GET',
        url: `/auth/demonstration/district-scoped/${seeded.districtId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(resA.statusCode).toBe(200);

      // Access District B
      const resB = await app.inject({
        method: 'GET',
        url: `/auth/demonstration/district-scoped/${seeded.secondDistrictId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(resB.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // 7. PostgreSQL Row-Level Security (RLS) Database-Enforced Isolation
  // =========================================================================
  describe('7. PostgreSQL Row-Level Security (RLS) Enforcement', () => {
    it('RLS Schools: MASTER_ADMIN sees schools across all districts', async () => {
      const schools = await rlsService.withSecurityContext(
        { userId: seeded.adminUserId, role: 'MASTER_ADMIN' },
        async (trx) => {
          return await trx.selectFrom('schools').select(['school_id', 'district_id']).execute();
        },
      );

      const districtIds = schools.map((s) => s.district_id);
      expect(districtIds).toContain(seeded.districtId);
      expect(districtIds).toContain(seeded.secondDistrictId);
      expect(schools.length).toBeGreaterThanOrEqual(2);
    });

    it('RLS Schools: District Coordinator sees ONLY schools in their assigned district', async () => {
      // Erode Coordinator query
      const erodeSchools = await rlsService.withSecurityContext(
        { userId: seeded.erodeCoordinatorUserId, role: 'DISTRICT_COORDINATOR' },
        async (trx) => {
          return await trx.selectFrom('schools').select(['school_id', 'district_id']).execute();
        },
      );

      expect(erodeSchools.length).toBeGreaterThan(0);
      for (const school of erodeSchools) {
        expect(school.district_id).toBe(seeded.districtId);
        expect(school.district_id).not.toBe(seeded.secondDistrictId);
      }

      // Salem Coordinator query
      const salemSchools = await rlsService.withSecurityContext(
        { userId: seeded.salemCoordinatorUserId, role: 'DISTRICT_COORDINATOR' },
        async (trx) => {
          return await trx.selectFrom('schools').select(['school_id', 'district_id']).execute();
        },
      );

      expect(salemSchools.length).toBeGreaterThan(0);
      for (const school of salemSchools) {
        expect(school.district_id).toBe(seeded.secondDistrictId);
        expect(school.district_id).not.toBe(seeded.districtId);
      }
    });

    it('RLS Service Cases: Field Engineer sees assigned cases, but zero unassigned cases in other districts', async () => {
      const cases = await rlsService.withSecurityContext(
        { userId: seeded.userId, role: 'FIELD_ENGINEER' },
        async (trx) => {
          return await trx
            .selectFrom('service_cases')
            .select(['service_case_id', 'zentra_case_code', 'assigned_primary_engineer_id'])
            .execute();
        },
      );

      const caseIds = cases.map((c) => c.service_case_id);
      expect(caseIds).toContain(seeded.serviceCaseId);
      // District B unassigned case is completely invisible to Field Engineer
      expect(caseIds).not.toContain(seeded.secondServiceCaseId);
    });

    it('RLS Fail-Closed: Unauthenticated context yields 0 rows on schools and service_cases', async () => {
      const schools = await rlsService.withUnauthenticatedContext(async (trx) => {
        return await trx.selectFrom('schools').selectAll().execute();
      });
      expect(schools.length).toBe(0);

      const cases = await rlsService.withUnauthenticatedContext(async (trx) => {
        return await trx.selectFrom('service_cases').selectAll().execute();
      });
      expect(cases.length).toBe(0);
    });

    it('RLS Context Isolation: SET LOCAL does not leak context across queries after transaction completion', async () => {
      // 1. Run query as MASTER_ADMIN inside transaction
      await rlsService.withSecurityContext(
        { userId: seeded.adminUserId, role: 'MASTER_ADMIN' },
        async (trx) => {
          const res = await trx.selectFrom('schools').execute();
          expect(res.length).toBeGreaterThan(0);
        },
      );

      // 2. Run query on a subsequent transaction without user/role context -> fails closed to 0 rows
      const failClosedQuery = await rlsService.withUnauthenticatedContext(async (trx) => {
        return await trx.selectFrom('schools').execute();
      });
      expect(failClosedQuery.length).toBe(0);
    });

    it('RLS Schools: REPORTING_HEAD sees schools across all districts statewide', async () => {
      const schools = await rlsService.withSecurityContext(
        { userId: seeded.reportingHeadUserId, role: 'REPORTING_HEAD' },
        async (trx) => {
          return await trx.selectFrom('schools').select(['school_id', 'district_id']).execute();
        },
      );

      const districtIds = schools.map((s) => s.district_id);
      expect(districtIds).toContain(seeded.districtId);
      expect(districtIds).toContain(seeded.secondDistrictId);
      expect(schools.length).toBeGreaterThanOrEqual(2);
    });

    it('RLS Schools Endpoint: REPORTING_HEAD reads statewide schools via API demonstration', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          username: 'reporting.head@zentra.test',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });
      const token = JSON.parse(loginRes.payload).data.accessToken;

      const res = await app.inject({
        method: 'GET',
        url: '/auth/demonstration/rls-schools',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload).data;
      expect(data.visibleSchoolsCount).toBeGreaterThanOrEqual(2);
    });

    it('RLS Territory Staleness: immediate revocation in database blocks access on next query without token re-issuance', async () => {
      // 1. Initially, Erode Coordinator queries schools and receives District A
      const initialSchools = await rlsService.withSecurityContext(
        { userId: seeded.erodeCoordinatorUserId, role: 'DISTRICT_COORDINATOR' },
        async (trx) => {
          return await trx.selectFrom('schools').select(['school_id', 'district_id']).execute();
        },
      );
      expect(initialSchools.length).toBeGreaterThan(0);

      // 2. Directly expire the territory assignment in PostgreSQL (simulating territory revocation)
      await db
        .updateTable('user_territory_assignments')
        .set({ valid_to: new Date('2026-01-01T00:00:00Z') })
        .where('user_id', '=', seeded.erodeCoordinatorUserId)
        .where('district_id', '=', seeded.districtId)
        .execute();

      try {
        // 3. Immediately query again under the exact same identity/token context:
        // Because RLS dynamically evaluates user_territory_assignments at SQL execution time,
        // access is instantaneously cut off (0 rows), with ZERO token-expiration delay.
        const revokedSchools = await rlsService.withSecurityContext(
          { userId: seeded.erodeCoordinatorUserId, role: 'DISTRICT_COORDINATOR' },
          async (trx) => {
            return await trx.selectFrom('schools').select(['school_id', 'district_id']).execute();
          },
        );
        expect(revokedSchools.length).toBe(0);
      } finally {
        // 4. Restore valid_to to keep test state consistent
        await db
          .updateTable('user_territory_assignments')
          .set({ valid_to: null })
          .where('user_id', '=', seeded.erodeCoordinatorUserId)
          .where('district_id', '=', seeded.districtId)
          .execute();
      }
    });
  });

  // =========================================================================
  // 8. Security & Threat Mitigation Auditing
  // =========================================================================
  describe('8. Zero-Leakage & Security Posture Verification', () => {
    it('verifies all passwords in users table are Scrypt hashed and not plaintext', async () => {
      const users = await db.selectFrom('users').select(['username', 'password_hash']).execute();

      expect(users.length).toBeGreaterThan(0);
      for (const user of users) {
        expect(user.password_hash).toBeDefined();
        expect(user.password_hash).not.toBe(SYNTHETIC_TEST_PASSWORD);
        expect(String(user.password_hash)).toMatch(/^scrypt\$N=16384,r=8,p=1\$/);
      }
    });

    it('verifies all tokens in refresh_tokens table are SHA-256 hashed and not plaintext', async () => {
      const tokens = await db.selectFrom('refresh_tokens').select(['token_hash']).execute();

      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(token.token_hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('verifies audit_events entries contain no plaintext passwords or secrets', async () => {
      const auditEvents = await db
        .selectFrom('audit_events')
        .select(['post_mutation_state'])
        .execute();

      for (const event of auditEvents) {
        const stateStr = JSON.stringify(event.post_mutation_state || {});
        expect(stateStr).not.toContain(SYNTHETIC_TEST_PASSWORD);
        expect(stateStr).not.toContain('password_hash');
      }
    });
  });
});

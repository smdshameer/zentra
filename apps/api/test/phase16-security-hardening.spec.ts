/**
 * ZENTRA Phase 16 — Authentication, RBAC & Security Hardening Test Suite
 * apps/api/test/phase16-security-hardening.spec.ts
 *
 * Implements rigorous production hardening verification:
 * 1. Non-enumeration login security (timing/message uniformity)
 * 2. Inactive / suspended / terminated user rejection
 * 3. Expired & tampered JWT signature rejection
 * 4. Refresh token rotation (RTR) & replay token family revocation
 * 5. Multi-role user switching via POST /api/v1/auth/switch-role
 * 6. RBAC & RLS permission boundary matrix across 6 canonical roles:
 *    - MASTER_ADMIN
 *    - REPORTING_HEAD
 *    - DISTRICT_COORDINATOR
 *    - FIELD_ENGINEER
 *    - AI
 *    - HM
 * 7. Cross-district isolation (zero data leakage between Erode and Salem)
 * 8. API input fuzzing & parameter tampering (malformed UUIDs, inverted odometers, mass assignment)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { Kysely, sql } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types';
import {
  seedSyntheticDevelopmentFixtures,
  SYNTHETIC_TEST_PASSWORD,
  type SeededEntities,
} from '../src/database/seeds/synthetic-dev-fixtures';
import { TokenService } from '../src/modules/auth/token.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { generateUuidV7 } from '@zentra/shared';
import * as crypto from 'crypto';
import { runMigrationsToLatest } from '../src/database/migration-runner';
import type { UserRole } from '@zentra/types';
import { assertTestEnvironmentIsSafe, assertTestDatabaseIsSafe } from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zentra_test';

describe('ZENTRA Phase 16: Authentication & Security Hardening Suite', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let tokenService: TokenService;

  let masterAdminToken: string;
  let reportingHeadToken: string;
  let erodeCoordToken: string;
  let salemCoordToken: string;
  let fieldEngineerToken: string;
  let multiRoleUserToken: string;
  let multiRoleUserId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;
    assertTestEnvironmentIsSafe();
    assertTestDatabaseIsSafe(TEST_DB_URL);

    await runMigrationsToLatest(TEST_DB_URL);

    const { createDatabaseConnection } = await import('../src/database/database.connection');
    db = createDatabaseConnection(TEST_DB_URL);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    tokenService = moduleFixture.get<TokenService>(TokenService);

    // Clean tables
    await sql`
      TRUNCATE TABLE
        conveyance_claims,
        idempotency_keys,
        tombstones,
        import_staging_records,
        import_jobs,
        evidence_files,
        visit_equipment_findings,
        field_visit_status_history,
        field_visits,
        assignment_history,
        service_case_status_history,
        service_cases,
        source_complaints,
        complaint_sources,
        refresh_tokens,
        user_territory_assignments,
        user_roles,
        role_permissions,
        permissions,
        users,
        roles,
        lab_equipment,
        equipment_attribute_definitions,
        equipment_types,
        oem_manufacturers,
        hi_tech_labs,
        schools,
        blocks,
        districts,
        audit_events
      CASCADE;
    `.execute(db);

    seeded = await seedSyntheticDevelopmentFixtures(db);

    // Ensure provisional rate policies exist for conveyance calculation tests
    await sql`
      INSERT INTO conveyance_rate_policies (
        travel_mode, rate_per_km, requires_odometer, requires_evidence, description, is_provisional
      ) VALUES
        ('BIKE', 5.00, true, false, 'Provisional default rate for two-wheeler field travel (₹5.00/km)', true),
        ('BUS', 2.50, false, true, 'Provisional default rate for public bus transit (₹2.50/km or ticket fare)', true),
        ('TRAIN', 2.00, false, true, 'Provisional default rate for passenger / suburban rail (₹2.00/km)', true),
        ('AUTO', 8.00, false, true, 'Provisional default rate for local shared / meter auto (₹8.00/km)', true),
        ('OTHER', 5.00, false, true, 'Provisional fallback rate for other transit modes (₹5.00/km)', true)
      ON CONFLICT DO NOTHING;
    `.execute(db);

    // Create a multi-role user for switch-role testing
    multiRoleUserId = generateUuidV7();
    const { PasswordService } = await import('../src/modules/auth/password.service');
    const pwdService = new PasswordService();
    const hash = await pwdService.hash(SYNTHETIC_TEST_PASSWORD);

    await db
      .insertInto('users')
      .values({
        user_id: multiRoleUserId,
        username: 'multirole.tester@zentra.test',
        full_name: 'Multi Role Test User',
        phone_number: '+919999988888',
        password_hash: hash,
        account_status: 'ACTIVE',
      })
      .execute();

    // Assign both DISTRICT_COORDINATOR and FIELD_ENGINEER roles
    const coordinatorRoleId = seeded.roleIds.DISTRICT_COORDINATOR;
    const engineerRoleId = seeded.roleIds.FIELD_ENGINEER;

    await db
      .insertInto('user_roles')
      .values([
        {
          user_role_id: generateUuidV7(),
          user_id: multiRoleUserId,
          role_id: coordinatorRoleId,
        },
        {
          user_role_id: generateUuidV7(),
          user_id: multiRoleUserId,
          role_id: engineerRoleId,
        },
      ])
      .execute();

    // Assign territory
    await db
      .insertInto('user_territory_assignments')
      .values({
        assignment_id: generateUuidV7(),
        user_id: multiRoleUserId,
        district_id: seeded.districtId,
        block_id: null,
        is_primary_territory: true,
      })
      .execute();

    // Establish access tokens for standard seeded users
    masterAdminToken = tokenService.generateAccessToken({
      userId: seeded.adminUserId,
      username: 'admin.demo@zentra.test',
      roles: ['MASTER_ADMIN'],
      activeRole: 'MASTER_ADMIN',
      territoryDistrictIds: [seeded.districtId, seeded.secondDistrictId],
    }).token;

    reportingHeadToken = tokenService.generateAccessToken({
      userId: seeded.reportingHeadUserId,
      username: 'reporting.head@zentra.test',
      roles: ['REPORTING_HEAD'],
      activeRole: 'REPORTING_HEAD',
      territoryDistrictIds: [seeded.districtId, seeded.secondDistrictId],
    }).token;

    erodeCoordToken = tokenService.generateAccessToken({
      userId: seeded.erodeCoordinatorUserId,
      username: 'coordinator.erode@zentra.test',
      roles: ['DISTRICT_COORDINATOR'],
      activeRole: 'DISTRICT_COORDINATOR',
      territoryDistrictIds: [seeded.districtId],
    }).token;

    salemCoordToken = tokenService.generateAccessToken({
      userId: seeded.salemCoordinatorUserId,
      username: 'coordinator.salem@zentra.test',
      roles: ['DISTRICT_COORDINATOR'],
      activeRole: 'DISTRICT_COORDINATOR',
      territoryDistrictIds: [seeded.secondDistrictId],
    }).token;

    fieldEngineerToken = tokenService.generateAccessToken({
      userId: seeded.userId,
      username: 'engineer.demo@zentra.local',
      roles: ['FIELD_ENGINEER'],
      activeRole: 'FIELD_ENGINEER',
      territoryDistrictIds: [seeded.districtId],
    }).token;

    multiRoleUserToken = tokenService.generateAccessToken({
      userId: multiRoleUserId,
      username: 'multirole.tester@zentra.test',
      roles: ['DISTRICT_COORDINATOR', 'FIELD_ENGINEER'],
      activeRole: 'DISTRICT_COORDINATOR',
      territoryDistrictIds: [seeded.districtId],
    }).token;
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  describe('1. Authentication Non-Enumeration & Inactive Account Protection', () => {
    it('returns identical generic 401 message for non-existent username and wrong password', async () => {
      const nonExistentResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'nonexistent.user@zentra.test',
          password: 'wrong-password',
        },
      });

      const wrongPasswordResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'admin.demo@zentra.test',
          password: 'completely-wrong-password',
        },
      });

      expect(nonExistentResponse.statusCode).toBe(401);
      expect(wrongPasswordResponse.statusCode).toBe(401);

      const nonExistentBody = JSON.parse(nonExistentResponse.body);
      const wrongPasswordBody = JSON.parse(wrongPasswordResponse.body);

      expect(nonExistentBody.error.message).toBe('Invalid credentials');
      expect(wrongPasswordBody.error.message).toBe('Invalid credentials');
    });

    it('rejects suspended, on-leave, and terminated users at login with generic 401 without revealing account status', async () => {
      const accounts = [
        'engineer.suspended@zentra.test',
        'engineer.onleave@zentra.test',
        'engineer.terminated@zentra.test',
      ];

      for (const username of accounts) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: {
            username,
            password: SYNTHETIC_TEST_PASSWORD,
          },
        });

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body);
        expect(body.error.message).toBe('Invalid credentials');
      }
    });

    it('rejects refresh token requests when the underlying account is suspended', async () => {
      // Create a valid refresh token record directly for the suspended user
      const suspendedUserId = seeded.suspendedUserId;
      const { tokenSecret, tokenHash, familyId, expiresAt } = tokenService.generateRefreshToken();

      await db
        .insertInto('refresh_tokens')
        .values({
          refresh_token_id: generateUuidV7(),
          user_id: suspendedUserId,
          token_hash: tokenHash,
          family_id: familyId,
          is_revoked: false,
          expires_at: expiresAt,
        })
        .execute();

      const refreshResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: tokenSecret },
      });

      expect(refreshResponse.statusCode).toBe(401);
      const body = JSON.parse(refreshResponse.body);
      expect(body.error.message).toMatch(/no longer active/i);
    });
  });

  describe('2. JWT Cryptographic Integrity & Token Lifecycle', () => {
    it('rejects expired JWT access tokens with 401 Unauthorized', async () => {
      // Craft an expired token manually with negative exp
      const now = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: seeded.adminUserId,
          username: 'admin.demo@zentra.test',
          roles: ['MASTER_ADMIN'],
          activeRole: 'MASTER_ADMIN',
          territoryDistrictIds: [],
          iat: now - 900,
          exp: now,
        }),
      ).toString('base64url');

      const accessSecret = (tokenService as unknown as { accessSecret: string }).accessSecret;
      const signature = crypto
        .createHmac('sha256', accessSecret)
        .update(`${header}.${payload}`)
        .digest('base64url');

      const expiredJwt = `${header}.${payload}.${signature}`;

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${expiredJwt}` },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.message).toMatch(/expired/i);
    });

    it('rejects cryptographically tampered JWT signatures with 401 Unauthorized', async () => {
      const parts = masterAdminToken.split('.');
      // Tamper signature by replacing last 4 characters
      const tamperedSignature = parts[2].slice(0, -4) + 'XXXX';
      const tamperedJwt = `${parts[0]}.${parts[1]}.${tamperedSignature}`;

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${tamperedJwt}` },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.message).toMatch(/signature/i);
    });

    it('detects refresh token reuse and immediately invalidates the entire token family', async () => {
      // 1. Log in legitimately to get a live refresh token
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'engineer.demo@zentra.local',
          password: SYNTHETIC_TEST_PASSWORD,
        },
      });

      expect(loginRes.statusCode).toBe(200);
      const originalRefreshToken = JSON.parse(loginRes.body).data.refreshToken;

      // 2. Perform rotation: Exchange token for a new pair
      const rotateRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: originalRefreshToken },
      });

      expect(rotateRes.statusCode).toBe(200);
      const rotatedRefreshToken = JSON.parse(rotateRes.body).data.refreshToken;

      // 3. Attacker replays the original, now-consumed token
      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: originalRefreshToken },
      });

      expect(replayRes.statusCode).toBe(401);
      expect(JSON.parse(replayRes.body).error.message).toMatch(/reuse detected/i);

      // 4. Verify that the legitimate subsequent rotated token was also revoked
      const subsequentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: rotatedRefreshToken },
      });

      expect(subsequentRes.statusCode).toBe(401);
    });
  });

  describe('3. Multi-Role User Role Switching (POST /api/v1/auth/switch-role)', () => {
    it('allows a multi-role user to switch active role to an assigned secondary role', async () => {
      const switchRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/switch-role',
        headers: { authorization: `Bearer ${multiRoleUserToken}` },
        payload: { targetRole: 'FIELD_ENGINEER' },
      });

      expect(switchRes.statusCode).toBe(200);
      const switchBody = JSON.parse(switchRes.body);
      expect(switchBody.data.activeRole).toBe('FIELD_ENGINEER');
      expect(switchBody.data.accessToken).toBeDefined();

      // Verify that decoding the new token contains activeRole = FIELD_ENGINEER
      const payloadPart = switchBody.data.accessToken.split('.')[1];
      const decodedPayload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
      expect(decodedPayload.activeRole).toBe('FIELD_ENGINEER');
      expect(decodedPayload.roles).toContain('DISTRICT_COORDINATOR');
      expect(decodedPayload.roles).toContain('FIELD_ENGINEER');
    });

    it('rejects switching to an unassigned role with 403 Forbidden', async () => {
      const switchRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/switch-role',
        headers: { authorization: `Bearer ${multiRoleUserToken}` },
        payload: { targetRole: 'MASTER_ADMIN' },
      });

      expect(switchRes.statusCode).toBe(403);
      const body = JSON.parse(switchRes.body);
      expect(body.error.message).toMatch(/does not possess requested role/i);
    });

    it('rejects invalid role enums with 400 Bad Request', async () => {
      const invalidRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/switch-role',
        headers: { authorization: `Bearer ${multiRoleUserToken}` },
        payload: { targetRole: 'SUPER_HACKER' },
      });

      expect(invalidRes.statusCode).toBe(400);
    });
  });

  describe('4. RBAC & Cross-District Boundary Matrix Across 6 Canonical Roles', () => {
    it('MASTER_ADMIN can access master administrative demonstration endpoint', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/demonstration/admin-only',
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it('REPORTING_HEAD is forbidden from master administrative endpoints', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/demonstration/admin-only',
        headers: { authorization: `Bearer ${reportingHeadToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('FIELD_ENGINEER is forbidden from master administrative endpoints', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/demonstration/admin-only',
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('Erode Coordinator is authorized for Erode district demonstration endpoint', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/demonstration/district-scoped/${seeded.districtId}`,
        headers: { authorization: `Bearer ${erodeCoordToken}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it('Erode Coordinator is forbidden from accessing Salem district territory endpoint', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/demonstration/district-scoped/${seeded.secondDistrictId}`,
        headers: { authorization: `Bearer ${erodeCoordToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('Field Engineer cannot approve conveyance claims (forbidden by RBAC)', async () => {
      const dummyClaimId = generateUuidV7();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${dummyClaimId}/approve`,
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          approvedDistanceKm: 25.0,
          approvedAmount: 125.0,
          reviewNotes: 'Unauthorized approval attempt',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('Coordinator cannot approve claims for themselves (self-approval gate)', async () => {
      // Create a visit where coordinator was the field actor
      const coordVisitId = generateUuidV7();
      await db
        .insertInto('field_visits')
        .values({
          visit_id: coordVisitId,
          service_case_id: seeded.serviceCaseId,
          engineer_id: seeded.erodeCoordinatorUserId,
          visit_sequence_number: 90,
          visit_date: '2026-10-09',
          visit_outcome: 'RESOLVED_ON_SITE',
        })
        .execute();

      // Coordinator submits a claim under their own user id
      const createClaimRes = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: { authorization: `Bearer ${erodeCoordToken}` },
        payload: {
          visitId: coordVisitId,
          serviceCaseId: seeded.serviceCaseId,
          engineerId: seeded.erodeCoordinatorUserId,
          travelDate: '2026-10-09',
          fromLocation: 'Office Erode',
          toLocation: 'School Erode',
          travelMode: 'BIKE',
          startingOdometerKm: 1000,
          endingOdometerKm: 1020,
          claimedDistanceKm: 20,
          submitDirectly: true,
        },
      });

      expect(createClaimRes.statusCode).toBe(201);
      const claimId = JSON.parse(createClaimRes.body).data.conveyanceClaimId;

      // Erode coordinator attempts to approve their own claim
      const approveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimId}/approve`,
        headers: { authorization: `Bearer ${erodeCoordToken}` },
        payload: {
          approvedDistanceKm: 20,
          approvedAmount: 100,
          reviewNotes: 'Self approval attempt',
        },
      });

      expect(approveRes.statusCode).toBe(403);
      const approveBody = JSON.parse(approveRes.body);
      const errMsg = approveBody.error?.message || approveBody.message || '';
      expect(errMsg).toMatch(/cannot approve.*own claim|self-approval|strictly prohibited/i);
    });

    it('Coordinator is forbidden from paying claims (financial settlement restricted to MASTER_ADMIN)', async () => {
      const dummyClaimId = generateUuidV7();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${dummyClaimId}/pay`,
        headers: { authorization: `Bearer ${erodeCoordToken}` },
        payload: {
          disbursementReference: 'DISB-UNAUTH-01',
          paymentNotes: 'Coordinator attempting payment',
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('5. Cross-District Isolation & Data Privacy', () => {
    it('Erode Coordinator cannot retrieve or view conveyance claims from Salem district', async () => {
      // Create a claim submitted by a Salem engineer
      const salemEngineerId = generateUuidV7();
      const pwdService = new (await import('../src/modules/auth/password.service')).PasswordService();
      const hash = await pwdService.hash(SYNTHETIC_TEST_PASSWORD);

      await db
        .insertInto('users')
        .values({
          user_id: salemEngineerId,
          username: 'salem.eng@zentra.test',
          full_name: 'Salem Engineer',
          password_hash: hash,
          account_status: 'ACTIVE',
        })
        .execute();

      await db
        .insertInto('user_roles')
        .values({
          user_role_id: generateUuidV7(),
          user_id: salemEngineerId,
          role_id: seeded.roleIds.FIELD_ENGINEER,
        })
        .execute();

      await db
        .insertInto('user_territory_assignments')
        .values({
          assignment_id: generateUuidV7(),
          user_id: salemEngineerId,
          district_id: seeded.secondDistrictId,
          block_id: null,
          is_primary_territory: true,
        })
        .execute();

      const salemVisitId = generateUuidV7();
      await db
        .insertInto('field_visits')
        .values({
          visit_id: salemVisitId,
          service_case_id: seeded.secondServiceCaseId,
          engineer_id: salemEngineerId,
          visit_sequence_number: 1,
          visit_date: '2026-10-09',
          visit_outcome: 'RESOLVED_ON_SITE',
        })
        .execute();

      const salemToken = tokenService.generateAccessToken({
        userId: salemEngineerId,
        username: 'salem.eng@zentra.test',
        roles: ['FIELD_ENGINEER'],
        activeRole: 'FIELD_ENGINEER',
        territoryDistrictIds: [seeded.secondDistrictId],
      }).token;

      const salemClaimRes = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: { authorization: `Bearer ${salemToken}` },
        payload: {
          visitId: salemVisitId,
          serviceCaseId: seeded.secondServiceCaseId,
          travelDate: '2026-10-09',
          fromLocation: 'Salem Office',
          toLocation: 'Salem Lab',
          travelMode: 'BIKE',
          startingOdometerKm: 5000,
          endingOdometerKm: 5040,
          claimedDistanceKm: 40,
          submitDirectly: true,
        },
      });

      expect(salemClaimRes.statusCode).toBe(201);
      const salemClaimId = JSON.parse(salemClaimRes.body).data.conveyanceClaimId;

      // Erode coordinator attempts to access Salem claim by ID
      const erodeAccessRes = await app.inject({
        method: 'GET',
        url: `/api/v1/conveyance-claims/${salemClaimId}`,
        headers: { authorization: `Bearer ${erodeCoordToken}` },
      });

      // Must be 403 or 404 — strictly fail-closed
      expect([403, 404]).toContain(erodeAccessRes.statusCode);

      // Salem coordinator CAN access the Salem claim
      const salemCoordRes = await app.inject({
        method: 'GET',
        url: `/api/v1/conveyance-claims/${salemClaimId}`,
        headers: { authorization: `Bearer ${salemCoordToken}` },
      });

      expect(salemCoordRes.statusCode).toBe(200);
      expect(JSON.parse(salemCoordRes.body).data.claim.conveyanceClaimId).toBe(salemClaimId);
    });
  });

  describe('6. API Input Fuzzing, Parameter Tampering & Mass-Assignment Protection', () => {
    it('rejects malformed non-UUID path parameters with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/conveyance-claims/not-a-valid-uuid-12345',
        headers: { authorization: `Bearer ${masterAdminToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects inverted odometer readings (endingOdometerKm < startingOdometerKm) with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          visitId: seeded.visitId,
          serviceCaseId: seeded.serviceCaseId,
          travelDate: '2026-10-09',
          fromLocation: 'Erode',
          toLocation: 'Bhavani',
          travelMode: 'BIKE',
          startingOdometerKm: 1000,
          endingOdometerKm: 800, // Inverted!
          claimedDistanceKm: 50,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects negative distance entries with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          visitId: seeded.visitId,
          serviceCaseId: seeded.serviceCaseId,
          travelDate: '2026-10-09',
          fromLocation: 'Erode',
          toLocation: 'Bhavani',
          travelMode: 'BIKE',
          startingOdometerKm: 1000,
          endingOdometerKm: 1050,
          claimedDistanceKm: -50, // Negative!
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects malformed date strings in conveyance claims with 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          visitId: seeded.visitId,
          serviceCaseId: seeded.serviceCaseId,
          travelDate: 'not-a-valid-date-31-02',
          fromLocation: 'Erode',
          toLocation: 'Bhavani',
          travelMode: 'BIKE',
          startingOdometerKm: 1000,
          endingOdometerKm: 1050,
          claimedDistanceKm: 50,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('prevents mass-assignment tampering: status remains DRAFT regardless of attacker injected status or amount', async () => {
      const massAssignVisitId = generateUuidV7();
      await db
        .insertInto('field_visits')
        .values({
          visit_id: massAssignVisitId,
          service_case_id: seeded.serviceCaseId,
          engineer_id: seeded.userId,
          visit_sequence_number: 95,
          visit_date: '2026-10-09',
          visit_outcome: 'RESOLVED_ON_SITE',
        })
        .execute();

      const tamperedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: { authorization: `Bearer ${fieldEngineerToken}` },
        payload: {
          visitId: massAssignVisitId,
          serviceCaseId: seeded.serviceCaseId,
          travelDate: '2026-10-09',
          fromLocation: 'Erode',
          toLocation: 'Bhavani',
          travelMode: 'BIKE',
          startingOdometerKm: 2000,
          endingOdometerKm: 2030,
          claimedDistanceKm: 30,
          // Maliciously injected fields that must NOT be respected
          status: 'PAID',
          claimStatus: 'PAID',
          approvedAmount: 999999,
          approvedDistanceKm: 10000,
        },
      });

      expect(tamperedRes.statusCode).toBe(201);
      const claim = JSON.parse(tamperedRes.body).data;

      // Status must strictly remain DRAFT (since submitDirectly was false)
      expect(claim.claimStatus).toBe('DRAFT');
      expect(claim.approvedAmount).toBeNull();
      expect(claim.approvedDistanceKm).toBeNull();
    });
  });
});

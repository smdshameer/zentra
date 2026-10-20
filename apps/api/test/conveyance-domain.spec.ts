/**
 * ZENTRA — Phase 15 Conveyance Claims & Management Web Portal Test Suite
 * apps/api/test/conveyance-domain.spec.ts
 *
 * Verifies end-to-end conveyance lifecycle, calculation transparency,
 * configurable rate policies, odometer validation, duplicate prevention,
 * self-approval prohibition, multi-hop territory isolation, summary aggregates,
 * audit logging, and Phase 12 sync engine integration.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { DATABASE_CONNECTION } from '../src/database/database.connection';
import type { DatabaseSchema } from '../src/database/database.types';
import { Kysely, sql } from 'kysely';
import {
  seedSyntheticDevelopmentFixtures,
  type SeededEntities,
} from '../src/database/seeds/synthetic-dev-fixtures';
import { TokenService } from '../src/modules/auth/token.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { generateUuidV7 } from '@zentra/shared';
import { runMigrationsToLatest } from '../src/database/migration-runner';
import { ConveyancePolicyService } from '../src/modules/conveyance/services/conveyance-policy.service';
import { assertTestEnvironmentIsSafe, assertTestDatabaseIsSafe } from '@zentra/testing';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zentra_test';

function getErrorMessage(body: any): string {
  const details = body.error?.details?.map((d: any) => d.message).join(' ') || '';
  return `${body.error?.message || ''} ${details} ${body.message || ''} ${JSON.stringify(body)}`;
}

describe('ZENTRA Phase 15 — Conveyance Claims & Management Portal Domain Suite', () => {
  let app: NestFastifyApplication;
  let db: Kysely<DatabaseSchema>;
  let seeded: SeededEntities;
  let tokenService: TokenService;

  let masterAdminToken: string;
  let districtCoordToken: string;
  let primaryEngineerToken: string;
  let otherEngineerToken: string;

  let primaryEngineerId: string;
  let otherEngineerId: string;
  let testVisitIdA: string;
  let testVisitIdB: string;
  let testVisitIdC: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_URL = TEST_DB_URL;
    assertTestEnvironmentIsSafe();
    assertTestDatabaseIsSafe(TEST_DB_URL);

    // Run migrations to ensure latest schema
    await runMigrationsToLatest(TEST_DB_URL);

    const { createDatabaseConnection } = await import('../src/database/database.connection');
    db = createDatabaseConnection(TEST_DB_URL);

    // Clean tables for reproducible test runs
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

    // Seed synthetic fixtures
    seeded = await seedSyntheticDevelopmentFixtures(db);

    // Ensure provisional rate policies exist
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

    // Clean pre-seeded visits so test cases start with deterministic sequence 1
    await db.deleteFrom('field_visit_status_history').execute();
    await db.deleteFrom('field_visits').execute();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    tokenService = moduleFixture.get<TokenService>(TokenService);

    primaryEngineerId = seeded.userId;

    // Create a secondary engineer in District B (Salem)
    otherEngineerId = generateUuidV7();
    await db
      .insertInto('users')
      .values({
        user_id: otherEngineerId,
        username: 'other_fe_salem@zentra.test',
        password_hash: '$2b$10$synthetic_dev_hash_only',
        full_name: 'Other Engineer Salem',
        phone_number: '9840099999',
        account_status: 'ACTIVE',
        is_active: true,
      })
      .execute();

    await db
      .insertInto('user_roles')
      .values({
        user_role_id: generateUuidV7(),
        user_id: otherEngineerId,
        role_id: seeded.roleIds.FIELD_ENGINEER,
      })
      .execute();

    await db
      .insertInto('user_territory_assignments')
      .values({
        assignment_id: generateUuidV7(),
        user_id: otherEngineerId,
        district_id: seeded.secondDistrictId,
        is_primary_territory: true,
      })
      .execute();

    // Mint test tokens
    masterAdminToken = tokenService.generateAccessToken({
      userId: seeded.adminUserId,
      username: 'admin.demo@zentra.test',
      roles: ['MASTER_ADMIN'],
      activeRole: 'MASTER_ADMIN',
      territoryDistrictIds: [seeded.districtId, seeded.secondDistrictId],
    }).token;

    districtCoordToken = tokenService.generateAccessToken({
      userId: seeded.erodeCoordinatorUserId,
      username: 'coordinator.erode@zentra.test',
      roles: ['DISTRICT_COORDINATOR'],
      activeRole: 'DISTRICT_COORDINATOR',
      territoryDistrictIds: [seeded.districtId],
    }).token;

    primaryEngineerToken = tokenService.generateAccessToken({
      userId: primaryEngineerId,
      username: 'engineer.erode@zentra.test',
      roles: ['FIELD_ENGINEER'],
      activeRole: 'FIELD_ENGINEER',
      territoryDistrictIds: [seeded.districtId],
    }).token;

    otherEngineerToken = tokenService.generateAccessToken({
      userId: otherEngineerId,
      username: 'other_fe_salem@zentra.test',
      roles: ['FIELD_ENGINEER'],
      activeRole: 'FIELD_ENGINEER',
      territoryDistrictIds: [seeded.secondDistrictId],
    }).token;

    // Seed test visits for primary engineer in District A
    testVisitIdA = generateUuidV7();
    await db
      .insertInto('field_visits')
      .values({
        visit_id: testVisitIdA,
        service_case_id: seeded.serviceCaseId,
        engineer_id: primaryEngineerId,
        visit_sequence_number: 1,
        status: 'COMPLETED',
        visit_date: '2026-10-08',
        check_in_timestamp: new Date('2026-10-08T09:30:00Z'),
        check_out_timestamp: new Date('2026-10-08T11:45:00Z'),
        visit_outcome: 'RESOLVED_ON_SITE',
        version: 1,
      })
      .execute();

    testVisitIdB = generateUuidV7();
    await db
      .insertInto('field_visits')
      .values({
        visit_id: testVisitIdB,
        service_case_id: seeded.serviceCaseId,
        engineer_id: primaryEngineerId,
        visit_sequence_number: 2,
        status: 'COMPLETED',
        visit_date: '2026-10-08',
        check_in_timestamp: new Date('2026-10-08T13:00:00Z'),
        check_out_timestamp: new Date('2026-10-08T15:30:00Z'),
        visit_outcome: 'RESOLVED_ON_SITE',
        version: 1,
      })
      .execute();

    // Configure visit in District B for other engineer using seeded.secondServiceCaseId
    await db
      .updateTable('service_cases')
      .set({
        assigned_primary_engineer_id: otherEngineerId,
        operational_status: 'ASSIGNED',
        version: 1,
      })
      .where('service_case_id', '=', seeded.secondServiceCaseId)
      .execute();

    testVisitIdC = generateUuidV7();
    await db
      .insertInto('field_visits')
      .values({
        visit_id: testVisitIdC,
        service_case_id: seeded.secondServiceCaseId,
        engineer_id: otherEngineerId,
        visit_sequence_number: 1,
        status: 'COMPLETED',
        visit_date: '2026-10-08',
        check_in_timestamp: new Date('2026-10-08T10:00:00Z'),
        check_out_timestamp: new Date('2026-10-08T12:00:00Z'),
        visit_outcome: 'RESOLVED_ON_SITE',
        version: 1,
      })
      .execute();
  });

  afterAll(async () => {
    if (db) {
      await db.deleteFrom('conveyance_claims').execute();
      await db.destroy();
    }
    if (app) await app.close();
  });

  describe('1. Configurable Rate Policies & Calculation Transparency', () => {
    it('returns configurable rate policies with explicit provisional disclosure', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/conveyance-claims/policies',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);

      const bikePolicy = json.data.find((p: any) => p.travel_mode === 'BIKE');
      expect(bikePolicy).toBeDefined();
      expect(bikePolicy.description).toContain('Provisional default rate');
      expect(bikePolicy.is_provisional).toBe(true);
      expect(Number(bikePolicy.rate_per_km)).toBe(5.0);
    });
  });

  describe('2. Claim Creation, Odometer Validation & Duplicate Prevention', () => {
    it('creates a DRAFT claim with exact reimbursement calculation (distance * rate)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: testVisitIdA,
          serviceCaseId: seeded.serviceCaseId,
          travelDate: '2026-10-08',
          fromLocation: 'District Office Erode',
          toLocation: 'Erode Model GHSS',
          travelMode: 'BIKE',
          startingOdometerKm: 12500,
          endingOdometerKm: 12520,
          claimedDistanceKm: 20,
          remarks: 'Standard visit conveyance',
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.claimStatus).toBe('DRAFT');
      expect(Number(json.data.claimedDistanceKm)).toBe(20);
      expect(Number(json.data.appliedRatePerKm)).toBe(5.0);
      expect(Number(json.data.calculatedAmount)).toBe(100.0);

      // Verify calculation explanation from GET detail endpoint
      const detailRes = await app.inject({
        method: 'GET',
        url: `/api/v1/conveyance-claims/${json.data.conveyanceClaimId}`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });
      expect(detailRes.statusCode).toBe(200);
      const detailJson = JSON.parse(detailRes.payload);
      expect(detailJson.data.calculation.explanation).toContain('20 km × ₹5/km = ₹100');
    });

    it('rejects claim when ending odometer is strictly less than starting odometer', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: testVisitIdB,
          serviceCaseId: seeded.serviceCaseId,
          travelDate: '2026-10-08',
          fromLocation: 'District Office',
          toLocation: 'School Site',
          travelMode: 'BIKE',
          startingOdometerKm: 45000,
          endingOdometerKm: 44980, // Invalid!
          claimedDistanceKm: 20,
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(getErrorMessage(json)).toContain('Ending odometer reading must be greater than or equal to starting reading');
    });

    it('rejects duplicate active claim for the same field visit', async () => {
      // testVisitIdA already has a DRAFT claim
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: testVisitIdA,
          serviceCaseId: seeded.serviceCaseId,
          travelDate: '2026-10-08',
          fromLocation: 'Office',
          toLocation: 'School',
          travelMode: 'BUS',
          claimedDistanceKm: 15,
          remarks: 'Attempted duplicate claim',
        },
      });

      expect(res.statusCode).toBe(409);
      const json = JSON.parse(res.payload);
      expect(getErrorMessage(json)).toContain('DUPLICATE_CLAIM');
    });
  });

  describe('3. State Machine Lifecycle & Self-Approval Prohibition', () => {
    let claimIdA: string;

    beforeAll(async () => {
      const claim = await db
        .selectFrom('conveyance_claims')
        .select('conveyance_claim_id')
        .where('visit_id', '=', testVisitIdA)
        .executeTakeFirstOrThrow();
      claimIdA = claim.conveyance_claim_id;
    });

    it('allows field engineer to submit their DRAFT claim -> SUBMITTED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimIdA}/submit`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      expect(json.data.claimStatus).toBe('SUBMITTED');
      expect(json.data.submittedAt).toBeDefined();
    });

    it('prohibits field engineer from approving their own claim (SELF_APPROVAL_PROHIBITED)', async () => {
      // 1. Field Engineer token is rejected by RolesGuard (403)
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimIdA}/approve`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          approvalNotes: 'Self approval attempt',
        },
      });

      expect(res.statusCode).toBe(403);
      const json = JSON.parse(res.payload);
      expect(
        getErrorMessage(json).includes('Forbidden resource') ||
        getErrorMessage(json).includes('SELF_APPROVAL_PROHIBITED'),
      ).toBe(true);

      // 2. Also verify service-level self-approval check when coordinator attempts to approve own claim
      await db
        .updateTable('conveyance_claims')
        .set({ engineer_id: seeded.erodeCoordinatorUserId })
        .where('conveyance_claim_id', '=', claimIdA)
        .execute();

      const coordSelfRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimIdA}/approve`,
        headers: {
          authorization: `Bearer ${districtCoordToken}`,
        },
        payload: {
          approvalNotes: 'Self approval attempt by coordinator',
        },
      });

      expect(coordSelfRes.statusCode).toBe(403);
      const coordJson = JSON.parse(coordSelfRes.payload);
      expect(getErrorMessage(coordJson)).toContain('SELF_APPROVAL_PROHIBITED');

      // Restore original engineerId
      await db
        .updateTable('conveyance_claims')
        .set({ engineer_id: primaryEngineerId })
        .where('conveyance_claim_id', '=', claimIdA)
        .execute();
    });

    it('allows supervisor (District Coordinator) to place claim UNDER_REVIEW', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimIdA}/review`,
        headers: {
          authorization: `Bearer ${districtCoordToken}`,
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      expect(json.data.claimStatus).toBe('UNDER_REVIEW');
    });

    it('allows supervisor to return claim for correction with notes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimIdA}/return`,
        headers: {
          authorization: `Bearer ${districtCoordToken}`,
        },
        payload: {
          correctionNotes: 'Please verify the starting odometer against daily log',
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      expect(json.data.claimStatus).toBe('RETURNED_FOR_CORRECTION');
      expect(json.data.correctionNotes).toBe('Please verify the starting odometer against daily log');
    });

    it('allows field engineer to re-submit corrected claim -> SUBMITTED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimIdA}/submit`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      expect(json.data.claimStatus).toBe('SUBMITTED');
    });

    it('allows supervisor to approve claim with custom approved distance/amount', async () => {
      // First move to UNDER_REVIEW
      await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimIdA}/review`,
        headers: {
          authorization: `Bearer ${districtCoordToken}`,
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimIdA}/approve`,
        headers: {
          authorization: `Bearer ${districtCoordToken}`,
        },
        payload: {
          approvedDistanceKm: 18,
          approvedAmount: 90.0,
          approvalNotes: 'Adjusted to standard route distance',
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      expect(json.data.claimStatus).toBe('APPROVED');
      expect(Number(json.data.approvedDistanceKm)).toBe(18);
      expect(Number(json.data.approvedAmount)).toBe(90.0);
      expect(json.data.reviewedByUserId).toBe(seeded.erodeCoordinatorUserId);
      expect(json.data.reviewedAt).toBeDefined();
    });

    it('locks APPROVED claim against illegal modifications or reverting to DRAFT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimIdA}/submit`,
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(getErrorMessage(json)).toContain('INVALID_STATE_TRANSITION');
    });

    it('allows administrator to mark claim as PAID upon financial disbursement', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimIdA}/pay`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
        payload: {
          paymentReference: 'DISB-2026-OCT-8891',
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      expect(json.data.claimStatus).toBe('PAID');
      expect(json.data.remarks).toContain('DISB-2026-OCT-8891');
    });
  });

  describe('4. Territory Isolation & Role-Based Access Control', () => {
    let claimIdC: string;

    beforeAll(async () => {
      // Create a claim for District B (Salem)
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: {
          authorization: `Bearer ${otherEngineerToken}`,
        },
        payload: {
          visitId: testVisitIdC,
          serviceCaseId: seeded.secondServiceCaseId,
          travelDate: '2026-10-08',
          fromLocation: 'Salem Office',
          toLocation: 'Salem School',
          travelMode: 'BIKE',
          startingOdometerKm: 50100,
          endingOdometerKm: 50145,
          claimedDistanceKm: 45,
          remarks: 'Salem high school visit',
        },
      });
      expect([200, 201]).toContain(res.statusCode);
      claimIdC = JSON.parse(res.payload).data.conveyanceClaimId;
    });

    it('prevents District Coordinator from viewing claims outside their territory', async () => {
      // Erode Coordinator querying claims
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/conveyance-claims',
        headers: {
          authorization: `Bearer ${districtCoordToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      const returnedIds = json.data.map((c: any) => c.conveyanceClaimId);
      // Must not contain District B claim
      expect(returnedIds).not.toContain(claimIdC);
    });

    it('allows Master Admin to view claims across all districts', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/conveyance-claims',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      const returnedIds = json.data.map((c: any) => c.conveyanceClaimId);
      expect(returnedIds).toContain(claimIdC);
    });

    it('prevents District Coordinator from approving a claim in another district', async () => {
      // First submit claim C
      await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimIdC}/submit`,
        headers: {
          authorization: `Bearer ${otherEngineerToken}`,
        },
      });

      // Erode coordinator attempts to approve Salem claim
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${claimIdC}/approve`,
        headers: {
          authorization: `Bearer ${districtCoordToken}`,
        },
        payload: {
          approvalNotes: 'Unauthorized approval attempt across district boundary',
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('5. Audit Trail & Financial Summary Aggregates', () => {
    it('records immutable audit events for claim status transitions', async () => {
      const auditRows = await db
        .selectFrom('audit_events')
        .selectAll()
        .where('target_entity_type', '=', 'conveyance_claims')
        .execute();

      expect(auditRows.length).toBeGreaterThan(0);
      const actions = auditRows.map((r) => r.action_type);
      expect(actions).toContain('CLAIM_SUBMITTED');
      expect(actions).toContain('CLAIM_APPROVED');
      expect(actions).toContain('CLAIM_PAID');
    });

    it('computes aggregated summary stats and district breakdown', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/conveyance-claims/summary',
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.totalClaimsCount).toBeGreaterThanOrEqual(2);
      expect(json.data.totalPaidAmount).toBeGreaterThan(0);
      expect(Array.isArray(json.data.districtWiseBreakdown)).toBe(true);
      expect(json.data.districtWiseBreakdown.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('6. Phase 12 Sync Engine Push & Delta Integration for Conveyance', () => {
    it('processes offline CREATE_CONVEYANCE_CLAIM push mutation', async () => {
      const offlineClaimId = generateUuidV7();
      const clientOpId = generateUuidV7();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          clientBatchId: generateUuidV7(),
          mutations: [
            {
              clientOperationId: clientOpId,
              entityType: 'conveyance_claims',
              entityId: offlineClaimId,
              operationType: 'INSERT',
              clientCreatedAt: new Date().toISOString(),
              payload: {
                visitId: testVisitIdB,
                serviceCaseId: seeded.serviceCaseId,
                travelDate: '2026-10-08',
                fromLocation: 'Base Depot',
                toLocation: 'Erode Secondary School',
                travelMode: 'BIKE',
                startingOdometerKm: 12530,
                endingOdometerKm: 12560,
                claimedDistanceKm: 30,
                remarks: 'Pushed from offline mobile client',
              },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.results).toHaveLength(1);
      expect(json.data.results[0].clientOperationId).toBe(clientOpId);
      expect(json.data.results[0].status).toBe('ACCEPTED');

      // Verify persisted record
      const persisted = await db
        .selectFrom('conveyance_claims')
        .selectAll()
        .where('conveyance_claim_id', '=', offlineClaimId)
        .executeTakeFirst();

      expect(persisted).toBeDefined();
      expect(Number(persisted?.claimed_distance_km)).toBe(30);
      expect(Number(persisted?.calculated_amount)).toBe(150.0); // 30 * 5.0
    });

    it('streams updated conveyance claims in downstream sync delta', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/delta?limit=50',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data.changes)).toBe(true);
      const claimChanges = json.data.changes.filter(
        (c: any) => c.entityType === 'conveyance_claims',
      );
      expect(claimChanges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('7. Condition 1 — Distance & Reimbursement Audit Model', () => {
    let auditVisitId: string;
    let auditClaimId: string;

    beforeAll(async () => {
      auditVisitId = generateUuidV7();
      await db
        .insertInto('field_visits')
        .values({
          visit_id: auditVisitId,
          service_case_id: seeded.serviceCaseId,
          engineer_id: primaryEngineerId,
          visit_sequence_number: 10,
          status: 'COMPLETED',
          visit_date: '2026-10-08',
          check_in_timestamp: new Date('2026-10-08T09:00:00Z'),
          check_out_timestamp: new Date('2026-10-08T11:00:00Z'),
          visit_outcome: 'RESOLVED_ON_SITE',
          version: 1,
        })
        .execute();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: auditVisitId,
          serviceCaseId: seeded.serviceCaseId,
          travelDate: '2026-10-08',
          fromLocation: 'Office Hub',
          toLocation: 'School Site',
          travelMode: 'BIKE',
          startingOdometerKm: 20000,
          endingOdometerKm: 20050,
          claimedDistanceKm: 50,
          capturedDistanceKm: 50,
          submitDirectly: true,
        },
      });
      expect([200, 201]).toContain(res.statusCode);
      auditClaimId = JSON.parse(res.payload).data.conveyanceClaimId;
    });

    it('1. preserves claimed distance when approved distance differs', async () => {
      // Supervisor approves with reduced distance (50 claimed -> 40 approved)
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${auditClaimId}/approve`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
        payload: {
          approvedDistanceKm: 40,
          approvedAmount: 200.0,
          approvalNotes: 'Deducted 10km for personal deviation',
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      expect(json.data.claimedDistanceKm).toBe(50);
      expect(json.data.approvedDistanceKm).toBe(40);
      expect(json.data.capturedDistanceKm).toBe(50);

      // Verify in database row directly
      const row = await db
        .selectFrom('conveyance_claims')
        .selectAll()
        .where('conveyance_claim_id', '=', auditClaimId)
        .executeTakeFirstOrThrow();

      expect(Number(row.claimed_distance_km)).toBe(50);
      expect(Number(row.approved_distance_km)).toBe(40);
      expect(Number(row.captured_distance_km)).toBe(50);
    });

    it('2. preserves calculated/claimed amount when approved amount differs', async () => {
      const row = await db
        .selectFrom('conveyance_claims')
        .selectAll()
        .where('conveyance_claim_id', '=', auditClaimId)
        .executeTakeFirstOrThrow();

      expect(Number(row.calculated_amount)).toBe(250.0);
      expect(Number(row.claimed_amount)).toBe(250.0);
      expect(Number(row.approved_amount)).toBe(200.0);
    });

    it('3. preserves historical rate and policy version on the claim', async () => {
      const row = await db
        .selectFrom('conveyance_claims')
        .selectAll()
        .where('conveyance_claim_id', '=', auditClaimId)
        .executeTakeFirstOrThrow();

      expect(Number(row.applied_rate_per_km)).toBe(5.0);
      expect(row.rate_policy_version).toBe(1);
    });

    it('4. guarantees current policy changes do not silently recalculate historical claims', async () => {
      // Create a new policy with a changed rate (₹8.50/km)
      await db
        .insertInto('conveyance_rate_policies')
        .values({
          policy_id: generateUuidV7(),
          travel_mode: 'BIKE',
          rate_per_km: 8.5,
          is_provisional: false,
          effective_from: new Date(),
          is_active: true,
          version: 2,
          description: 'Updated bike rate policy v2 (₹8.50/km)',
        })
        .execute();

      // Retrieve historical claim via API
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/conveyance-claims/${auditClaimId}`,
        headers: {
          authorization: `Bearer ${masterAdminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      // Historical values must NOT be recalculated to 8.50
      expect(json.data.claim.appliedRatePerKm).toBe(5.0);
      expect(json.data.claim.calculatedAmount).toBe(250.0);
      expect(json.data.claim.claimedAmount).toBe(250.0);
      expect(json.data.claim.approvedAmount).toBe(200.0);
      expect(json.data.claim.ratePolicyVersion).toBe(1);
    });
  });

  describe('8. Condition 2 — Rate Policy Determinism', () => {
    it('gives district-specific policy precedence over broader/default policy', async () => {
      const policyService = app.get(ConveyancePolicyService);

      // Create district-specific policy for District A (₹12.00/km)
      await db
        .insertInto('conveyance_rate_policies')
        .values({
          policy_id: generateUuidV7(),
          district_id: seeded.districtId,
          travel_mode: 'AUTO',
          rate_per_km: 12.0,
          is_provisional: false,
          effective_from: new Date('2026-01-01T00:00:00Z'),
          is_active: true,
          version: 1,
          description: 'District A special auto tariff',
        })
        .execute();

      // Resolve for District A -> selects district-specific tariff ₹12.00
      const resolvedDistA = await policyService.resolveRatePolicy('AUTO', {
        districtId: seeded.districtId,
      });
      expect(resolvedDistA.ratePerKm).toBe(12.0);
      expect(resolvedDistA.districtId).toBe(seeded.districtId);

      // Resolve for District B (no district-specific row) -> falls back to default ₹8.00
      const resolvedDistB = await policyService.resolveRatePolicy('AUTO', {
        districtId: seeded.secondDistrictId,
      });
      expect(resolvedDistB.ratePerKm).toBe(8.0);
      expect(resolvedDistB.districtId).toBeNull();
    });

    it('performs historical policy lookup matching effectiveDate', async () => {
      const policyService = app.get(ConveyancePolicyService);

      // Insert historical policy for TRAIN effective in mid-2025
      await db
        .insertInto('conveyance_rate_policies')
        .values({
          policy_id: generateUuidV7(),
          travel_mode: 'TRAIN',
          rate_per_km: 1.5,
          is_provisional: false,
          effective_from: new Date('2025-01-01T00:00:00Z'),
          effective_to: new Date('2025-12-31T23:59:59Z'),
          is_active: true,
          version: 1,
          description: '2025 train tariff',
        })
        .execute();

      const historical = await policyService.resolveRatePolicy('TRAIN', {
        effectiveDate: '2025-06-15',
      });
      expect(historical.ratePerKm).toBe(1.5);

      const present = await policyService.resolveRatePolicy('TRAIN', {
        effectiveDate: '2026-10-08',
      });
      expect(present.ratePerKm).toBe(2.0); // 2026 default
    });

    it('strictly excludes future policies', async () => {
      const policyService = app.get(ConveyancePolicyService);

      // Insert future policy effective in 2030
      await db
        .insertInto('conveyance_rate_policies')
        .values({
          policy_id: generateUuidV7(),
          travel_mode: 'BUS',
          rate_per_km: 99.0,
          is_provisional: false,
          effective_from: new Date('2030-01-01T00:00:00Z'),
          is_active: true,
          version: 99,
          description: 'Future bus tariff',
        })
        .execute();

      const current = await policyService.resolveRatePolicy('BUS');
      expect(current.ratePerKm).toBe(2.5); // Not the future 99.0
    });

    it('strictly excludes inactive policies', async () => {
      const policyService = app.get(ConveyancePolicyService);

      await db
        .insertInto('conveyance_rate_policies')
        .values({
          policy_id: generateUuidV7(),
          travel_mode: 'OTHER',
          rate_per_km: 50.0,
          is_provisional: false,
          effective_from: new Date('2026-01-01T00:00:00Z'),
          is_active: false,
          version: 1,
          description: 'Disabled tariff',
        })
        .execute();

      const resolved = await policyService.resolveRatePolicy('OTHER');
      expect(resolved.ratePerKm).toBe(5.0); // Not the disabled 50.0
    });

    it('resolves deterministic tie-breaker for overlapping effective dates', async () => {
      const policyService = app.get(ConveyancePolicyService);
      const olderDate = new Date('2026-01-01T00:00:00Z');
      const newerDate = new Date('2026-05-01T00:00:00Z');

      await db
        .insertInto('conveyance_rate_policies')
        .values([
          {
            policy_id: '11111111-1111-7111-8111-111111111111',
            travel_mode: 'BUS',
            rate_per_km: 3.0,
            is_provisional: false,
            effective_from: olderDate,
            is_active: true,
            version: 1,
            description: 'Overlapping older bus policy',
          },
          {
            policy_id: '22222222-2222-7222-8222-222222222222',
            travel_mode: 'BUS',
            rate_per_km: 3.5,
            is_provisional: false,
            effective_from: newerDate,
            is_active: true,
            version: 2,
            description: 'Overlapping newer bus policy',
          },
        ])
        .execute();

      const resolved = await policyService.resolveRatePolicy('BUS', {
        effectiveDate: '2026-06-01',
      });
      // Deterministic: newer effective_from (3.50) wins over older (3.00)
      expect(resolved.ratePerKm).toBe(3.5);
      expect(resolved.policyVersion).toBe(2);
    });

    it('handles boundary dates inclusively', async () => {
      const policyService = app.get(ConveyancePolicyService);
      const exactFrom = '2026-07-01T00:00:00.000Z';
      const exactTo = '2026-07-31T23:59:59.000Z';

      await db
        .insertInto('conveyance_rate_policies')
        .values({
          policy_id: generateUuidV7(),
          travel_mode: 'BIKE',
          rate_per_km: 6.25,
          is_provisional: false,
          effective_from: new Date(exactFrom),
          effective_to: new Date(exactTo),
          is_active: true,
          version: 5,
          description: 'July special tariff',
        })
        .execute();

      // Exactly at effective_from boundary
      const boundaryStart = await policyService.resolveRatePolicy('BIKE', {
        effectiveDate: exactFrom,
      });
      expect(boundaryStart.ratePerKm).toBe(6.25);

      // Exactly at effective_to boundary
      const boundaryEnd = await policyService.resolveRatePolicy('BIKE', {
        effectiveDate: exactTo,
      });
      expect(boundaryEnd.ratePerKm).toBe(6.25);
    });
  });

  describe('9. Condition 4 — Server-Authoritative Claim Ownership & Security', () => {
    it('rejects Field Engineer attempt to create claim for another engineer', async () => {
      // Primary engineer attempts to pass otherEngineerId in request body
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: testVisitIdA,
          serviceCaseId: seeded.serviceCaseId,
          engineerId: otherEngineerId, // Tampered claimant identity!
          travelDate: '2026-10-08',
          fromLocation: 'Camp',
          toLocation: 'School',
          travelMode: 'BIKE',
          claimedDistanceKm: 20,
        },
      });

      expect(res.statusCode).toBe(403);
      const json = JSON.parse(res.payload);
      expect(getErrorMessage(json)).toContain('cannot create claims on behalf of another engineer');
    });

    it('rejects Field Engineer attempt to claim a visit assigned to another engineer', async () => {
      // Primary engineer attempts to create claim for visit C (assigned to otherEngineerId)
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: testVisitIdC,
          serviceCaseId: seeded.secondServiceCaseId,
          travelDate: '2026-10-08',
          fromLocation: 'Office',
          toLocation: 'Salem School',
          travelMode: 'BIKE',
          claimedDistanceKm: 25,
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects creation attempt with tampered territory / mismatched service case', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: testVisitIdA,
          serviceCaseId: seeded.secondServiceCaseId, // Mismatched case ID!
          travelDate: '2026-10-08',
          fromLocation: 'Depot',
          toLocation: 'School',
          travelMode: 'BIKE',
          claimedDistanceKm: 15,
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(getErrorMessage(json)).toContain('MISMATCHED_CASE');
    });
  });

  describe('10. Condition 5 — District Coordinator Submission Policy', () => {
    let proxyVisitId: string;
    let proxyClaimId: string;

    beforeAll(async () => {
      proxyVisitId = generateUuidV7();
      await db
        .insertInto('field_visits')
        .values({
          visit_id: proxyVisitId,
          service_case_id: seeded.serviceCaseId,
          engineer_id: primaryEngineerId,
          visit_sequence_number: 11,
          status: 'COMPLETED',
          visit_date: '2026-10-08',
          check_in_timestamp: new Date('2026-10-08T10:00:00Z'),
          check_out_timestamp: new Date('2026-10-08T12:00:00Z'),
          visit_outcome: 'RESOLVED_ON_SITE',
          version: 1,
        })
        .execute();

      // Create draft claim for primary engineer
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: proxyVisitId,
          serviceCaseId: seeded.serviceCaseId,
          travelDate: '2026-10-08',
          fromLocation: 'Depot',
          toLocation: 'School',
          travelMode: 'BIKE',
          claimedDistanceKm: 22,
          submitDirectly: false,
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      proxyClaimId = JSON.parse(res.payload).data.conveyanceClaimId;
    });

    it('allows District Coordinator to submit on behalf of engineer while preserving claim owner', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${proxyClaimId}/submit`,
        headers: {
          authorization: `Bearer ${districtCoordToken}`,
        },
        payload: {
          remarks: 'Proxy submission by coordinator due to field connectivity limitations',
        },
      });

      expect([200, 201]).toContain(res.statusCode);
      const json = JSON.parse(res.payload);
      expect(json.data.claimStatus).toBe('SUBMITTED');
      expect(json.data.engineerId).toBe(primaryEngineerId); // Owner preserved!
      expect(json.data.submittedByUserId).toBe(seeded.erodeCoordinatorUserId); // Submitter audited!

      // Verify audit event reflects proxy submission
      const audit = await db
        .selectFrom('audit_events')
        .selectAll()
        .where('target_entity_id', '=', proxyClaimId)
        .where('action_type', '=', 'CLAIM_SUBMITTED')
        .orderBy('event_timestamp', 'desc')
        .executeTakeFirstOrThrow();

      expect((audit.post_mutation_state as any).isProxySubmission).toBe(true);
      expect((audit.post_mutation_state as any).ownerEngineerId).toBe(primaryEngineerId);
    });

    it('prevents Field Engineer from submitting another engineers claim', async () => {
      // Create another draft claim
      const unsubmittedVisitId = generateUuidV7();
      await db
        .insertInto('field_visits')
        .values({
          visit_id: unsubmittedVisitId,
          service_case_id: seeded.serviceCaseId,
          engineer_id: primaryEngineerId,
          visit_sequence_number: 12,
          status: 'COMPLETED',
          visit_date: '2026-10-08',
          check_in_timestamp: new Date('2026-10-08T10:00:00Z'),
          check_out_timestamp: new Date('2026-10-08T12:00:00Z'),
          visit_outcome: 'RESOLVED_ON_SITE',
          version: 1,
        })
        .execute();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/conveyance-claims',
        headers: {
          authorization: `Bearer ${primaryEngineerToken}`,
        },
        payload: {
          visitId: unsubmittedVisitId,
          serviceCaseId: seeded.serviceCaseId,
          travelDate: '2026-10-08',
          fromLocation: 'Depot',
          toLocation: 'School',
          travelMode: 'BIKE',
          claimedDistanceKm: 18,
          submitDirectly: false,
        },
      });
      const unsubmittedClaimId = JSON.parse(createRes.payload).data.conveyanceClaimId;

      // Other engineer attempts to submit
      const submitRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conveyance-claims/${unsubmittedClaimId}/submit`,
        headers: {
          authorization: `Bearer ${otherEngineerToken}`,
        },
      });

      expect(submitRes.statusCode).toBe(403);
    });
  });

  describe('11. Condition 6 — Financial History & Delete Safety', () => {
    it('blocks physical deletion of field_visits when a conveyance claim exists (ON DELETE RESTRICT)', async () => {
      // Attempting to physically delete a field visit with an active claim
      let threwForeignKeyError = false;
      try {
        await db
          .deleteFrom('field_visits')
          .where('visit_id', '=', testVisitIdA)
          .execute();
      } catch (err: any) {
        threwForeignKeyError = true;
        expect(err.message).toMatch(/violates.*foreign key.*constraint|RESTRICT/i);
      }
      expect(threwForeignKeyError).toBe(true);
    });

    it('preserves conveyance claim and financial records when field_visit is soft-deleted', async () => {
      // Soft-delete the field visit
      await db
        .updateTable('field_visits')
        .set({
          is_deleted: true,
          deleted_at: new Date(),
        })
        .where('visit_id', '=', testVisitIdA)
        .execute();

      // Conveyance claim must remain completely intact and active
      const claim = await db
        .selectFrom('conveyance_claims')
        .selectAll()
        .where('visit_id', '=', testVisitIdA)
        .executeTakeFirst();

      expect(claim).toBeDefined();
      expect(claim?.is_deleted).toBe(false);
      expect(claim?.claim_status).toBe('PAID');
    });
  });
});

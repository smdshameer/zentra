/**
 * ZENTRA Field — Field Conveyance Local Unit Test Suite (Phase 15)
 * apps/field/test/field-conveyance.spec.ts
 *
 * Verifies mobile-side Conveyance Claims Management:
 * - Offline-first claim creation into WatermelonDB Table 10
 * - Odometer validation (ending >= starting)
 * - Calculation transparency with provisional policy disclosure
 * - Operation queueing for upstream sync push
 * - Lifecycle submission state transitions
 * - Duplicate claim prevention per field visit
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAppDatabase } from '../src/database/database';
import { FieldConveyanceRepository } from '../src/domain/repositories/conveyance.repository';
import { OperationQueue } from '../src/domain/queue/operation-queue';
import type { Database } from '@nozbe/watermelondb';

describe('Phase 15 — Mobile Field Conveyance & Offline Claims', () => {
  let db: Database;
  let conveyanceRepo: FieldConveyanceRepository;
  let queue: OperationQueue;

  const testVisitId1 = 'vst-phase15-001';
  const testVisitId2 = 'vst-phase15-002';
  const testCaseId = 'case-phase15-001';
  const testEngineerId = 'eng-phase15-001';

  beforeEach(async () => {
    db = createAppDatabase({ inMemory: true, dbName: 'test_field_conveyance_' + Date.now() });
    conveyanceRepo = new FieldConveyanceRepository(db);
    queue = new OperationQueue(db);
  });

  describe('1. Calculation Transparency & Configurable Rates', () => {
    it('calculates reimbursement accurately based on travel mode with provisional disclosure', () => {
      const bikeCalc = conveyanceRepo.calculateReimbursement(25.5, 'BIKE');
      expect(bikeCalc.claimedDistanceKm).toBe(25.5);
      expect(bikeCalc.appliedRatePerKm).toBe(5.0);
      expect(bikeCalc.calculatedAmount).toBe(127.5);
      expect(bikeCalc.isProvisional).toBe(true);
      expect(bikeCalc.policyDisclaimer).toContain('PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY');

      const busCalc = conveyanceRepo.calculateReimbursement(40, 'BUS');
      expect(busCalc.claimedDistanceKm).toBe(40);
      expect(busCalc.appliedRatePerKm).toBe(2.5);
      expect(busCalc.calculatedAmount).toBe(100.0);
    });
  });

  describe('2. Local Claim Creation & Odometer Validation', () => {
    it('rejects claim creation when ending odometer is strictly less than starting odometer', async () => {
      await expect(
        conveyanceRepo.createClaim({
          visitId: testVisitId1,
          serviceCaseId: testCaseId,
          engineerId: testEngineerId,
          travelDate: '2026-10-08',
          fromLocation: 'District Office Erode',
          toLocation: 'Erode Model GHSS',
          travelMode: 'BIKE',
          startingOdometerKm: 14500,
          endingOdometerKm: 14480, // Invalid!
          claimedDistanceKm: 20,
        }),
      ).rejects.toThrow('ODOMETER_VALIDATION_ERROR');
    });

    it('creates a local DRAFT claim in WatermelonDB and enqueues sync push operation', async () => {
      const claim = await conveyanceRepo.createClaim({
        visitId: testVisitId1,
        serviceCaseId: testCaseId,
        engineerId: testEngineerId,
        travelDate: '2026-10-08',
        fromLocation: 'District Depot',
        toLocation: 'School Campus',
        travelMode: 'BIKE',
        startingOdometerKm: 12000,
        endingOdometerKm: 12025,
        claimedDistanceKm: 25,
        remarks: 'Morning inspection trip',
      });

      expect(claim).toBeDefined();
      expect(claim.claimStatus).toBe('DRAFT');
      expect(claim.claimedDistanceKm).toBe(25);
      expect(claim.appliedRatePerKm).toBe(5.0);
      expect(claim.calculatedAmount).toBe(125.0);
      expect(claim.syncState).toBe('PENDING_SYNC');
      expect(claim.calculatedOdometerDistanceKm).toBe(25);

      // Verify operation queue
      const pendingOps = await queue.getPendingOperations();
      expect(pendingOps).toHaveLength(1);
      expect(pendingOps[0]!.entityType).toBe('conveyance_claims');
      expect(pendingOps[0]!.operationType).toBe('INSERT');
      expect(pendingOps[0]!.localEntityId).toBe(claim.id);
      const payload = JSON.parse(pendingOps[0]!.payloadJson);
      expect(payload.claimedAmount).toBe(125.0);
    });

    it('enforces single active claim per visit and rejects duplicates', async () => {
      // First claim succeeds
      await conveyanceRepo.createClaim({
        visitId: testVisitId2,
        serviceCaseId: testCaseId,
        engineerId: testEngineerId,
        travelDate: '2026-10-08',
        fromLocation: 'Office',
        toLocation: 'School',
        travelMode: 'AUTO',
        claimedDistanceKm: 10,
      });

      // Second claim for the same visit is rejected
      await expect(
        conveyanceRepo.createClaim({
          visitId: testVisitId2,
          serviceCaseId: testCaseId,
          engineerId: testEngineerId,
          travelDate: '2026-10-08',
          fromLocation: 'Office',
          toLocation: 'School',
          travelMode: 'BUS',
          claimedDistanceKm: 10,
        }),
      ).rejects.toThrow('DUPLICATE_CLAIM_ERROR');
    });

    it('creates a SUBMITTED claim immediately when submitImmediately is true', async () => {
      const claim = await conveyanceRepo.createClaim({
        visitId: 'vst-immediate-001',
        serviceCaseId: testCaseId,
        engineerId: testEngineerId,
        travelDate: '2026-10-08',
        fromLocation: 'Depot',
        toLocation: 'Lab Site',
        travelMode: 'BIKE',
        claimedDistanceKm: 15,
        submitImmediately: true,
      });

      expect(claim.claimStatus).toBe('SUBMITTED');
      expect(claim.submittedAt).not.toBeNull();
    });
  });

  describe('3. Claim Submission Lifecycle', () => {
    it('submits a DRAFT claim to SUBMITTED and enqueues status transition', async () => {
      const claim = await conveyanceRepo.createClaim({
        visitId: 'vst-lifecycle-001',
        serviceCaseId: testCaseId,
        engineerId: testEngineerId,
        travelDate: '2026-10-08',
        fromLocation: 'Depot',
        toLocation: 'Lab Site',
        travelMode: 'BIKE',
        claimedDistanceKm: 18,
      });

      expect(claim.claimStatus).toBe('DRAFT');

      const submitted = await conveyanceRepo.submitClaim(claim.id, 'Ready for coordinator review');
      expect(submitted.claimStatus).toBe('SUBMITTED');
      expect(submitted.remarks).toBe('Ready for coordinator review');
      expect(submitted.syncState).toBe('PENDING_SYNC');

      const pendingOps = await queue.getPendingOperations();
      const statusOp = pendingOps.find((op) => op.operationType === 'STATUS_TRANSITION');
      expect(statusOp).toBeDefined();
      const statusPayload = JSON.parse(statusOp!.payloadJson);
      expect(statusPayload.toStatus).toBe('SUBMITTED');
    });
  });

  describe('4. Retrieval & Queries', () => {
    it('retrieves claim by visit ID and by primary ID', async () => {
      const created = await conveyanceRepo.createClaim({
        visitId: 'vst-query-001',
        serviceCaseId: testCaseId,
        engineerId: testEngineerId,
        travelDate: '2026-10-08',
        fromLocation: 'Start',
        toLocation: 'End',
        travelMode: 'TRAIN',
        claimedDistanceKm: 50,
      });

      const byVisit = await conveyanceRepo.getClaimByVisitId('vst-query-001');
      expect(byVisit).not.toBeNull();
      expect(byVisit!.id).toBe(created.id);
      expect(byVisit!.travelMode).toBe('TRAIN');
      expect(byVisit!.calculatedAmount).toBe(100.0); // 50 * 2.0

      const byId = await conveyanceRepo.getClaimById(created.id);
      expect(byId).not.toBeNull();
      expect(byId!.visitId).toBe('vst-query-001');
    });
  });
});

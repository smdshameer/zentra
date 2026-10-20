/**
 * ZENTRA Field — Field Visit Execution & Multi-Visit Flow Test Suite (Phase 13)
 * apps/field/test/field-visits.spec.ts
 *
 * Verifies mobile offline-first field visit lifecycle:
 * - Deterministic sequence generation in offline environments
 * - GPS Proximity Check-In with LocationService (<= 50m accuracy threshold)
 * - Start-work and on-site diagnosis recording
 * - Check-out with structured outcomes (RESOLVED_ON_SITE vs PENDING_PARTS)
 * - Atomic persistence in WatermelonDB and operation queue
 * - Multi-visit management and sync engine delta processing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAppDatabase } from '../src/database/database';
import { FieldVisitRepository } from '../src/domain/repositories/field-visit.repository';
import { ServiceCaseRepository } from '../src/domain/repositories/service-case.repository';
import { OperationQueue } from '../src/domain/queue/operation-queue';
import {
  LocationService,
  MockLocationAdapter,
} from '../src/hardware/location';
import type { Database } from '@nozbe/watermelondb';

describe('Phase 13 — Mobile Field Visit Execution & Multi-Visit Flow', () => {
  let db: Database;
  let visitRepo: FieldVisitRepository;
  let caseRepo: ServiceCaseRepository;
  let queue: OperationQueue;
  let mockLocationAdapter: MockLocationAdapter;
  let locationService: LocationService;

  const testCaseId = '01a126f6-7d9a-7dfa-96bb-000000000001';
  const testEngineerId = '01a126f6-7d9a-7dfa-96bb-000000000002';
  const schoolLat = 11.4501;
  const schoolLon = 77.6822;

  beforeEach(async () => {
    db = createAppDatabase({ inMemory: true, dbName: 'test_visits_' + Date.now() });
    visitRepo = new FieldVisitRepository(db);
    caseRepo = new ServiceCaseRepository(db);
    queue = new OperationQueue(db);

    mockLocationAdapter = new MockLocationAdapter();
    mockLocationAdapter.setPermissionStatus('GRANTED');
    mockLocationAdapter.setLocationServicesEnabled(true);
    locationService = new LocationService(mockLocationAdapter);

    // Seed parent service case
    await caseRepo.upsertCasesFromServer([
      {
        serviceCaseId: testCaseId,
        sourceComplaintId: 'src-cmp-001',
        zentraCaseCode: 'ZNT-2026-ERO-000001',
        schoolId: 'sch-erode-01',
        labId: 'lab-erode-01',
        operationalStatus: 'ASSIGNED',
        internalPriority: 'HIGH',
        assignedPrimaryEngineerId: testEngineerId,
        slaBreachStatus: 'WITHIN_SLA',
        actualDiagnosisSummary: 'Reported UPS failure',
        verificationStatus: 'PENDING_REVIEW',
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  });

  // ==========================================================
  // SECTION 1: DETERMINISTIC SEQUENCING & OFFLINE CREATION
  // ==========================================================
  describe('1. Deterministic Sequence Generation & Offline Creation', () => {
    it('creates Visit #1 with sequence 1 and status PLANNED when no visits exist', async () => {
      const v1 = await visitRepo.createVisitLocally({
        serviceCaseId: testCaseId,
        engineerId: testEngineerId,
        visitDate: '2026-10-08',
        notes: 'Initial diagnostics visit',
      });

      expect(v1.visitSequenceNumber).toBe(1);
      expect(v1.status).toBe('PLANNED');
      expect(v1.serviceCaseId).toBe(testCaseId);
      expect(v1.syncState).toBe('LOCAL_ONLY');

      // Verify operation queued
      const ops = await queue.getPendingOperations();
      expect(ops.length).toBe(1);
      expect(ops[0]?.operationType).toBe('INSERT');
      expect(ops[0]?.entityType).toBe('field_visits');
    });

    it('creates Visit #2 with sequence 2 deterministically when Visit #1 exists', async () => {
      const v1 = await visitRepo.createVisitLocally({
        serviceCaseId: testCaseId,
        engineerId: testEngineerId,
        visitDate: '2026-10-08',
      });

      // Complete Visit #1 so subsequent visit can be created cleanly
      await db.write(async () => {
        await v1.update((rec) => {
          rec.status = 'COMPLETED';
        });
      });

      const v2 = await visitRepo.createVisitLocally({
        serviceCaseId: testCaseId,
        engineerId: testEngineerId,
        visitDate: '2026-10-09',
        notes: 'Follow-up visit for spare replacement',
      });

      expect(v2.visitSequenceNumber).toBe(2);
      expect(v2.status).toBe('PLANNED');

      const allVisits = await visitRepo.findByCaseId(testCaseId);
      expect(allVisits.length).toBe(2);
      expect(allVisits[0]?.visitSequenceNumber).toBe(1);
      expect(allVisits[1]?.visitSequenceNumber).toBe(2);
    });
  });

  // ==========================================================
  // SECTION 2: GPS PROXIMITY CHECK-IN & ACCURACY GATING (<= 50M)
  // ==========================================================
  describe('2. GPS Proximity Check-In & Accuracy Gating', () => {
    let visitId: string;

    beforeEach(async () => {
      const visit = await visitRepo.createVisitLocally({
        serviceCaseId: testCaseId,
        engineerId: testEngineerId,
      });
      visitId = visit.id;
    });

    it('rejects check-in when GPS accuracy exceeds 50m threshold (e.g. 85m)', async () => {
      mockLocationAdapter.setLocation({
        latitude: schoolLat,
        longitude: schoolLon,
        accuracyMeters: 85.0, // Coarse fix > 50m
        capturedAt: new Date().toISOString(),
      });

      await expect(
        visitRepo.checkInLocally({
          visitId,
          locationService,
          schoolLat,
          schoolLon,
        }),
      ).rejects.toThrow(/exceeds the required threshold of <= 50m/);

      // Verify visit status untouched
      const visit = await visitRepo.findById(visitId);
      expect(visit?.status).toBe('PLANNED');
    });

    it('accepts check-in with valid GPS accuracy (<= 50m), sets coordinates and advances case to VISIT_STARTED', async () => {
      mockLocationAdapter.setLocation({
        latitude: schoolLat + 0.0001,
        longitude: schoolLon + 0.0001,
        accuracyMeters: 12.0, // Valid high accuracy <= 50m
        capturedAt: new Date().toISOString(),
      });

      const checkInResult = await visitRepo.checkInLocally({
        visitId,
        locationService,
        schoolLat,
        schoolLon,
        equipmentCondition: 'Front panel lights flashing error 04',
      });

      expect(checkInResult.visit.status).toBe('CHECKED_IN');
      expect(checkInResult.visit.checkInAccuracyMeters).toBe(12.0);
      expect(checkInResult.isWithinGeofence).toBe(true);
      expect(checkInResult.distanceMeters).toBeLessThan(50);
      expect(checkInResult.visit.equipmentConditionObserved).toBe(
        'Front panel lights flashing error 04',
      );

      // Verify parent case advanced to VISIT_STARTED
      const parentCase = await caseRepo.findByServerId(testCaseId);
      expect(parentCase?.operationalStatus).toBe('VISIT_STARTED');

      // Verify queued operation
      const ops = await queue.getPendingOperations();
      const statusOp = ops.find(
        (o) => o.operationType === 'STATUS_TRANSITION' && o.serverEntityId === checkInResult.visit.serverId,
      );
      expect(statusOp).toBeDefined();
    });
  });

  // ==========================================================
  // SECTION 3: WORK EXECUTION & STRUCTURED OUTCOMES
  // ==========================================================
  describe('3. Work Execution & Structured Outcomes', () => {
    let visitId: string;

    beforeEach(async () => {
      const visit = await visitRepo.createVisitLocally({
        serviceCaseId: testCaseId,
        engineerId: testEngineerId,
      });
      visitId = visit.id;

      mockLocationAdapter.setLocation({
        latitude: schoolLat,
        longitude: schoolLon,
        accuracyMeters: 10.0,
        capturedAt: new Date().toISOString(),
      });

      await visitRepo.checkInLocally({
        visitId,
        locationService,
        schoolLat,
        schoolLon,
      });
    });

    it('transitions visit to IN_PROGRESS and updates parent case status', async () => {
      const updatedVisit = await visitRepo.startWorkLocally({
        visitId,
        onSiteDiagnosis: 'Capacitor C14 bulged and leaked electrolyte',
        equipmentConditionObserved: 'Casing opened, dusty heatsink',
      });

      expect(updatedVisit.status).toBe('IN_PROGRESS');
      expect(updatedVisit.onSiteDiagnosis).toContain('Capacitor C14');

      const parentCase = await caseRepo.findByServerId(testCaseId);
      expect(parentCase?.operationalStatus).toBe('IN_PROGRESS');
    });

    it('rejects check-out with PENDING_PARTS outcome if pendingReasonText is missing', async () => {
      await visitRepo.startWorkLocally({ visitId });

      await expect(
        visitRepo.checkOutLocally({
          visitId,
          visitOutcome: 'PENDING_PARTS',
          // pendingReasonText is missing
        }),
      ).rejects.toThrow(/pendingReasonText is required/);
    });

    it('checks out with PENDING_PARTS: visit -> PENDING_RETURN, case -> PENDING_PARTS (does not close case)', async () => {
      await visitRepo.startWorkLocally({ visitId });

      const checkedOut = await visitRepo.checkOutLocally({
        visitId,
        visitOutcome: 'PENDING_PARTS',
        pendingReasonText: 'Awaiting replacement 450V 470uF high-temperature capacitors',
        workPerformed: 'Desoldered failed capacitors and measured leakage',
        targetNextVisitDate: '2026-10-14',
      });

      expect(checkedOut.status).toBe('PENDING_RETURN');
      expect(checkedOut.visitOutcome).toBe('PENDING_PARTS');
      expect(checkedOut.pendingReasonText).toContain('Awaiting replacement');

      // Parent case must NOT be closed or resolved
      const parentCase = await caseRepo.findByServerId(testCaseId);
      expect(parentCase?.operationalStatus).toBe('PENDING_PARTS');
    });

    it('checks out with RESOLVED_ON_SITE: visit -> COMPLETED, case -> RESOLVED', async () => {
      await visitRepo.startWorkLocally({ visitId });

      const checkedOut = await visitRepo.checkOutLocally({
        visitId,
        visitOutcome: 'RESOLVED_ON_SITE',
        workPerformed: 'Soldered replacement low-ESR capacitors, powered on unit, 230V clean output verified under 4kW load',
      });

      expect(checkedOut.status).toBe('COMPLETED');
      expect(checkedOut.visitOutcome).toBe('RESOLVED_ON_SITE');

      const parentCase = await caseRepo.findByServerId(testCaseId);
      expect(parentCase?.operationalStatus).toBe('RESOLVED');
    });
  });

  // ==========================================================
  // SECTION 4: SERVER DELTA & SYNC INTEGRATION
  // ==========================================================
  describe('4. Server Delta & Sync Integration for Visits', () => {
    it('upserts visits received from server deltas into local WatermelonDB', async () => {
      const serverVisits = [
        {
          visitId: 'srv-visit-001',
          serviceCaseId: testCaseId,
          engineerId: testEngineerId,
          visitSequenceNumber: 1,
          visitDate: '2026-10-05',
          status: 'COMPLETED' as const,
          checkInAccuracyMeters: 8.5,
          checkInWithinGeofence: true,
          visitOutcome: 'RESOLVED_ON_SITE' as const,
          version: 4,
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const upserted = await visitRepo.upsertVisitsFromServer(serverVisits);
      expect(upserted.length).toBe(1);
      expect(upserted[0]?.serverId).toBe('srv-visit-001');
      expect(upserted[0]?.status).toBe('COMPLETED');
      expect(upserted[0]?.syncState).toBe('SYNCED');

      // Query by serverId
      const found = await visitRepo.findByServerId('srv-visit-001');
      expect(found).not.toBeNull();
      expect(found?.visitOutcome).toBe('RESOLVED_ON_SITE');
    });
  });
});

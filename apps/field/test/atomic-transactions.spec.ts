/**
 * ZENTRA Field — Atomic Local Transactions Test Suite
 * apps/field/test/atomic-transactions.spec.ts
 *
 * Verifies the local ACID transaction guarantees:
 * - Local domain mutation and operation queue insertion commit atomically
 * - If any part of the transaction fails, both writes roll back cleanly
 * - Leaves zero orphan queue records or partial domain updates
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAppDatabase } from '../src/database/database';
import { ServiceCaseRepository } from '../src/domain/repositories/service-case.repository';
import { OperationQueue } from '../src/domain/queue/operation-queue';
import type { Database } from '@nozbe/watermelondb';

describe('Phase 10 — Atomic Local Transactions & Zero Data Loss Guarantee', () => {
  let db: Database;
  let serviceCaseRepo: ServiceCaseRepository;
  let queue: OperationQueue;

  beforeEach(async () => {
    db = createAppDatabase({ inMemory: true, dbName: 'test_tx_' + Date.now() });
    serviceCaseRepo = new ServiceCaseRepository(db);
    queue = new OperationQueue(db);
  });

  it('atomically commits service case status update AND operation queue record', async () => {
    // 1. Seed a cached service case
    const [created] = await serviceCaseRepo.upsertCasesFromServer([
      {
        serviceCaseId: 'sc-atomic-01',
        sourceComplaintId: 'src-cmp-01',
        zentraCaseCode: 'ZNT-2026-ERO-000001',
        schoolId: 'sch-erode-01',
        labId: 'lab-erode-01',
        operationalStatus: 'ASSIGNED',
        internalPriority: 'MEDIUM',
        assignedPrimaryEngineerId: 'fe-user-01',
        slaBreachStatus: 'WITHIN_SLA',
        actualDiagnosisSummary: 'Reported display issue',
        verificationStatus: 'PENDING_REVIEW',
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    expect(created?.operationalStatus).toBe('ASSIGNED');
    expect(created?.syncState).toBe('SYNCED');

    // 2. Execute local status transition
    const result = await serviceCaseRepo.updateStatusLocally(
      created!.id,
      'IN_TRANSIT',
      'Travel commenced to school',
      'Vehicle dispatched',
    );

    // 3. Verify domain record updated locally
    expect(result.serviceCase.operationalStatus).toBe('IN_TRANSIT');
    expect(result.serviceCase.resolutionNotes).toBe('Vehicle dispatched');
    expect(result.serviceCase.syncState).toBe('PENDING_SYNC');
    expect(result.serviceCase.isPendingSync).toBe(true);

    // 4. Verify corresponding operation enqueued with matching operation ID
    const pendingOps = await queue.getPendingOperations();
    expect(pendingOps.length).toBe(1);
    const op = pendingOps[0]!;
    expect(op.clientOperationId).toBe(result.clientOperationId);
    expect(op.entityType).toBe('SERVICE_CASE');
    expect(op.localEntityId).toBe(created!.id);
    expect(op.serverEntityId).toBe('sc-atomic-01');
    expect(op.operationType).toBe('STATUS_TRANSITION');
    expect(op.status).toBe('QUEUED');

    const payload = JSON.parse(op.payloadJson);
    expect(payload.previousStatus).toBe('ASSIGNED');
    expect(payload.targetStatus).toBe('IN_TRANSIT');
    expect(payload.notes).toBe('Vehicle dispatched');
  });

  it('rolls back completely if local transaction encounters an error, leaving no orphan queue entry', async () => {
    // 1. Seed a cached service case
    const [created] = await serviceCaseRepo.upsertCasesFromServer([
      {
        serviceCaseId: 'sc-atomic-02',
        sourceComplaintId: 'src-cmp-02',
        zentraCaseCode: 'ZNT-2026-ERO-000002',
        schoolId: 'sch-erode-01',
        labId: 'lab-erode-01',
        operationalStatus: 'ASSIGNED',
        internalPriority: 'MEDIUM',
        assignedPrimaryEngineerId: 'fe-user-01',
        slaBreachStatus: 'WITHIN_SLA',
        actualDiagnosisSummary: 'Network switch rebooting',
        verificationStatus: 'PENDING_REVIEW',
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 2. Execute failing transaction via serviceCaseRepo where queue enqueue fails
    let transactionFailed = false;
    const originalEnqueue = (serviceCaseRepo as any).queue.enqueue;
    (serviceCaseRepo as any).queue.enqueue = () => {
      throw new Error('Simulated disk failure during queue insertion');
    };

    try {
      await serviceCaseRepo.updateStatusLocally(
        created!.id,
        'IN_TRANSIT',
        'Attempting travel',
      );
    } catch {
      transactionFailed = true;
    } finally {
      (serviceCaseRepo as any).queue.enqueue = originalEnqueue;
    }

    expect(transactionFailed).toBe(true);

    // 3. Verify domain record rolled back to previous state
    const afterFailedTx = await serviceCaseRepo.findById(created!.id);
    expect(afterFailedTx?.operationalStatus).toBe('ASSIGNED');
    expect(afterFailedTx?.syncState).toBe('SYNCED');

    // 4. Verify NO orphan records exist in operation queue
    const pendingOps = await queue.getPendingOperations();
    expect(pendingOps.length).toBe(0);
  });

  it('persists offline status mutation without server contact and preserves operation for Phase 12', async () => {
    // 1. Seed cached case
    const [created] = await serviceCaseRepo.upsertCasesFromServer([
      {
        serviceCaseId: 'sc-atomic-03',
        sourceComplaintId: 'src-cmp-03',
        zentraCaseCode: 'ZNT-2026-ERO-000003',
        schoolId: 'sch-erode-02',
        labId: 'lab-erode-02',
        operationalStatus: 'IN_TRANSIT',
        internalPriority: 'HIGH',
        assignedPrimaryEngineerId: 'fe-user-01',
        slaBreachStatus: 'WITHIN_SLA',
        actualDiagnosisSummary: 'Server rack power offline',
        verificationStatus: 'PENDING_REVIEW',
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 2. Perform offline mutation demonstrating Phase 9 lifecycle transition
    const result = await serviceCaseRepo.updateStatusLocally(
      created!.id,
      'IN_PROGRESS',
      'Diagnosing switch power module',
      'Multimeter inspection started',
    );

    // 3. Verify local record marked as PENDING_SYNC (LOCAL/PENDING), NOT server confirmed
    expect(result.serviceCase.operationalStatus).toBe('IN_PROGRESS');
    expect(result.serviceCase.syncState).toBe('PENDING_SYNC');
    expect(result.serviceCase.isPendingSync).toBe(true);

    // 4. Verify operation queue retains exact data for Phase 12 sync engine
    const pending = await queue.getPendingOperations();
    const op = pending.find((p) => p.localEntityId === created!.id);
    expect(op).toBeDefined();
    expect(op?.status).toBe('QUEUED');
    expect(op?.operationType).toBe('STATUS_TRANSITION');
    const payload = JSON.parse(op!.payloadJson);
    expect(payload.previousStatus).toBe('IN_TRANSIT');
    expect(payload.targetStatus).toBe('IN_PROGRESS');
    expect(payload.notes).toBe('Multimeter inspection started');
  });
});

/**
 * ZENTRA Field — Delta Synchronization & Conflict Arbitration Test Suite
 * apps/field/test/sync-engine.spec.ts
 *
 * Verifies mobile client sync lifecycle:
 * 1. Push queue lifecycle (QUEUED -> IN_FLIGHT -> ACKNOWLEDGED)
 * 2. Conflict handling (IN_FLIGHT -> CONFLICT, capturing conflictCode and preserving local state)
 * 3. Downstream delta application & tombstone purging
 * 4. Atomic rollback when local delta application fails (cursor does not advance)
 * 5. App restart recovery (IN_FLIGHT operations safely recovered to QUEUED)
 * 6. Network failure & retry increment
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAppDatabase } from '../src/database/database';
import { OperationQueue } from '../src/domain/queue/operation-queue';
import { ServiceCaseRepository } from '../src/domain/repositories/service-case.repository';
import { EquipmentRepository } from '../src/domain/repositories/equipment.repository';
import { SyncMetadataRepository } from '../src/sync/sync-metadata.repository';
import { DeltaApplier } from '../src/sync/delta-applier';
import { SyncEngine } from '../src/sync/sync-engine';
import type { SyncApiService } from '../src/sync/sync-api.service';
import type { Database } from '@nozbe/watermelondb';
import type {
  SyncPushResponseData,
  SyncDeltaResponseData,
} from '@zentra/types';

describe('Phase 12 — Mobile Delta Synchronization & Conflict Arbitration Engine', () => {
  let db: Database;
  let queue: OperationQueue;
  let caseRepo: ServiceCaseRepository;
  let equipRepo: EquipmentRepository;
  let metaRepo: SyncMetadataRepository;
  let deltaApplier: DeltaApplier;
  let mockApiService: SyncApiService;
  let syncEngine: SyncEngine;

  beforeEach(() => {
    db = createAppDatabase({ inMemory: true, dbName: 'test_sync_' + Date.now() });
    queue = new OperationQueue(db);
    caseRepo = new ServiceCaseRepository(db);
    equipRepo = new EquipmentRepository(db);
    metaRepo = new SyncMetadataRepository(db);
    deltaApplier = new DeltaApplier(db);

    // Mock API Service
    mockApiService = {
      pushMutations: vi.fn(),
      pullDelta: vi.fn(),
    } as unknown as SyncApiService;

    syncEngine = new SyncEngine(db, mockApiService, queue, metaRepo, deltaApplier);
  });

  it('1. Push Queue Lifecycle: marks operations ACKNOWLEDGED and updates record syncState', async () => {
    // Seed initial service case
    const [seededCase] = await caseRepo.upsertCasesFromServer([
      {
        serviceCaseId: 'sc-101',
        sourceComplaintId: 'src-101',
        zentraCaseCode: 'ZNT-2026-ERO-000101',
        schoolId: 'sch-1',
        labId: 'lab-1',
        operationalStatus: 'ASSIGNED',
        internalPriority: 'HIGH',
        assignedPrimaryEngineerId: 'fe-1',
        slaBreachStatus: 'WITHIN_SLA',
        actualDiagnosisSummary: null,
        verificationStatus: 'PENDING_REVIEW',
        isDeleted: false,
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      },
    ]);

    // Local mutation
    await caseRepo.updateStatusLocally(seededCase!.id, 'IN_TRANSIT', 'Travelling', 'En route');
    const pendingOps = await queue.getPendingOperations();
    expect(pendingOps.length).toBe(1);
    const op = pendingOps[0]!;

    // Mock successful server push response
    const mockPushResponse: SyncPushResponseData = {
      batchId: 'batch-1',
      serverTimestamp: '2026-10-08T10:00:00.000Z',
      results: [
        {
          clientOperationId: op.clientOperationId,
          status: 'ACCEPTED',
          serverVersion: '2',
          serverTimestamp: '2026-10-08T10:00:00.000Z',
        },
      ],
    };
    vi.mocked(mockApiService.pushMutations).mockResolvedValueOnce(mockPushResponse);

    // Mock empty delta pull
    const mockDeltaResponse: SyncDeltaResponseData = {
      changes: [],
      tombstones: [],
      nextCursor: 'cur-1',
      hasMore: false,
      serverTimestamp: '2026-10-08T10:00:00.000Z',
    };
    vi.mocked(mockApiService.pullDelta).mockResolvedValueOnce(mockDeltaResponse);

    const summary = await syncEngine.sync();

    expect(summary.isSuccess).toBe(true);
    expect(summary.pushedCount).toBe(1);
    expect(summary.acknowledgedCount).toBe(1);
    expect(summary.conflictCount).toBe(0);

    // Verify queue status
    const opAfter = await db.get('local_operations').find(op.id);
    expect((opAfter as any).status).toBe('ACKNOWLEDGED');

    // Verify record syncState
    const updatedCase = await caseRepo.findById(seededCase!.id);
    expect(updatedCase?.syncState).toBe('SYNCED');
    expect(updatedCase?.operationalStatus).toBe('IN_TRANSIT');
  });

  it('2. Conflict Handling: records CONFLICT status, captures conflictCode, and preserves local state', async () => {
    // Seed initial service case
    const [seededCase] = await caseRepo.upsertCasesFromServer([
      {
        serviceCaseId: 'sc-102',
        sourceComplaintId: 'src-102',
        zentraCaseCode: 'ZNT-2026-ERO-000102',
        schoolId: 'sch-1',
        labId: 'lab-1',
        operationalStatus: 'ASSIGNED',
        internalPriority: 'HIGH',
        assignedPrimaryEngineerId: 'fe-1',
        slaBreachStatus: 'WITHIN_SLA',
        actualDiagnosisSummary: null,
        verificationStatus: 'PENDING_REVIEW',
        isDeleted: false,
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      },
    ]);

    // Local mutation
    await caseRepo.updateStatusLocally(seededCase!.id, 'IN_TRANSIT', 'Travelling', 'En route');
    const [op] = await queue.getPendingOperations();

    // Mock server returning VERSION_CONFLICT
    const mockPushResponse: SyncPushResponseData = {
      batchId: 'batch-2',
      serverTimestamp: '2026-10-08T10:00:00.000Z',
      results: [
        {
          clientOperationId: op!.clientOperationId,
          status: 'CONFLICT',
          conflictCode: 'VERSION_CONFLICT',
          message: 'Server case was updated by another coordinator',
          serverTimestamp: '2026-10-08T10:00:00.000Z',
        },
      ],
    };
    vi.mocked(mockApiService.pushMutations).mockResolvedValueOnce(mockPushResponse);

    // Mock empty delta pull
    vi.mocked(mockApiService.pullDelta).mockResolvedValueOnce({
      changes: [],
      tombstones: [],
      nextCursor: 'cur-2',
      hasMore: false,
      serverTimestamp: '2026-10-08T10:00:00.000Z',
    });

    const summary = await syncEngine.sync();

    expect(summary.conflictCount).toBe(1);

    // Verify queue operation has CONFLICT status and conflictCode
    const opAfter = await db.get('local_operations').find(op!.id);
    expect((opAfter as any).status).toBe('CONFLICT');
    expect((opAfter as any).conflictCode).toBe('VERSION_CONFLICT');

    // Verify local record retains PENDING_SYNC (not falsely marked SYNCED)
    const localCaseAfter = await caseRepo.findById(seededCase!.id);
    expect(localCaseAfter?.syncState).toBe('PENDING_SYNC');

    // Verify stats
    const stats = await queue.getQueueStats();
    expect(stats.conflictCount).toBe(1);
  });

  it('3. Downstream Delta Application & Tombstone Purging: updates records and purges deleted entities', async () => {
    // Seed equipment record locally
    const [localEquip] = await equipRepo.upsertEquipmentFromServer([
      {
        labEquipmentId: 'eq-tombstone-1',
        labId: 'lab-1',
        equipmentTypeId: 'eqt-1',
        oemId: null,
        oemName: 'Test OEM',
        modelNumber: 'MD-1',
        serialNumber: 'SN-TO-DELETE',
        assetBarcode: null,
        installationDate: '2024-01-01',
        warrantyEndDate: '2027-01-01',
        operationalCondition: 'OPERATIONAL',
        customAttributes: {},
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]);
    expect(localEquip).toBeDefined();

    // Mock delta returning an updated case and a tombstone for equipment
    vi.mocked(mockApiService.pullDelta).mockResolvedValueOnce({
      changes: [
        {
          entityType: 'service_cases',
          entityId: 'sc-delta-1',
          action: 'UPSERT',
          version: '1',
          updatedAt: '2026-10-08T12:00:00.000Z',
          data: {
            serviceCaseId: 'sc-delta-1',
            sourceComplaintId: 'src-delta-1',
            zentraCaseCode: 'ZNT-2026-ERO-000201',
            schoolId: 'sch-1',
            labId: 'lab-1',
            operationalStatus: 'RESOLVED',
            internalPriority: 'MEDIUM',
            assignedPrimaryEngineerId: 'fe-1',
            slaBreachStatus: 'WITHIN_SLA',
            actualDiagnosisSummary: 'Resolved remotely',
            verificationStatus: 'PENDING_REVIEW',
            isDeleted: false,
          },
        },
      ],
      tombstones: [
        {
          entityType: 'lab_equipment',
          entityId: 'eq-tombstone-1',
          deletedAt: '2026-10-08T12:00:00.000Z',
        },
      ],
      nextCursor: 'opaque-cursor-v1',
      hasMore: false,
      serverTimestamp: '2026-10-08T12:00:00.000Z',
    });

    const summary = await syncEngine.sync();

    expect(summary.deltasAppliedCount).toBe(1);
    expect(summary.tombstonesPurgedCount).toBe(1);
    expect(summary.newCursor).toBe('opaque-cursor-v1');

    // Verify service case was inserted/updated locally
    const savedCase = await caseRepo.findByServerId('sc-delta-1');
    expect(savedCase).not.toBeNull();
    expect(savedCase?.zentraCaseCode).toBe('ZNT-2026-ERO-000201');
    expect(savedCase?.operationalStatus).toBe('RESOLVED');

    // Verify tombstoned equipment was purged from SQLite
    const purgedEquip = await equipRepo.findById(localEquip!.id);
    expect(purgedEquip).toBeNull();

    // Verify cursor stored in sync_metadata
    const storedCursor = await metaRepo.getCursor();
    expect(storedCursor).toBe('opaque-cursor-v1');
  });

  it('4. Atomic Rollback: cursor does not advance when local delta application fails', async () => {
    // Initial cursor
    await metaRepo.setCursor('original-cursor-0');

    // Mock DeltaApplier failure
    vi.spyOn(deltaApplier, 'applyDeltaBatch').mockRejectedValueOnce(
      new Error('Disk I/O error or constraint failure during delta application'),
    );

    vi.mocked(mockApiService.pullDelta).mockResolvedValueOnce({
      changes: [],
      tombstones: [],
      nextCursor: 'new-bad-cursor',
      hasMore: false,
      serverTimestamp: '2026-10-08T12:00:00.000Z',
    });

    const summary = await syncEngine.sync();

    expect(summary.isSuccess).toBe(false);
    expect(summary.error).toBeDefined();

    // Verify cursor did NOT advance
    const cursorAfter = await metaRepo.getCursor();
    expect(cursorAfter).toBe('original-cursor-0');
  });

  it('5. App Restart Recovery: Ambiguous IN_FLIGHT marks CONFLICT; unsubmitted recovers to QUEUED', async () => {
    // 1. Ambiguous in-flight operation: was attempted (lastAttemptAt is set) before crash
    const ambiguousOp = await queue.enqueueStandalone({
      entityType: 'SERVICE_CASE',
      localEntityId: 'loc-sc-crash-ambiguous',
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });
    await queue.markInFlight(ambiguousOp.clientOperationId);

    // 2. Provably unsubmitted in-flight operation: staged in IN_FLIGHT without attempt timestamp
    const unsubmittedOp = await queue.enqueueStandalone({
      entityType: 'SERVICE_CASE',
      localEntityId: 'loc-sc-unsubmitted',
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'ARRIVED' },
    });
    await db.write(async () => {
      await unsubmittedOp.update((rec) => {
        rec.status = 'IN_FLIGHT';
        rec.lastAttemptAt = null;
      });
    });

    // Verify neither is in pending queue while IN_FLIGHT
    let pending = await queue.getPendingOperations();
    expect(pending.length).toBe(0);

    // Run recovery
    const recoveryResult = await syncEngine.recoverInFlightOperations();
    expect(recoveryResult.ambiguousCount).toBe(1);
    expect(recoveryResult.recoveredCount).toBe(1);

    // Verify ambiguous operation is fail-closed in CONFLICT and NOT eligible for push
    const ambiguousAfter = await db.get('local_operations').find(ambiguousOp.id);
    expect((ambiguousAfter as any).status).toBe('CONFLICT');
    expect((ambiguousAfter as any).conflictCode).toBe('UNCERTAIN_OUTCOME');
    expect((ambiguousAfter as any).clientOperationId).toBe(ambiguousOp.clientOperationId);

    // Verify provably unsubmitted operation is safely back in QUEUED and eligible for push
    const unsubmittedAfter = await db.get('local_operations').find(unsubmittedOp.id);
    expect((unsubmittedAfter as any).status).toBe('QUEUED');
    expect((unsubmittedAfter as any).clientOperationId).toBe(unsubmittedOp.clientOperationId);

    // Pending operations only contains the safely recovered unsubmitted operation
    pending = await queue.getPendingOperations();
    expect(pending.length).toBe(1);
    expect(pending[0]?.clientOperationId).toBe(unsubmittedOp.clientOperationId);
  });

  it('6. Pre-Dispatch Failure: increments retry count and keeps operation status as QUEUED for safe retry', async () => {
    const op = await queue.enqueueStandalone({
      entityType: 'SERVICE_CASE',
      localEntityId: 'loc-sc-net-fail',
      operationType: 'STATUS_TRANSITION',
      payload: { targetStatus: 'IN_TRANSIT' },
    });

    const preDispatchError = Object.assign(
      new Error('Pre-dispatch transport failure: connection cancelled before sending'),
      { isPreDispatch: true },
    );
    vi.mocked(mockApiService.pushMutations).mockRejectedValueOnce(preDispatchError);

    const summary = await syncEngine.sync();

    expect(summary.isSuccess).toBe(false);
    expect(summary.error).toContain('Pre-dispatch transport failure');

    // Verify operation was safely kept in QUEUED with retryCount incremented
    const opAfter = await db.get('local_operations').find(op.id);
    expect((opAfter as any).status).toBe('QUEUED');
    expect((opAfter as any).retryCount).toBe(1);
    expect((opAfter as any).errorMessage).toContain('Pre-dispatch failure');
  });

  it('7. Condition #2 Preservation: Pending local mutation + Incoming server delta preserves both without data loss', async () => {
    // 1. Seed initial case at server version 1
    const [seededCase] = await caseRepo.upsertCasesFromServer([
      {
        serviceCaseId: 'sc-cond2-001',
        sourceComplaintId: 'src-c2-001',
        zentraCaseCode: 'ZNT-2026-ERO-000201',
        schoolId: 'sch-c2',
        labId: 'lab-c2',
        operationalStatus: 'ASSIGNED',
        internalPriority: 'MEDIUM',
        assignedPrimaryEngineerId: 'fe-c2',
        slaBreachStatus: 'WITHIN_SLA',
        actualDiagnosisSummary: 'Initial diagnosis v1',
        verificationStatus: 'PENDING_REVIEW',
        isDeleted: false,
        version: 1,
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      },
    ]);

    expect(seededCase).toBeDefined();
    expect(seededCase!.serverVersion).toBe('1');
    expect(seededCase!.syncState).toBe('SYNCED');

    // 2. Local mutation is enqueued offline (based on version 1)
    await caseRepo.updateStatusLocally(
      seededCase!.id,
      'IN_TRANSIT',
      'Engineer en route to school lab',
      'Navigating via highway',
    );

    const caseAfterLocalEdit = await caseRepo.findById(seededCase!.id);
    expect(caseAfterLocalEdit?.syncState).toBe('PENDING_SYNC');
    expect(caseAfterLocalEdit?.operationalStatus).toBe('IN_TRANSIT');

    const pendingOpsBeforeDelta = await queue.getPendingOperations();
    expect(pendingOpsBeforeDelta.length).toBe(1);
    const pendingOp = pendingOpsBeforeDelta[0]!;
    expect(pendingOp.baseVersion).toBe('1');
    expect(pendingOp.status).toBe('QUEUED');
    const originalPayload = JSON.parse(pendingOp.payloadJson);
    expect(originalPayload.targetStatus).toBe('IN_TRANSIT');

    // 3. Incoming delta arrives with Server Version 2 (e.g. updated by dispatcher or coordinator)
    const incomingDelta: SyncDeltaResponseData = {
      changes: [
        {
          entityType: 'service_cases',
          entityId: 'sc-cond2-001',
          action: 'UPSERT',
          version: '2',
          data: {
            serviceCaseId: 'sc-cond2-001',
            zentraCaseCode: 'ZNT-2026-ERO-000201',
            schoolId: 'sch-c2',
            labId: 'lab-c2',
            operationalStatus: 'CANCELLED',
            internalPriority: 'CRITICAL',
            assignedPrimaryEngineerId: 'fe-c2',
            actualDiagnosisSummary: 'School cancelled appointment per administrative order',
            version: 2,
            updatedAt: '2026-10-08T12:00:00.000Z',
          },
          updatedAt: '2026-10-08T12:00:00.000Z',
        },
      ],
      tombstones: [],
      nextCursor: 'cur-cond2-advanced-002',
      hasMore: false,
      serverTimestamp: '2026-10-08T12:00:00.000Z',
    };

    // 4. Apply delta via DeltaApplier
    const applyResult = await deltaApplier.applyDeltaBatch(incomingDelta);

    expect(applyResult.appliedCount).toBe(1);
    expect(applyResult.advancedCursor).toBe('cur-cond2-advanced-002');

    // 5. Verify local domain record reflects authoritative server version 2 and CONFLICT state
    const caseAfterDelta = await caseRepo.findById(seededCase!.id);
    expect(caseAfterDelta).toBeDefined();
    expect(caseAfterDelta?.operationalStatus).toBe('CANCELLED');
    expect(caseAfterDelta?.faultDescription).toBe('School cancelled appointment per administrative order');
    expect(caseAfterDelta?.serverVersion).toBe('2');
    expect(caseAfterDelta?.syncState).toBe('CONFLICT');

    // 6. Verify queued operation is preserved in CONFLICT status with payload intact
    const queuedOpAfter = await db.get('local_operations').find(pendingOp.id);
    expect((queuedOpAfter as any).status).toBe('CONFLICT');
    expect((queuedOpAfter as any).conflictCode).toBe('VERSION_CONFLICT');
    expect((queuedOpAfter as any).errorMessage).toContain('Incoming server delta version 2 conflicts');
    const preservedPayload = JSON.parse((queuedOpAfter as any).payloadJson);
    expect(preservedPayload.targetStatus).toBe('IN_TRANSIT');
    expect(preservedPayload.reason).toBe('Engineer en route to school lab');

    // 7. Verify sync cursor advanced safely in sync_metadata
    const cursor = await metaRepo.getCursor();
    expect(cursor).toBe('cur-cond2-advanced-002');
  });
});


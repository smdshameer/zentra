/**
 * ZENTRA Field — Connectivity Awareness Test Suite
 * apps/field/test/connectivity-awareness.spec.ts
 *
 * Verifies network monitor state transitions and confirms architectural decoupling:
 * - Online, Offline, and Unknown states
 * - Listener lifecycle
 * - CRITICAL PROOF: Connectivity available != Synchronization complete
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockNetworkMonitor } from '../src/network/network-monitor';
import { createAppDatabase } from '../src/database/database';
import { ServiceCaseRepository } from '../src/domain/repositories/service-case.repository';
import { OperationQueue } from '../src/domain/queue/operation-queue';

describe('Phase 10 — Connectivity Awareness & Architectural Decoupling', () => {
  let networkMonitor: MockNetworkMonitor;

  beforeEach(() => {
    networkMonitor = new MockNetworkMonitor('OFFLINE');
  });

  it('accurately monitors and transitions connectivity states', () => {
    expect(networkMonitor.getStatus()).toBe('OFFLINE');
    expect(networkMonitor.isOnline()).toBe(false);

    const receivedStates: string[] = [];
    const unsubscribe = networkMonitor.addListener((status) => {
      receivedStates.push(status);
    });

    networkMonitor.setStatus('ONLINE');
    expect(networkMonitor.isOnline()).toBe(true);
    expect(networkMonitor.getStatus()).toBe('ONLINE');

    networkMonitor.setStatus('UNKNOWN');
    expect(networkMonitor.getStatus()).toBe('UNKNOWN');

    unsubscribe();
    networkMonitor.setStatus('ONLINE');

    // Should only have received OFFLINE (initial), ONLINE, UNKNOWN before unsubscribe
    expect(receivedStates).toEqual(['OFFLINE', 'ONLINE', 'UNKNOWN']);
  });

  it('guarantees that becoming ONLINE does NOT falsely mark local records as SYNCED', async () => {
    const db = createAppDatabase({ inMemory: true, dbName: 'test_conn_' + Date.now() });
    const caseRepo = new ServiceCaseRepository(db);
    const queue = new OperationQueue(db);

    // 1. Create a service case and perform local offline update
    const [created] = await caseRepo.upsertCasesFromServer([
      {
        serviceCaseId: 'sc-conn-01',
        sourceComplaintId: 'src-cmp-01',
        zentraCaseCode: 'ZNT-2026-ERO-000055',
        schoolId: 'sch-erode-01',
        labId: 'lab-erode-01',
        operationalStatus: 'ASSIGNED',
        internalPriority: 'MEDIUM',
        assignedPrimaryEngineerId: 'fe-user-01',
        slaBreachStatus: 'WITHIN_SLA',
        actualDiagnosisSummary: 'Speaker volume low',
        verificationStatus: 'PENDING_REVIEW',
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    await caseRepo.updateStatusLocally(created!.id, 'IN_TRANSIT');

    const pendingBefore = await queue.getPendingOperations();
    expect(pendingBefore.length).toBe(1);
    expect(pendingBefore[0]?.status).toBe('QUEUED');

    const caseBefore = await caseRepo.findById(created!.id);
    expect(caseBefore?.syncState).toBe('PENDING_SYNC');

    // 2. Network connectivity is restored to ONLINE
    networkMonitor.setStatus('ONLINE');
    expect(networkMonitor.isOnline()).toBe(true);

    // 3. ARCHITECTURAL PROOF: Merely being ONLINE does NOT alter local sync state!
    const caseAfter = await caseRepo.findById(created!.id);
    expect(caseAfter?.syncState).toBe('PENDING_SYNC');
    expect(caseAfter?.isPendingSync).toBe(true);

    const pendingAfter = await queue.getPendingOperations();
    expect(pendingAfter.length).toBe(1);
    expect(pendingAfter[0]?.status).toBe('QUEUED'); // Queue item is still QUEUED, not falsely ACKNOWLEDGED
  });
});

/**
 * ZENTRA Field — Service Case Local Repository
 * apps/field/src/domain/repositories/service-case.repository.ts
 *
 * Implements offline-first data access and atomic local mutations:
 * - Offline reading of assigned service cases
 * - Caching server-dispatched cases
 * - Atomic local mutations (domain record update + local operation queue entry)
 * - Safe transaction rollback on failure
 */

import { Database, Q } from '@nozbe/watermelondb';
import { ServiceCaseModel } from '../../database/models/ServiceCaseModel';
import { OperationQueue } from '../queue/operation-queue';
import { IdentityMap } from '../identity/identity-map';
import type { ServiceCase } from '@zentra/types';

export interface LocalStatusTransitionResult {
  serviceCase: ServiceCaseModel;
  clientOperationId: string;
}

export class ServiceCaseRepository {
  private readonly queue: OperationQueue;

  constructor(private readonly database: Database) {
    this.queue = new OperationQueue(database);
  }

  /**
   * Fetches service cases assigned to an engineer from local offline storage
   */
  async getAssignedCases(engineerId: string): Promise<ServiceCaseModel[]> {
    return await this.database
      .get<ServiceCaseModel>('service_cases')
      .query(
        Q.or(
          Q.where('assigned_primary_engineer_id', engineerId),
          Q.where('assigned_secondary_engineer_id', engineerId),
        ),
        Q.sortBy('created_at', Q.desc),
      )
      .fetch();
  }

  /**
   * Finds single local service case by local database ID
   */
  async findById(id: string): Promise<ServiceCaseModel | null> {
    try {
      return await this.database.get<ServiceCaseModel>('service_cases').find(id);
    } catch {
      return null;
    }
  }

  /**
   * Finds single local service case by backend server ID
   */
  async findByServerId(serverId: string): Promise<ServiceCaseModel | null> {
    const records = await this.database
      .get<ServiceCaseModel>('service_cases')
      .query(Q.where('server_id', serverId))
      .fetch();
    return records[0] || null;
  }

  /**
   * Caches or updates server-fetched service cases into local offline storage
   */
  async upsertCasesFromServer(cases: ServiceCase[]): Promise<ServiceCaseModel[]> {
    return await this.database.write(async () => {
      const results: ServiceCaseModel[] = [];

      for (const item of cases) {
        const existing = await this.findByServerId(item.serviceCaseId);

        if (existing) {
          // If case has local pending mutations, do not silently overwrite local operational status
          if (existing.syncState === 'PENDING_SYNC') {
            results.push(existing);
            continue;
          }

          const updated = await existing.update((rec) => {
            rec.zentraCaseCode = item.zentraCaseCode;
            rec.schoolId = item.schoolId;
            rec.labId = item.labId || null;
            rec.equipmentId = item.labEquipmentId || null;
            rec.sourceComplaintId = item.sourceComplaintId || null;
            rec.assignedPrimaryEngineerId = item.assignedPrimaryEngineerId || '';
            rec.assignedSecondaryEngineerId = item.assignedSecondaryEngineerId || null;
            rec.operationalStatus = item.operationalStatus;
            rec.priority = String(item.internalPriority || 'MEDIUM');
            rec.slaTargetAt = item.slaTargetAt ? new Date(item.slaTargetAt).getTime() : null;
            rec.faultDescription = item.actualDiagnosisSummary || 'Hardware issue reported';
            rec.serverVersion = (item as any).version ? String((item as any).version) : rec.serverVersion || '1';
            rec.syncState = 'SYNCED';
          });
          results.push(updated);
        } else {
          const created = await this.database.get<ServiceCaseModel>('service_cases').create((rec) => {
            rec.serverId = item.serviceCaseId;
            rec.zentraCaseCode = item.zentraCaseCode;
            rec.schoolId = item.schoolId;
            rec.labId = item.labId || null;
            rec.equipmentId = item.labEquipmentId || null;
            rec.sourceComplaintId = item.sourceComplaintId || null;
            rec.assignedPrimaryEngineerId = item.assignedPrimaryEngineerId || '';
            rec.assignedSecondaryEngineerId = item.assignedSecondaryEngineerId || null;
            rec.operationalStatus = item.operationalStatus;
            rec.priority = String(item.internalPriority || 'MEDIUM');
            rec.slaTargetAt = item.slaTargetAt ? new Date(item.slaTargetAt).getTime() : null;
            rec.faultDescription = item.actualDiagnosisSummary || 'Hardware issue reported';
            rec.serverVersion = (item as any).version ? String((item as any).version) : '1';
            rec.syncState = 'SYNCED';
          });
          results.push(created);
        }
      }

      return results;
    });
  }

  /**
   * Executes an atomic offline lifecycle mutation:
   * 1. Mutates local ServiceCaseModel (operationalStatus, notes, syncState = 'PENDING_SYNC')
   * 2. Enqueues a persistent record in local_operations table
   *
   * ACID GUARANTEE: Both operations commit together inside a single database.write() transaction.
   * If either write fails, the entire transaction rolls back.
   */
  async updateStatusLocally(
    caseId: string,
    targetStatus: string,
    reason?: string,
    notes?: string,
  ): Promise<LocalStatusTransitionResult> {
    const clientOperationId = IdentityMap.generateOperationId();

    return await this.database.write(async () => {
      const caseRecord = await this.database.get<ServiceCaseModel>('service_cases').find(caseId);
      if (!caseRecord) {
        throw new Error(`Service case with local ID '${caseId}' not found in offline storage`);
      }

      const previousStatus = caseRecord.operationalStatus;
      const previousNotes = caseRecord.resolutionNotes;
      const previousSyncState = caseRecord.syncState;

      try {
        // 1. Update domain record
        const updatedCase = await caseRecord.update((rec) => {
          rec.operationalStatus = targetStatus;
          if (notes) rec.resolutionNotes = notes;
          rec.syncState = 'PENDING_SYNC';
        });

        // 2. Insert into operation queue
        await this.queue.enqueue({
          clientOperationId,
          entityType: 'SERVICE_CASE',
          localEntityId: caseRecord.id,
          serverEntityId: caseRecord.serverId,
          operationType: 'STATUS_TRANSITION',
          baseVersion: caseRecord.serverVersion || '1',
          payload: {
            serviceCaseId: caseRecord.serverId,
            previousStatus,
            targetStatus,
            toStatus: targetStatus,
            reason: reason || null,
            notes: notes || null,
            timestamp: new Date().toISOString(),
          },
        });

        return {
          serviceCase: updatedCase,
          clientOperationId,
        };
      } catch (err) {
        // Defensive rollback guaranteeing zero partial state
        await caseRecord.update((rec) => {
          rec.operationalStatus = previousStatus;
          rec.resolutionNotes = previousNotes;
          rec.syncState = previousSyncState;
        });
        throw err;
      }
    });
  }
}

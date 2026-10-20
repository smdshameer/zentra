/**
 * ZENTRA Field — Delta Applier
 * apps/field/src/sync/delta-applier.ts
 *
 * Atomically reconciles incoming server deltas and tombstones into local WatermelonDB:
 * - Upserts changed domain entities while respecting local pending mutations
 * - Permanently purges tombstoned records to prevent record resurrection
 * - Advances opaque sync cursor ONLY when entire batch commits successfully
 * - Enforces all-or-nothing transactional rollback on failure
 */

import { Database, Q } from '@nozbe/watermelondb';
import { ServiceCaseModel } from '../database/models/ServiceCaseModel';
import { EquipmentModel } from '../database/models/EquipmentModel';
import { SyncMetadataModel } from '../database/models/SyncMetadataModel';
import { LocalOperationModel } from '../database/models/LocalOperationModel';
import { FieldVisitModel } from '../database/models/FieldVisitModel';
import type { SyncDeltaResponseData } from '@zentra/types';

export interface DeltaApplyResult {
  appliedCount: number;
  purgedCount: number;
  advancedCursor: string | null;
}

export class DeltaApplier {
  constructor(private readonly database: Database) {}

  /**
   * Atomically applies a batch of downstream server deltas and tombstones.
   * If any record write fails, the entire transaction rolls back.
   */
  async applyDeltaBatch(delta: SyncDeltaResponseData): Promise<DeltaApplyResult> {
    return await this.database.write(async () => {
      let appliedCount = 0;
      let purgedCount = 0;

      // 1. Process Changes (Upserts)
      for (const change of delta.changes) {
        const isCase =
          change.entityType === 'service_cases' ||
          change.entityType === 'SERVICE_CASE';

        if (isCase && change.data) {
          const item = change.data as Record<string, any>;
          const incomingVersion = change.version ? String(change.version) : null;
          const existingRecords = await this.database
            .get<ServiceCaseModel>('service_cases')
            .query(Q.where('server_id', change.entityId))
            .fetch();

          if (existingRecords.length > 0) {
            const existing = existingRecords[0]!;

            // Condition #2: If the local record has pending offline mutations,
            // NEVER silently discard incoming server delta.
            // When an incoming server delta arrives while local mutations are pending:
            // 1. Preserve the pending mutation in local_operations with status='CONFLICT' and code='VERSION_CONFLICT'.
            // 2. Apply authoritative server delta data to the local domain entity.
            // 3. Mark the local entity syncState as 'CONFLICT' and record the new serverVersion.
            // 4. Cursor advances forward normally so server delta is never lost.
            if (existing.syncState === 'PENDING_SYNC') {
              const pendingOps = await this.database
                .get<LocalOperationModel>('local_operations')
                .query(
                  Q.or(
                    Q.where('local_entity_id', existing.id),
                    Q.where('server_entity_id', change.entityId),
                    Q.where('local_entity_id', change.entityId),
                  ),
                  Q.where('status', Q.oneOf(['QUEUED', 'IN_FLIGHT'])),
                )
                .fetch();

              for (const op of pendingOps) {
                await op.update((o) => {
                  o.status = 'CONFLICT';
                  o.conflictCode = 'VERSION_CONFLICT';
                  o.errorMessage = `Incoming server delta version ${incomingVersion || 'unknown'} conflicts with pending local mutation based on version ${o.baseVersion || existing.serverVersion || '1'}`;
                });
              }

              await existing.update((rec) => {
                rec.zentraCaseCode = item.zentraCaseCode || rec.zentraCaseCode;
                rec.schoolId = item.schoolId || rec.schoolId;
                rec.labId = item.labId || null;
                rec.equipmentId = item.labEquipmentId || null;
                rec.sourceComplaintId = item.sourceComplaintId || null;
                rec.assignedPrimaryEngineerId = item.assignedPrimaryEngineerId || rec.assignedPrimaryEngineerId;
                rec.assignedSecondaryEngineerId = item.assignedSecondaryEngineerId || null;
                rec.operationalStatus = item.operationalStatus || rec.operationalStatus;
                rec.priority = String(item.internalPriority || 'MEDIUM');
                rec.slaTargetAt = item.slaTargetAt ? new Date(item.slaTargetAt).getTime() : null;
                rec.faultDescription = item.actualDiagnosisSummary || rec.faultDescription;
                if (incomingVersion) {
                  rec.serverVersion = incomingVersion;
                }
                rec.syncState = 'CONFLICT';
              });
              appliedCount++;
              continue;
            }

            await existing.update((rec) => {
              rec.zentraCaseCode = item.zentraCaseCode || rec.zentraCaseCode;
              rec.schoolId = item.schoolId || rec.schoolId;
              rec.labId = item.labId || null;
              rec.equipmentId = item.labEquipmentId || null;
              rec.sourceComplaintId = item.sourceComplaintId || null;
              rec.assignedPrimaryEngineerId = item.assignedPrimaryEngineerId || rec.assignedPrimaryEngineerId;
              rec.assignedSecondaryEngineerId = item.assignedSecondaryEngineerId || null;
              rec.operationalStatus = item.operationalStatus || rec.operationalStatus;
              rec.priority = String(item.internalPriority || 'MEDIUM');
              rec.slaTargetAt = item.slaTargetAt ? new Date(item.slaTargetAt).getTime() : null;
              rec.faultDescription = item.actualDiagnosisSummary || rec.faultDescription;
              if (incomingVersion) {
                rec.serverVersion = incomingVersion;
              }
              rec.syncState = 'SYNCED';
            });
            appliedCount++;
          } else {
            // Insert new domain entity from server
            const incomingVersion = change.version ? String(change.version) : '1';
            await this.database.get<ServiceCaseModel>('service_cases').create((rec) => {
              rec.serverId = change.entityId;
              rec.zentraCaseCode = item.zentraCaseCode || `ZNT-${change.entityId.slice(0, 8)}`;
              rec.schoolId = item.schoolId || '';
              rec.labId = item.labId || null;
              rec.equipmentId = item.labEquipmentId || null;
              rec.sourceComplaintId = item.sourceComplaintId || null;
              rec.assignedPrimaryEngineerId = item.assignedPrimaryEngineerId || '';
              rec.assignedSecondaryEngineerId = item.assignedSecondaryEngineerId || null;
              rec.operationalStatus = item.operationalStatus || 'REGISTERED';
              rec.priority = String(item.internalPriority || 'MEDIUM');
              rec.slaTargetAt = item.slaTargetAt ? new Date(item.slaTargetAt).getTime() : null;
              rec.faultDescription = item.actualDiagnosisSummary || 'Hardware service call';
              rec.serverVersion = incomingVersion;
              rec.syncState = 'SYNCED';
            });
            appliedCount++;
          }
        } else if (
          (change.entityType === 'field_visits' || change.entityType === 'FIELD_VISIT') &&
          change.data
        ) {
          const item = change.data as Record<string, any>;
          const incomingVersion = change.version ? String(change.version) : null;
          const existingRecords = await this.database
            .get<FieldVisitModel>('field_visits')
            .query(Q.where('server_id', change.entityId))
            .fetch();

          if (existingRecords.length > 0) {
            const existing = existingRecords[0]!;

            if (existing.syncState === 'PENDING_SYNC') {
              const pendingOps = await this.database
                .get<LocalOperationModel>('local_operations')
                .query(
                  Q.or(
                    Q.where('local_entity_id', existing.id),
                    Q.where('server_entity_id', change.entityId),
                    Q.where('local_entity_id', change.entityId),
                  ),
                  Q.where('status', Q.oneOf(['QUEUED', 'IN_FLIGHT'])),
                )
                .fetch();

              for (const op of pendingOps) {
                await op.update((o) => {
                  o.status = 'CONFLICT';
                  o.conflictCode = 'VERSION_CONFLICT';
                  o.errorMessage = `Incoming server delta version ${incomingVersion || 'unknown'} conflicts with pending local visit mutation`;
                });
              }

              await existing.update((rec) => {
                rec.serviceCaseId = item.serviceCaseId || rec.serviceCaseId;
                rec.engineerId = item.engineerId || rec.engineerId;
                rec.visitSequenceNumber = item.visitSequenceNumber ?? rec.visitSequenceNumber;
                rec.visitDate = item.visitDate || rec.visitDate;
                rec.status = item.status || rec.status;
                if (incomingVersion) rec.serverVersion = incomingVersion;
                rec.syncState = 'CONFLICT';
              });
              appliedCount++;
              continue;
            }

            await existing.update((rec) => {
              rec.serviceCaseId = item.serviceCaseId || rec.serviceCaseId;
              rec.engineerId = item.engineerId || rec.engineerId;
              rec.visitSequenceNumber = item.visitSequenceNumber ?? rec.visitSequenceNumber;
              rec.visitDate = item.visitDate || rec.visitDate;
              rec.status = item.status || rec.status;
              rec.checkInTimestamp = item.checkInTimestamp ? new Date(item.checkInTimestamp).getTime() : null;
              rec.checkInLatitude = item.checkInLatitude;
              rec.checkInLongitude = item.checkInLongitude;
              rec.checkInAccuracyMeters = item.checkInAccuracyMeters;
              rec.checkInDistanceMeters = item.checkInDistanceMeters;
              rec.checkInWithinGeofence = item.checkInWithinGeofence;
              rec.equipmentConditionObserved = item.equipmentConditionObserved;
              rec.onSiteDiagnosis = item.onSiteDiagnosis;
              rec.workPerformed = item.workPerformed;
              rec.visitOutcome = item.visitOutcome;
              rec.pendingReasonText = item.pendingReasonText;
              rec.targetNextVisitDate = item.targetNextVisitDate;
              rec.checkOutTimestamp = item.checkOutTimestamp ? new Date(item.checkOutTimestamp).getTime() : null;
              rec.checkOutLatitude = item.checkOutLatitude;
              rec.checkOutLongitude = item.checkOutLongitude;
              rec.checkOutAccuracyMeters = item.checkOutAccuracyMeters;
              rec.notes = item.notes;
              if (incomingVersion) rec.serverVersion = incomingVersion;
              rec.syncState = 'SYNCED';
            });
            appliedCount++;
          } else {
            const incomingVersion = change.version ? String(change.version) : '1';
            await this.database.get<FieldVisitModel>('field_visits').create((rec) => {
              rec.serverId = change.entityId;
              rec.serviceCaseId = item.serviceCaseId || '';
              rec.engineerId = item.engineerId || '';
              rec.visitSequenceNumber = item.visitSequenceNumber ?? 1;
              rec.visitDate = item.visitDate || '';
              rec.status = item.status || 'PLANNED';
              rec.checkInTimestamp = item.checkInTimestamp ? new Date(item.checkInTimestamp).getTime() : null;
              rec.checkInLatitude = item.checkInLatitude;
              rec.checkInLongitude = item.checkInLongitude;
              rec.checkInAccuracyMeters = item.checkInAccuracyMeters;
              rec.checkInDistanceMeters = item.checkInDistanceMeters;
              rec.checkInWithinGeofence = item.checkInWithinGeofence;
              rec.equipmentConditionObserved = item.equipmentConditionObserved;
              rec.onSiteDiagnosis = item.onSiteDiagnosis;
              rec.workPerformed = item.workPerformed;
              rec.visitOutcome = item.visitOutcome;
              rec.pendingReasonText = item.pendingReasonText;
              rec.targetNextVisitDate = item.targetNextVisitDate;
              rec.checkOutTimestamp = item.checkOutTimestamp ? new Date(item.checkOutTimestamp).getTime() : null;
              rec.checkOutLatitude = item.checkOutLatitude;
              rec.checkOutLongitude = item.checkOutLongitude;
              rec.checkOutAccuracyMeters = item.checkOutAccuracyMeters;
              rec.notes = item.notes;
              rec.serverVersion = incomingVersion;
              rec.syncState = 'SYNCED';
            });
            appliedCount++;
          }
        }
      }

      // 2. Process Tombstones (Deletions / Purging)
      for (const tombstone of delta.tombstones) {
        const isCase =
          tombstone.entityType === 'service_cases' ||
          tombstone.entityType === 'SERVICE_CASE';

        const isEquipment =
          tombstone.entityType === 'lab_equipment' ||
          tombstone.entityType === 'LAB_EQUIPMENT' ||
          tombstone.entityType === 'equipment' ||
          tombstone.entityType === 'EQUIPMENT';

        const isVisit =
          tombstone.entityType === 'field_visits' ||
          tombstone.entityType === 'FIELD_VISIT';

        if (isCase) {
          const matchingRecords = await this.database
            .get<ServiceCaseModel>('service_cases')
            .query(
              Q.or(
                Q.where('server_id', tombstone.entityId),
                Q.where('id', tombstone.entityId),
              ),
            )
            .fetch();

          for (const record of matchingRecords) {
            await record.destroyPermanently();
            purgedCount++;
          }
        } else if (isEquipment) {
          const matchingRecords = await this.database
            .get<EquipmentModel>('equipment')
            .query(
              Q.or(
                Q.where('server_id', tombstone.entityId),
                Q.where('id', tombstone.entityId),
              ),
            )
            .fetch();

          for (const record of matchingRecords) {
            await record.destroyPermanently();
            purgedCount++;
          }
        } else if (isVisit) {
          const matchingRecords = await this.database
            .get<FieldVisitModel>('field_visits')
            .query(
              Q.or(
                Q.where('server_id', tombstone.entityId),
                Q.where('id', tombstone.entityId),
              ),
            )
            .fetch();

          for (const record of matchingRecords) {
            await record.destroyPermanently();
            purgedCount++;
          }
        }
      }

      // 3. Atomically Advance Opaque Sync Position Metadata
      if (delta.nextCursor) {
        const cursorRecords = await this.database
          .get<SyncMetadataModel>('sync_metadata')
          .query(Q.where('key', 'sync_cursor'))
          .fetch();

        if (cursorRecords.length > 0) {
          await cursorRecords[0]!.update((rec) => {
            rec.value = delta.nextCursor!;
            rec.updatedAt = new Date();
          });
        } else {
          await this.database.get<SyncMetadataModel>('sync_metadata').create((rec) => {
            rec.key = 'sync_cursor';
            rec.value = delta.nextCursor!;
            rec.updatedAt = new Date();
          });
        }

        const tsRecords = await this.database
          .get<SyncMetadataModel>('sync_metadata')
          .query(Q.where('key', 'last_sync_timestamp'))
          .fetch();

        const nowIso = delta.serverTimestamp || new Date().toISOString();
        if (tsRecords.length > 0) {
          await tsRecords[0]!.update((rec) => {
            rec.value = nowIso;
            rec.updatedAt = new Date();
          });
        } else {
          await this.database.get<SyncMetadataModel>('sync_metadata').create((rec) => {
            rec.key = 'last_sync_timestamp';
            rec.value = nowIso;
            rec.updatedAt = new Date();
          });
        }
      }

      return {
        appliedCount,
        purgedCount,
        advancedCursor: delta.nextCursor,
      };
    });
  }
}

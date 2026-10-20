/**
 * ZENTRA — Sync Push Service
 * apps/api/src/modules/sync/services/sync-push.service.ts
 *
 * Implements server-side processing of outbound mobile mutations:
 * - Deterministic idempotency checking via PostgreSQL idempotency_keys
 * - Territory and RBAC re-validation
 * - Domain conflict arbitration
 * - Atomic transactional domain updates and status history logging
 * - Structured audit trail generation
 * - Supports service_cases and field_visits domain entities
 */

import { Injectable, Inject } from '@nestjs/common';
import { Transaction } from 'kysely';
import type { DatabaseSchema } from '../../../database/database.types';
import { IdempotencyRepository } from '../repositories/idempotency.repository';
import { ConflictArbitratorService } from './conflict-arbitrator.service';
import { ConveyancePolicyService } from '../../conveyance/services/conveyance-policy.service';
import { RlsService } from '../../auth/rls.service';
import { resolveSecurityRole } from '../utils/sync-roles';
import { generateUuidV7 } from '@zentra/shared';
import { RESTRICTED_EVIDENCE_SLOTS } from '@zentra/contracts';
import type {
  SyncPushRequest,
  SyncPushResponseData,
  SyncMutationResult,
} from '@zentra/types';

export interface ClientRequestContext {
  ipAddress: string;
  userAgent: string;
}

@Injectable()
export class SyncPushService {
  constructor(
    @Inject(IdempotencyRepository)
    private readonly idempotencyRepo: IdempotencyRepository,
    @Inject(ConflictArbitratorService)
    private readonly conflictArbitrator: ConflictArbitratorService,
    @Inject(ConveyancePolicyService)
    private readonly conveyancePolicyService: ConveyancePolicyService,
    @Inject(RlsService)
    private readonly rlsService: RlsService,
  ) {}

  /**
   * Processes an upstream sync push batch of mutations.
   */
  async processPushBatch(
    userId: string,
    userRoles: string[],
    pushRequest: SyncPushRequest,
    context: ClientRequestContext,
    activeRole?: string,
  ): Promise<SyncPushResponseData> {
    const role = resolveSecurityRole(userRoles, activeRole);
    const results: SyncMutationResult[] = [];
    const nowIso = new Date().toISOString();

    for (const mutation of pushRequest.mutations) {
      // 1. Idempotency Check (Fast Path): Return cached response if previously processed
      const existingKey = await this.idempotencyRepo.findKey(mutation.clientOperationId);
      if (existingKey) {
        results.push(existingKey.response_body as unknown as SyncMutationResult);
        continue;
      }

      // 2. Transactional Mutation Execution & Atomic Idempotency Persistence
      // The domain mutation and its idempotency record execute inside the exact same
      // RLS-scoped transaction (trx). If the mutation succeeds or establishes a clean domain
      // decision, the idempotency key is saved on trx and commits atomically.
      // If an unexpected infrastructure/database error occurs, the transaction rolls back,
      // ensuring no false REJECTED entry is saved in idempotency_keys.
      const mutationResult = await this.rlsService.withSecurityContext(
        { userId, role },
        async (trx) => {
          // Double-check idempotency key within active transaction (in case concurrent request committed it)
          const inTrxExisting = await this.idempotencyRepo.findKey(mutation.clientOperationId, trx);
          if (inTrxExisting) {
            return inTrxExisting.response_body as unknown as SyncMutationResult;
          }

          const res = await this.executeMutation(trx, userId, userRoles, mutation, context);

          // Atomic idempotency persistence on the SAME transaction
          await this.idempotencyRepo.saveKey(
            {
              clientOperationId: mutation.clientOperationId,
              userId,
              endpoint: '/api/v1/sync/push',
              responseStatusCode: 200,
              responseBody: res as unknown as Record<string, unknown>,
            },
            trx,
          );

          return res;
        },
      );

      results.push(mutationResult);
    }

    return {
      batchId: pushRequest.clientBatchId,
      results,
      serverTimestamp: nowIso,
    };
  }

  /**
   * Executes a single mutation with territory validation and conflict arbitration within an active RLS transaction.
   */
  private async executeMutation(
    trx: Transaction<DatabaseSchema>,
    userId: string,
    userRoles: string[],
    mutation: SyncPushRequest['mutations'][number],
    context: ClientRequestContext,
  ): Promise<SyncMutationResult> {
    const now = new Date();
    const nowIso = now.toISOString();

    if (mutation.entityType === 'service_cases') {
      return await this.executeCaseMutation(trx, userId, userRoles, mutation, context, now, nowIso);
    } else if (mutation.entityType === 'field_visits') {
      return await this.executeVisitMutation(trx, userId, userRoles, mutation, context, now, nowIso);
    } else if (mutation.entityType === 'evidence_files') {
      return await this.executeEvidenceMutation(trx, userId, userRoles, mutation, context, now, nowIso);
    } else if (mutation.entityType === 'conveyance_claims') {
      return await this.executeConveyanceClaimMutation(trx, userId, userRoles, mutation, context, now, nowIso);
    }

    return {
      clientOperationId: mutation.clientOperationId,
      status: 'REJECTED',
      conflictCode: 'SERVER_VALIDATION_FAILED',
      message: `Unsupported entity type '${mutation.entityType}' for sync push.`,
      serverTimestamp: nowIso,
    };
  }

  /**
   * Executes a service case mutation
   */
  private async executeCaseMutation(
    trx: Transaction<DatabaseSchema>,
    userId: string,
    userRoles: string[],
    mutation: SyncPushRequest['mutations'][number],
    context: ClientRequestContext,
    now: Date,
    nowIso: string,
  ): Promise<SyncMutationResult> {
    // 1. Fetch server entity
    const caseRecord = await trx
      .selectFrom('service_cases')
      .where('service_case_id', '=', mutation.entityId)
      .selectAll()
      .executeTakeFirst();

    // 2. Fetch school district for territory authorization
    let schoolDistrictId: string | null = null;
    if (caseRecord) {
      const school = await trx
        .selectFrom('schools')
        .where('school_id', '=', caseRecord.school_id)
        .select(['district_id'])
        .executeTakeFirst();
      schoolDistrictId = school?.district_id || null;
    }

    // 3. Territory and Role Authorization Re-validation
    const authConflict = await this.verifyTerritoryAccess(
      trx,
      userId,
      userRoles,
      schoolDistrictId,
      caseRecord?.assigned_primary_engineer_id,
      mutation,
      nowIso,
    );
    if (authConflict) {
      return authConflict;
    }

    // 4. Conflict Arbitration
    const decision = await this.conflictArbitrator.arbitrateMutation(mutation, caseRecord);
    if (decision.isConflict) {
      return {
        clientOperationId: mutation.clientOperationId,
        status: 'CONFLICT',
        conflictCode: decision.conflictCode,
        message: decision.reason,
        serverVersion: String((caseRecord as any)?.version ?? 1),
        serverTimestamp: nowIso,
      };
    }

    // 5. Execute state mutation inside database transaction
    const currentVersion = Number((caseRecord as any)?.version ?? 1);
    const nextVersion = currentVersion + 1;

    if (mutation.operationType === 'STATUS_TRANSITION') {
      const toStatus = (mutation.payload as any).toStatus;
      const reason = (mutation.payload as any).reason || 'Offline field sync status transition';

      await trx
        .updateTable('service_cases')
        .set({
          operational_status: toStatus,
          version: nextVersion,
          updated_at: now,
        })
        .where('service_case_id', '=', mutation.entityId)
        .execute();

      // Record immutable status history
      await trx
        .insertInto('service_case_status_history')
        .values({
          status_history_id: generateUuidV7(),
          service_case_id: mutation.entityId,
          from_status: caseRecord!.operational_status,
          to_status: toStatus,
          changed_by_user_id: userId,
          transition_reason: reason,
        })
        .execute();

      // Record audit event
      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          actor_user_id: userId,
          actor_ip_address: context.ipAddress,
          actor_device_id: context.userAgent,
          event_category: 'LIFECYCLE',
          target_entity_type: 'service_cases',
          target_entity_id: mutation.entityId,
          action_type: 'STATUS_TRANSITION_SYNC',
          pre_mutation_state: { operational_status: caseRecord!.operational_status },
          post_mutation_state: { operational_status: toStatus },
        })
        .execute();

      return {
        clientOperationId: mutation.clientOperationId,
        status: 'ACCEPTED',
        serverVersion: String(nextVersion),
        serverTimestamp: nowIso,
      };
    } else if (mutation.operationType === 'UPDATE') {
      const updateData: Record<string, unknown> = {
        version: nextVersion,
        updated_at: now,
      };

      if ((mutation.payload as any).actualDiagnosisSummary !== undefined) {
        updateData.actual_diagnosis_summary = (mutation.payload as any).actualDiagnosisSummary;
      }
      if ((mutation.payload as any).actualActionTakenSummary !== undefined) {
        updateData.actual_action_taken_summary = (mutation.payload as any).actualActionTakenSummary;
      }

      await trx
        .updateTable('service_cases')
        .set(updateData as any)
        .where('service_case_id', '=', mutation.entityId)
        .execute();

      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          actor_user_id: userId,
          actor_ip_address: context.ipAddress,
          actor_device_id: context.userAgent,
          event_category: 'SERVICE_CASE',
          target_entity_type: 'service_cases',
          target_entity_id: mutation.entityId,
          action_type: 'UPDATE_SYNC',
          pre_mutation_state: { diagnosis: caseRecord!.actual_diagnosis_summary },
          post_mutation_state: updateData,
        })
        .execute();

      return {
        clientOperationId: mutation.clientOperationId,
        status: 'ACCEPTED',
        serverVersion: String(nextVersion),
        serverTimestamp: nowIso,
      };
    }

    return {
      clientOperationId: mutation.clientOperationId,
      status: 'REJECTED',
      conflictCode: 'SERVER_VALIDATION_FAILED',
      message: `Unhandled operation type '${mutation.operationType}'.`,
      serverTimestamp: nowIso,
    };
  }

  /**
   * Executes a field visit mutation
   */
  private async executeVisitMutation(
    trx: Transaction<DatabaseSchema>,
    userId: string,
    userRoles: string[],
    mutation: SyncPushRequest['mutations'][number],
    context: ClientRequestContext,
    now: Date,
    nowIso: string,
  ): Promise<SyncMutationResult> {
    // 1. Fetch server entity if this is not an INSERT
    let visitRecord: any = null;
    let serviceCaseId: string;

    if (mutation.operationType === 'INSERT') {
      serviceCaseId = (mutation.payload as any)?.serviceCaseId;
      if (!serviceCaseId) {
        return {
          clientOperationId: mutation.clientOperationId,
          status: 'REJECTED',
          conflictCode: 'SERVER_VALIDATION_FAILED',
          message: 'Missing serviceCaseId for field_visits INSERT mutation.',
          serverTimestamp: nowIso,
        };
      }
    } else {
      visitRecord = await trx
        .selectFrom('field_visits')
        .where('visit_id', '=', mutation.entityId)
        .selectAll()
        .executeTakeFirst();
      if (!visitRecord) {
        return {
          clientOperationId: mutation.clientOperationId,
          status: 'CONFLICT',
          conflictCode: 'RECORD_NOT_FOUND',
          message: `Field visit ${mutation.entityId} not found on server.`,
          serverTimestamp: nowIso,
        };
      }
      serviceCaseId = visitRecord.service_case_id;
    }

    // 2. Fetch service case and school for territory re-validation
    const caseRecord = await trx
      .selectFrom('service_cases')
      .where('service_case_id', '=', serviceCaseId)
      .selectAll()
      .executeTakeFirst();

    if (!caseRecord) {
      return {
        clientOperationId: mutation.clientOperationId,
        status: 'CONFLICT',
        conflictCode: 'RECORD_NOT_FOUND',
        message: `Parent service case ${serviceCaseId} not found on server.`,
        serverTimestamp: nowIso,
      };
    }

    if (caseRecord.operational_status === 'CLOSED') {
      return {
        clientOperationId: mutation.clientOperationId,
        status: 'CONFLICT',
        conflictCode: 'INVALID_STATE_TRANSITION',
        message: 'Cannot mutate field visit: Parent service case is in final status CLOSED.',
        serverTimestamp: nowIso,
      };
    }

    const school = await trx
      .selectFrom('schools')
      .where('school_id', '=', caseRecord.school_id)
      .select(['district_id'])
      .executeTakeFirst();

    const authConflict = await this.verifyTerritoryAccess(
      trx,
      userId,
      userRoles,
      school?.district_id || null,
      caseRecord.assigned_primary_engineer_id,
      mutation,
      nowIso,
    );
    if (authConflict) {
      return authConflict;
    }

    // 3. Conflict Arbitration
    const decision = await this.conflictArbitrator.arbitrateMutation(mutation, visitRecord);
    if (decision.isConflict) {
      return {
        clientOperationId: mutation.clientOperationId,
        status: 'CONFLICT',
        conflictCode: decision.conflictCode,
        message: decision.reason,
        serverVersion: String(visitRecord?.version ?? 1),
        serverTimestamp: nowIso,
      };
    }

    // 4. Execute mutation in transaction
    if (mutation.operationType === 'INSERT') {
        const payload = mutation.payload as any;

        // Acquire row lock on service case to serialize concurrent sequence generation
        await trx
          .selectFrom('service_cases')
          .where('service_case_id', '=', serviceCaseId)
          .select(['service_case_id'])
          .forUpdate()
          .execute();

        // Determine authoritative sequence number
        const maxSeqResult = await trx
          .selectFrom('field_visits')
          .where('service_case_id', '=', serviceCaseId)
          .select((eb) => eb.fn.max('visit_sequence_number').as('max_seq'))
          .executeTakeFirst();

        const nextSequence = (Number(maxSeqResult?.max_seq) || 0) + 1;
        const visitDate = payload.visitDate || nowIso.split('T')[0]!;

        await trx
          .insertInto('field_visits')
          .values({
            visit_id: mutation.entityId,
            service_case_id: serviceCaseId,
            engineer_id: payload.engineerId || userId,
            visit_sequence_number: nextSequence,
            visit_date: visitDate,
            status: 'PLANNED',
            visit_outcome: 'RESOLVED_ON_SITE',
            target_next_visit_date: payload.targetNextVisitDate || null,
            notes: payload.notes || null,
            version: 1,
            client_operation_id: mutation.clientOperationId,
          })
          .execute();

        await trx
          .insertInto('field_visit_status_history')
          .values({
            history_id: generateUuidV7(),
            visit_id: mutation.entityId,
            from_status: 'PLANNED',
            to_status: 'PLANNED',
            changed_by_user_id: userId,
            transition_reason: `Offline field visit created (Sequence ${nextSequence})`,
            client_operation_id: mutation.clientOperationId,
          })
          .execute();

        await trx
          .insertInto('audit_events')
          .values({
            audit_event_id: generateUuidV7(),
            actor_user_id: userId,
            actor_ip_address: context.ipAddress,
            actor_device_id: context.userAgent,
            event_category: 'FIELD_VISIT',
            target_entity_type: 'field_visits',
            target_entity_id: mutation.entityId,
            action_type: 'INSERT_SYNC',
            pre_mutation_state: null,
            post_mutation_state: {
              visitId: mutation.entityId,
              serviceCaseId,
              sequenceNumber: nextSequence,
            },
          })
          .execute();

        return {
          clientOperationId: mutation.clientOperationId,
          status: 'ACCEPTED',
          serverVersion: '1',
          serverTimestamp: nowIso,
          data: {
            visitId: mutation.entityId,
            visitSequenceNumber: nextSequence,
          },
        };
      } else if (mutation.operationType === 'STATUS_TRANSITION') {
        const toStatus = (mutation.payload as any).toStatus;
        const currentVersion = Number(visitRecord.version ?? 1);
        const nextVersion = currentVersion + 1;
        const payload = mutation.payload as any;

        const updateData: Record<string, any> = {
          status: toStatus,
          version: nextVersion,
          updated_at: now,
          client_operation_id: mutation.clientOperationId,
        };

        if (toStatus === 'CHECKED_IN') {
          updateData.check_in_timestamp = now;
          updateData.check_in_at_device = payload.capturedAt ? new Date(payload.capturedAt) : now;
          updateData.check_in_at_server = now;
          if (payload.latitude !== undefined) updateData.check_in_latitude = payload.latitude;
          if (payload.longitude !== undefined) updateData.check_in_longitude = payload.longitude;
          if (payload.accuracyMeters !== undefined) updateData.check_in_accuracy_meters = payload.accuracyMeters;
          if (payload.distanceMeters !== undefined) updateData.check_in_distance_meters = payload.distanceMeters;
          if (payload.withinGeofence !== undefined) updateData.check_in_within_geofence = payload.withinGeofence;

          // Advance case lifecycle if currently ASSIGNED, IN_TRANSIT, or PENDING_PARTS
          if (
            caseRecord.operational_status === 'ASSIGNED' ||
            caseRecord.operational_status === 'IN_TRANSIT' ||
            caseRecord.operational_status === 'PENDING_PARTS'
          ) {
            await trx
              .updateTable('service_cases')
              .set({ operational_status: 'VISIT_STARTED', updated_at: now })
              .where('service_case_id', '=', serviceCaseId)
              .execute();

            await trx
              .insertInto('service_case_status_history')
              .values({
                status_history_id: generateUuidV7(),
                service_case_id: serviceCaseId,
                from_status: caseRecord.operational_status,
                to_status: 'VISIT_STARTED',
                changed_by_user_id: userId,
                transition_reason: `Field visit checked in via offline sync`,
              })
              .execute();
          }
        } else if (toStatus === 'IN_PROGRESS') {
          if (payload.onSiteDiagnosis) updateData.on_site_diagnosis = payload.onSiteDiagnosis;
          if (payload.equipmentConditionObserved) updateData.equipment_condition_observed = payload.equipmentConditionObserved;

          // Advance if case is currently VISIT_STARTED or PENDING_PARTS
          if (
            caseRecord.operational_status === 'VISIT_STARTED' ||
            caseRecord.operational_status === 'PENDING_PARTS'
          ) {
            await trx
              .updateTable('service_cases')
              .set({
                operational_status: 'IN_PROGRESS',
                actual_diagnosis_summary: payload.onSiteDiagnosis || undefined,
                updated_at: now,
              })
              .where('service_case_id', '=', serviceCaseId)
              .execute();

            await trx
              .insertInto('service_case_status_history')
              .values({
                status_history_id: generateUuidV7(),
                service_case_id: serviceCaseId,
                from_status: caseRecord.operational_status,
                to_status: 'IN_PROGRESS',
                changed_by_user_id: userId,
                transition_reason: `Field visit work started via offline sync`,
              })
              .execute();
          }
        } else if (
          toStatus === 'COMPLETED' ||
          toStatus === 'PENDING_RETURN' ||
          toStatus === 'ABORTED'
        ) {
          updateData.check_out_timestamp = now;
          updateData.check_out_at_device = payload.capturedAt ? new Date(payload.capturedAt) : now;
          updateData.check_out_at_server = now;
          if (payload.visitOutcome) updateData.visit_outcome = payload.visitOutcome;
          if (payload.workPerformed) updateData.work_performed = payload.workPerformed;
          if (payload.pendingReasonText) updateData.pending_reason_text = payload.pendingReasonText;

          if (payload.visitOutcome === 'PENDING_PARTS' || payload.visitOutcome === 'RETURN_VISIT_REQUIRED') {
            if (caseRecord.operational_status === 'IN_PROGRESS') {
              await trx
                .updateTable('service_cases')
                .set({
                  operational_status: 'PENDING_PARTS',
                  actual_action_taken_summary: payload.workPerformed || undefined,
                  updated_at: now,
                })
                .where('service_case_id', '=', serviceCaseId)
                .execute();

              await trx
                .insertInto('service_case_status_history')
                .values({
                  status_history_id: generateUuidV7(),
                  service_case_id: serviceCaseId,
                  from_status: 'IN_PROGRESS',
                  to_status: 'PENDING_PARTS',
                  changed_by_user_id: userId,
                  transition_reason: `Field visit completed with pending parts via offline sync`,
                })
                .execute();
            }
          } else if (payload.visitOutcome === 'RESOLVED_ON_SITE') {
            if (caseRecord.operational_status === 'IN_PROGRESS') {
              await trx
                .updateTable('service_cases')
                .set({
                  operational_status: 'RESOLVED',
                  actual_action_taken_summary: payload.workPerformed || undefined,
                  updated_at: now,
                })
                .where('service_case_id', '=', serviceCaseId)
                .execute();

              await trx
                .insertInto('service_case_status_history')
                .values({
                  status_history_id: generateUuidV7(),
                  service_case_id: serviceCaseId,
                  from_status: 'IN_PROGRESS',
                  to_status: 'RESOLVED',
                  changed_by_user_id: userId,
                  transition_reason: `Field visit resolved on site via offline sync`,
                })
                .execute();
            }
          } else if (payload.visitOutcome === 'PENDING_OEM_ESCALATION') {
            if (caseRecord.operational_status === 'IN_PROGRESS') {
              await trx
                .updateTable('service_cases')
                .set({
                  operational_status: 'ESCALATED_OEM',
                  actual_action_taken_summary: payload.workPerformed || undefined,
                  updated_at: now,
                })
                .where('service_case_id', '=', serviceCaseId)
                .execute();

              await trx
                .insertInto('service_case_status_history')
                .values({
                  status_history_id: generateUuidV7(),
                  service_case_id: serviceCaseId,
                  from_status: 'IN_PROGRESS',
                  to_status: 'ESCALATED_OEM',
                  changed_by_user_id: userId,
                  transition_reason: `Field visit escalated to OEM via offline sync`,
                })
                .execute();
            }
          }
        }

        await trx
          .updateTable('field_visits')
          .set(updateData)
          .where('visit_id', '=', mutation.entityId)
          .execute();

        await trx
          .insertInto('field_visit_status_history')
          .values({
            history_id: generateUuidV7(),
            visit_id: mutation.entityId,
            from_status: visitRecord.status,
            to_status: toStatus,
            changed_by_user_id: userId,
            transition_reason: payload.reason || `Status transition sync to ${toStatus}`,
            client_operation_id: mutation.clientOperationId,
          })
          .execute();

        await trx
          .insertInto('audit_events')
          .values({
            audit_event_id: generateUuidV7(),
            actor_user_id: userId,
            actor_ip_address: context.ipAddress,
            actor_device_id: context.userAgent,
            event_category: 'FIELD_VISIT',
            target_entity_type: 'field_visits',
            target_entity_id: mutation.entityId,
            action_type: 'STATUS_TRANSITION_SYNC',
            pre_mutation_state: { status: visitRecord.status },
            post_mutation_state: { status: toStatus },
          })
          .execute();

        return {
          clientOperationId: mutation.clientOperationId,
          status: 'ACCEPTED',
          serverVersion: String(nextVersion),
          serverTimestamp: nowIso,
        };
      } else if (mutation.operationType === 'UPDATE') {
        const currentVersion = Number(visitRecord.version ?? 1);
        const nextVersion = currentVersion + 1;
        const updateData: Record<string, any> = {
          version: nextVersion,
          updated_at: now,
        };

        const payload = mutation.payload as any;
        if (payload.notes !== undefined) updateData.notes = payload.notes;
        if (payload.workPerformed !== undefined) updateData.work_performed = payload.workPerformed;
        if (payload.onSiteDiagnosis !== undefined) updateData.on_site_diagnosis = payload.onSiteDiagnosis;

        await trx
          .updateTable('field_visits')
          .set(updateData)
          .where('visit_id', '=', mutation.entityId)
          .execute();

        return {
          clientOperationId: mutation.clientOperationId,
          status: 'ACCEPTED',
          serverVersion: String(nextVersion),
          serverTimestamp: nowIso,
        };
      }

      return {
        clientOperationId: mutation.clientOperationId,
        status: 'REJECTED',
        conflictCode: 'SERVER_VALIDATION_FAILED',
        message: `Unhandled operation type '${mutation.operationType}' for field_visits.`,
        serverTimestamp: nowIso,
      };
  }

  /**
   * Executes an evidence metadata mutation (binary data is never transported through sync)
   */
  private async executeEvidenceMutation(
    trx: Transaction<DatabaseSchema>,
    userId: string,
    userRoles: string[],
    mutation: SyncPushRequest['mutations'][number],
    _context: ClientRequestContext,
    now: Date,
    nowIso: string,
  ): Promise<SyncMutationResult> {
    let evidenceRecord: any = null;
    let visitId: string;
    let engineerId: string | null = null;
    let schoolDistrictId: string | null = null;

    if (mutation.operationType === 'INSERT') {
      const payload = mutation.payload as Record<string, unknown>;
      visitId = String(payload.visitId || payload.visit_id);
      const serviceCaseId = String(payload.serviceCaseId || payload.service_case_id);
      void serviceCaseId;

      // Verify parent visit exists
      const visit = await trx
        .selectFrom('field_visits as fv')
        .innerJoin('service_cases as sc', 'sc.service_case_id', 'fv.service_case_id')
        .innerJoin('schools as s', 's.school_id', 'sc.school_id')
        .select([
          'fv.visit_id',
          'fv.engineer_id',
          'fv.service_case_id',
          's.district_id',
        ])
        .where('fv.visit_id', '=', visitId)
        .where('fv.is_deleted', '=', false)
        .executeTakeFirst();

      if (!visit) {
        return {
          clientOperationId: mutation.clientOperationId,
          status: 'REJECTED',
          conflictCode: 'RECORD_NOT_FOUND',
          message: `Parent visit ${visitId} not found on server for evidence insert.`,
          serverTimestamp: nowIso,
        };
      }

      engineerId = visit.engineer_id;
      schoolDistrictId = visit.district_id;
    } else {
      evidenceRecord = await trx
        .selectFrom('evidence_files as ef')
        .innerJoin('field_visits as fv', 'fv.visit_id', 'ef.visit_id')
        .innerJoin('service_cases as sc', 'sc.service_case_id', 'ef.service_case_id')
        .innerJoin('schools as s', 's.school_id', 'sc.school_id')
        .select([
          'ef.evidence_file_id',
          'ef.visit_id',
          'ef.service_case_id',
          'ef.evidence_slot',
          'ef.storage_path',
          'ef.file_checksum_sha256',
          'ef.upload_status',
          'ef.version',
          'ef.is_deleted',
          'ef.is_tombstoned',
          'fv.engineer_id',
          's.district_id',
        ])
        .where('ef.evidence_file_id', '=', mutation.entityId)
        .executeTakeFirst();

      if (evidenceRecord) {
        engineerId = evidenceRecord.engineer_id;
        schoolDistrictId = evidenceRecord.district_id;
      }
    }

    // Territory Authorization
    const authConflict = await this.verifyTerritoryAccess(
      trx,
      userId,
      userRoles,
      schoolDistrictId,
      engineerId,
      mutation,
      nowIso,
    );
    if (authConflict) {
      return authConflict;
    }

    // Conflict Arbitration
    const decision = await this.conflictArbitrator.arbitrateMutation(mutation, evidenceRecord);
    if (decision.isConflict) {
      return {
        clientOperationId: mutation.clientOperationId,
        status: 'CONFLICT',
        conflictCode: decision.conflictCode,
        message: decision.reason,
        serverVersion: String((evidenceRecord as any)?.version ?? 1),
        serverTimestamp: nowIso,
      };
    }

    if (mutation.operationType === 'INSERT') {
        const payload = mutation.payload as Record<string, unknown>;
        const evidenceSlot = String(payload.evidenceSlot || payload.evidence_slot || 'SLOT_AUX_FAULT_PRE_SERVICE');

        // Check restricted slot uniqueness
        if (RESTRICTED_EVIDENCE_SLOTS.includes(evidenceSlot as any)) {
          const activeSlot = await trx
            .selectFrom('evidence_files')
            .where('visit_id', '=', String(payload.visitId || payload.visit_id))
            .where('evidence_slot', '=', evidenceSlot)
            .where('is_deleted', '=', false)
            .where('is_tombstoned', '=', false)
            .select(['evidence_file_id', 'upload_status'])
            .executeTakeFirst();

          if (activeSlot && (activeSlot.upload_status === 'FINALIZED' || activeSlot.upload_status === 'VERIFIED')) {
            return {
              clientOperationId: mutation.clientOperationId,
              status: 'CONFLICT',
              conflictCode: 'SERVER_VALIDATION_FAILED',
              message: `Slot conflict: slot ${evidenceSlot} already has finalized active evidence.`,
              serverTimestamp: nowIso,
            };
          }
        }

        await trx
          .insertInto('evidence_files')
          .values({
            evidence_file_id: mutation.entityId,
            visit_id: String(payload.visitId || payload.visit_id),
            service_case_id: String(payload.serviceCaseId || payload.service_case_id),
            evidence_slot: evidenceSlot,
            storage_path: String(payload.storagePath || payload.storage_path || `evidence/offline/${mutation.entityId}.jpg`),
            file_checksum_sha256: String(payload.fileChecksumSha256 || payload.file_checksum_sha256 || '0'.repeat(64)),
            file_size_bytes: Number(payload.fileSizeBytes || payload.file_size_bytes || 0),
            mime_type: String(payload.mimeType || payload.mime_type || 'image/jpeg'),
            captured_at: new Date(String(payload.capturedAt || payload.captured_at || nowIso)),
            upload_status: String(payload.uploadStatus || payload.upload_status || 'LOCAL_CAPTURED'),
            object_storage_provider: 'S3',
            evidence_type: String(payload.evidenceType || payload.evidence_type || 'PHOTO'),
            local_media_id: payload.localMediaId ? String(payload.localMediaId) : null,
            created_by_user_id: userId,
            version: 1,
            client_operation_id: mutation.clientOperationId,
            is_verified: false,
            is_tombstoned: false,
            is_deleted: false,
          } as any)
          .execute();

        return {
          clientOperationId: mutation.clientOperationId,
          status: 'ACCEPTED',
          serverVersion: '1',
          serverTimestamp: nowIso,
        };
      } else if (mutation.operationType === 'UPDATE') {
        const payload = mutation.payload as Record<string, unknown>;
        const currentVersion = Number(evidenceRecord?.version ?? 1);
        const nextVersion = currentVersion + 1;

        const updateData: Record<string, unknown> = {
          version: nextVersion,
          updated_at: now,
        };

        if (payload.uploadStatus || payload.upload_status) {
          updateData.upload_status = payload.uploadStatus || payload.upload_status;
        }
        if (payload.isVerified !== undefined || payload.is_verified !== undefined) {
          updateData.is_verified = Boolean(payload.isVerified ?? payload.is_verified);
        }
        if (payload.verificationNotes !== undefined || payload.verification_notes !== undefined) {
          updateData.verification_notes = payload.verificationNotes ?? payload.verification_notes;
        }

        await trx
          .updateTable('evidence_files')
          .set(updateData as any)
          .where('evidence_file_id', '=', mutation.entityId)
          .execute();

        return {
          clientOperationId: mutation.clientOperationId,
          status: 'ACCEPTED',
          serverVersion: String(nextVersion),
          serverTimestamp: nowIso,
        };
      } else if (mutation.operationType === 'SOFT_DELETE') {
        await trx
          .updateTable('evidence_files')
          .set({
            is_deleted: true,
            is_tombstoned: true,
            deleted_at: now,
            deleted_by_user_id: userId,
            updated_at: now,
          } as any)
          .where('evidence_file_id', '=', mutation.entityId)
          .execute();

        await trx
          .insertInto('tombstones')
          .values({
            tombstone_id: generateUuidV7(),
            entity_type: 'evidence_files',
            entity_id: mutation.entityId,
            deleted_at: now,
            tombstone_reason: 'SOFT_DELETE_SYNC',
          })
          .execute();

        return {
          clientOperationId: mutation.clientOperationId,
          status: 'ACCEPTED',
          serverTimestamp: nowIso,
        };
      }

      return {
        clientOperationId: mutation.clientOperationId,
        status: 'REJECTED',
        conflictCode: 'SERVER_VALIDATION_FAILED',
        message: `Unhandled operation type '${mutation.operationType}' for evidence_files.`,
        serverTimestamp: nowIso,
      };
  }

  /**
   * Executes a conveyance claim mutation
   */
  private async executeConveyanceClaimMutation(
    trx: Transaction<DatabaseSchema>,
    userId: string,
    userRoles: string[],
    mutation: SyncPushRequest['mutations'][number],
    _context: ClientRequestContext,
    now: Date,
    nowIso: string,
  ): Promise<SyncMutationResult> {
    // 1. Fetch server claim record if exists
    const claimRecord = await trx
      .selectFrom('conveyance_claims')
      .where('conveyance_claim_id', '=', mutation.entityId)
      .selectAll()
      .executeTakeFirst();

    // 2. Fetch visit and school district for territory authorization
    const visitId = claimRecord?.visit_id || (mutation.payload as any)?.visitId || (mutation.payload as any)?.fieldVisitId;
    if (!visitId) {
      return {
        clientOperationId: mutation.clientOperationId,
        status: 'REJECTED',
        conflictCode: 'SERVER_VALIDATION_FAILED',
        message: 'Missing visitId in conveyance claim mutation.',
        serverTimestamp: nowIso,
      };
    }

    const visit = await trx
      .selectFrom('field_visits')
      .innerJoin('service_cases', 'service_cases.service_case_id', 'field_visits.service_case_id')
      .innerJoin('schools', 'schools.school_id', 'service_cases.school_id')
      .where('field_visits.visit_id', '=', visitId)
      .select([
        'field_visits.visit_id',
        'field_visits.service_case_id',
        'field_visits.engineer_id',
        'schools.district_id as school_district_id',
      ])
      .executeTakeFirst();

    if (!visit) {
      return {
        clientOperationId: mutation.clientOperationId,
        status: 'REJECTED',
        conflictCode: 'RECORD_NOT_FOUND',
        message: `Referenced field visit ${visitId} not found on server.`,
        serverTimestamp: nowIso,
      };
    }

    // 3. Verify territory access
    const authConflict = await this.verifyTerritoryAccess(
      trx,
      userId,
      userRoles,
      visit.school_district_id,
      claimRecord?.engineer_id || visit.engineer_id,
      mutation,
      nowIso,
    );
    if (authConflict) {
      return authConflict;
    }

    // 4. Conflict arbitration
    const decision = await this.conflictArbitrator.arbitrateMutation(mutation, claimRecord);
    if (decision.isConflict) {
      return {
        clientOperationId: mutation.clientOperationId,
        status: 'CONFLICT',
        conflictCode: decision.conflictCode,
        message: decision.reason,
        serverVersion: String((claimRecord as any)?.version ?? 1),
        serverTimestamp: nowIso,
      };
    }

    // 5. Execute state mutation inside database transaction
    const payload = (mutation.payload || {}) as Record<string, any>;
      const currentVersion = Number((claimRecord as any)?.version ?? 1);
      const nextVersion = currentVersion + 1;

      if (mutation.operationType === 'INSERT') {
        // Enforce duplicate prevention: only 1 active claim per visit
        const existingClaimForVisit = await trx
          .selectFrom('conveyance_claims')
          .where('visit_id', '=', visitId)
          .where('claim_status', 'not in', ['REJECTED'])
          .where('is_deleted', '=', false)
          .selectAll()
          .executeTakeFirst();

        if (existingClaimForVisit) {
          return {
            clientOperationId: mutation.clientOperationId,
            status: 'CONFLICT',
            conflictCode: 'DUPLICATE_OPERATION',
            message: `An active conveyance claim ${existingClaimForVisit.conveyance_claim_id} already exists for visit ${visitId}.`,
            serverTimestamp: nowIso,
          };
        }

        // Validate odometer if provided
        if (payload.startingOdometerKm !== undefined && payload.endingOdometerKm !== undefined) {
          if (Number(payload.endingOdometerKm) < Number(payload.startingOdometerKm)) {
            return {
              clientOperationId: mutation.clientOperationId,
              status: 'REJECTED',
              conflictCode: 'SERVER_VALIDATION_FAILED',
              message: 'Ending odometer cannot be less than starting odometer.',
              serverTimestamp: nowIso,
            };
          }
        }

        // Resolve rate policy
        const travelMode = payload.travelMode || 'BIKE';
        const policy = await this.conveyancePolicyService.resolveRatePolicy(travelMode);
        const distance = Number(payload.claimedDistanceKm ?? 0);
        const calculatedAmount = Math.round(distance * policy.ratePerKm * 100) / 100;

        await trx
          .insertInto('conveyance_claims')
          .values({
            conveyance_claim_id: mutation.entityId,
            visit_id: visitId,
            service_case_id: visit.service_case_id,
            engineer_id: payload.engineerId || userId,
            travel_date: payload.travelDate || now.toISOString().split('T')[0]!,
            from_location: payload.fromLocation || 'Base Location',
            to_location: payload.toLocation || 'School Location',
            travel_mode: travelMode,
            policy_id: policy.policyId,
            starting_odometer_km: payload.startingOdometerKm !== undefined ? Number(payload.startingOdometerKm) : null,
            ending_odometer_km: payload.endingOdometerKm !== undefined ? Number(payload.endingOdometerKm) : null,
            calculated_odometer_distance_km:
              payload.startingOdometerKm !== undefined && payload.endingOdometerKm !== undefined
                ? Number(payload.endingOdometerKm) - Number(payload.startingOdometerKm)
                : null,
            gps_distance_km: payload.gpsDistanceKm !== undefined ? Number(payload.gpsDistanceKm) : null,
            claimed_distance_km: distance,
            approved_distance_km: null,
            applied_rate_per_km: policy.ratePerKm,
            rate_policy_version: policy.policyVersion,
            is_provisional_policy: policy.isProvisional,
            calculated_amount: calculatedAmount,
            claimed_amount: calculatedAmount,
            approved_amount: null,
            supporting_evidence_file_id: payload.supportingEvidenceFileId || null,
            claim_status: (payload.status as any) || 'DRAFT',
            submitted_at: payload.status === 'SUBMITTED' ? now : null,
            reviewed_by_user_id: null,
            reviewed_at: null,
            rejection_reason: null,
            correction_notes: null,
            remarks: payload.notes || payload.remarks || null,
            version: 1,
            client_operation_id: mutation.clientOperationId,
            is_tombstoned: false,
            is_deleted: false,
            created_at: now,
            updated_at: now,
          } as any)
          .execute();

        // Audit log in audit_events
        await trx
          .insertInto('audit_events')
          .values({
            audit_event_id: generateUuidV7(),
            actor_user_id: userId,
            actor_ip_address: _context.ipAddress,
            actor_device_id: null,
            event_category: 'CONVEYANCE_CLAIM',
            target_entity_type: 'conveyance_claims',
            target_entity_id: mutation.entityId,
            action_type: 'CLAIM_CREATED_OFFLINE_SYNC',
            pre_mutation_state: null,
            post_mutation_state: { status: (payload.status as any) || 'DRAFT', distance, amount: calculatedAmount },
            event_timestamp: now,
          })
          .execute();

        return {
          clientOperationId: mutation.clientOperationId,
          status: 'ACCEPTED',
          serverVersion: '1',
          serverTimestamp: nowIso,
        };
      } else if (mutation.operationType === 'UPDATE') {
        const updateData: Record<string, any> = {
          version: nextVersion,
          updated_at: now,
        };

        if (payload.travelMode) updateData.travel_mode = payload.travelMode;
        if (payload.startingOdometerKm !== undefined) updateData.starting_odometer_km = payload.startingOdometerKm;
        if (payload.endingOdometerKm !== undefined) updateData.ending_odometer_km = payload.endingOdometerKm;
        if (payload.notes !== undefined || payload.remarks !== undefined) updateData.remarks = payload.notes || payload.remarks;

        if (payload.claimedDistanceKm !== undefined) {
          updateData.claimed_distance_km = Number(payload.claimedDistanceKm);
          const rate = Number(claimRecord!.applied_rate_per_km);
          updateData.calculated_amount = Math.round(Number(payload.claimedDistanceKm) * rate * 100) / 100;
          updateData.claimed_amount = updateData.calculated_amount;
        }

        await trx
          .updateTable('conveyance_claims')
          .set(updateData as any)
          .where('conveyance_claim_id', '=', mutation.entityId)
          .execute();

        await trx
          .insertInto('audit_events')
          .values({
            audit_event_id: generateUuidV7(),
            actor_user_id: userId,
            actor_ip_address: _context.ipAddress,
            actor_device_id: null,
            event_category: 'CONVEYANCE_CLAIM',
            target_entity_type: 'conveyance_claims',
            target_entity_id: mutation.entityId,
            action_type: 'CLAIM_UPDATED_OFFLINE_SYNC',
            pre_mutation_state: { status: claimRecord!.claim_status },
            post_mutation_state: { status: claimRecord!.claim_status, updateData },
            event_timestamp: now,
          })
          .execute();

        return {
          clientOperationId: mutation.clientOperationId,
          status: 'ACCEPTED',
          serverVersion: String(nextVersion),
          serverTimestamp: nowIso,
        };
      } else if (mutation.operationType === 'STATUS_TRANSITION') {
        const toStatus = payload.toStatus;
        const currentStatus = claimRecord!.claim_status;

        await trx
          .updateTable('conveyance_claims')
          .set({
            claim_status: toStatus,
            version: nextVersion,
            updated_at: now,
            submitted_at: toStatus === 'SUBMITTED' ? now : undefined,
          })
          .where('conveyance_claim_id', '=', mutation.entityId)
          .execute();

        await trx
          .insertInto('audit_events')
          .values({
            audit_event_id: generateUuidV7(),
            actor_user_id: userId,
            actor_ip_address: _context.ipAddress,
            actor_device_id: null,
            event_category: 'CONVEYANCE_CLAIM',
            target_entity_type: 'conveyance_claims',
            target_entity_id: mutation.entityId,
            action_type: `CLAIM_STATUS_TRANSITION_${toStatus}`,
            pre_mutation_state: { status: currentStatus },
            post_mutation_state: { status: toStatus, reason: payload.reason },
            event_timestamp: now,
          })
          .execute();

        return {
          clientOperationId: mutation.clientOperationId,
          status: 'ACCEPTED',
          serverVersion: String(nextVersion),
          serverTimestamp: nowIso,
        };
      }

      return {
        clientOperationId: mutation.clientOperationId,
        status: 'REJECTED',
        conflictCode: 'SERVER_VALIDATION_FAILED',
        message: `Unhandled operation type '${mutation.operationType}' for conveyance_claims.`,
        serverTimestamp: nowIso,
      };
  }

  /**
   * Helper to verify user territory / assignment access
   */
  private async verifyTerritoryAccess(
    trx: Transaction<DatabaseSchema>,
    userId: string,
    userRoles: string[],
    schoolDistrictId: string | null,
    assignedEngineerId: string | null | undefined,
    mutation: SyncPushRequest['mutations'][number],
    nowIso: string,
  ): Promise<SyncMutationResult | null> {
    const isMasterOrReporting =
      userRoles.includes('MASTER_ADMIN') || userRoles.includes('REPORTING_HEAD');

    if (isMasterOrReporting) {
      return null;
    }

    const userAssignments = await trx
      .selectFrom('user_territory_assignments')
      .where('user_id', '=', userId)
      .where((eb) =>
        eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', new Date())]),
      )
      .select(['district_id'])
      .execute();

    const assignedDistrictIds = userAssignments.map((a) => a.district_id);

    if (userRoles.includes('FIELD_ENGINEER')) {
      const isAssigned = assignedEngineerId === userId;
      const hasDistrictAccess = schoolDistrictId && assignedDistrictIds.includes(schoolDistrictId);

      if (!isAssigned && !hasDistrictAccess) {
        return {
          clientOperationId: mutation.clientOperationId,
          status: 'CONFLICT',
          conflictCode: 'TERRITORY_ACCESS_CHANGED',
          message: `User ${userId} no longer has active territory or case assignment for entity ${mutation.entityId}.`,
          serverTimestamp: nowIso,
        };
      }
    } else if (userRoles.includes('DISTRICT_COORDINATOR')) {
      const hasDistrictAccess = schoolDistrictId && assignedDistrictIds.includes(schoolDistrictId);
      if (!hasDistrictAccess) {
        return {
          clientOperationId: mutation.clientOperationId,
          status: 'CONFLICT',
          conflictCode: 'TERRITORY_ACCESS_CHANGED',
          message: `Coordinator does not have active assignment for district ${schoolDistrictId}.`,
          serverTimestamp: nowIso,
        };
      }
    }

    return null;
  }
}

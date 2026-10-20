/**
 * ZENTRA — Conflict Arbitrator Service
 * apps/api/src/modules/sync/services/conflict-arbitrator.service.ts
 *
 * Dedicated conflict arbitration layer for offline sync mutations.
 * Enforces server authority, concurrency protection, tombstone checks,
 * and state machine transition rules without silent overwrites.
 * Supports both service_cases and field_visits domain entities.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema } from '../../../database/database.types';
import type { SyncConflictCode, SyncMutationItem, OperationalStatus, VisitStatus, ConveyanceClaimStatus } from '@zentra/types';
import { VALID_TRANSITIONS as VALID_CASE_TRANSITIONS } from '../../service-cases/services/service-case-state-machine.service';
import { VALID_VISIT_TRANSITIONS } from '../../visits/services/visits.service';

export const VALID_CLAIM_TRANSITIONS: Record<ConveyanceClaimStatus, ConveyanceClaimStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'RETURNED_FOR_CORRECTION', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'RETURNED_FOR_CORRECTION'],
  RETURNED_FOR_CORRECTION: ['SUBMITTED'],
  APPROVED: ['PAID'],
  REJECTED: [],
  PAID: [],
};

export interface ArbitrationDecision {
  isConflict: boolean;
  conflictCode?: SyncConflictCode;
  reason?: string;
}

@Injectable()
export class ConflictArbitratorService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  /**
   * Arbitrates a push mutation against server-authoritative state.
   */
  async arbitrateMutation(
    mutation: SyncMutationItem,
    serverRecord: any | null,
  ): Promise<ArbitrationDecision> {
    // 1. Tombstone check: Verify if entity was permanently tombstoned
    const tombstone = await this.db
      .selectFrom('tombstones')
      .where('entity_id', '=', mutation.entityId)
      .selectAll()
      .executeTakeFirst();

    if (tombstone) {
      return {
        isConflict: true,
        conflictCode: 'ENTITY_TOMBSTONED',
        reason: `Target entity ${mutation.entityId} was permanently tombstoned on server at ${tombstone.deleted_at}.`,
      };
    }

    // 2. INSERT operations for new entities (e.g. offline-created field visits)
    if (mutation.operationType === 'INSERT') {
      if (serverRecord) {
        // Entity already exists on server: duplicate insert / idempotency check
        return {
          isConflict: true,
          conflictCode: 'DUPLICATE_OPERATION',
          reason: `Entity ${mutation.entityId} already exists on server.`,
        };
      }
      return { isConflict: false };
    }

    // 3. Existence check for UPDATE and STATUS_TRANSITION
    if (!serverRecord) {
      return {
        isConflict: true,
        conflictCode: 'RECORD_NOT_FOUND',
        reason: `Target entity ${mutation.entityId} was not found on server.`,
      };
    }

    // 4. Inactive check (soft delete)
    if (serverRecord.is_deleted === true) {
      return {
        isConflict: true,
        conflictCode: 'RECORD_INACTIVE',
        reason: `Target entity ${mutation.entityId} is inactive / soft-deleted on server.`,
      };
    }

    // 5. Server-Authoritative Concurrency / Version conflict check
    // Concurrency is arbitrated by comparing explicit client base version against
    // the server record's current version token.
    const clientBaseVersion = mutation.clientBaseVersion ?? mutation.clientVersion;
    if (clientBaseVersion !== undefined && clientBaseVersion !== null) {
      const currentServerVersionStr = String(serverRecord.version ?? 1);
      const clientBaseVersionStr = String(clientBaseVersion);

      if (clientBaseVersionStr !== currentServerVersionStr) {
        return {
          isConflict: true,
          conflictCode: 'VERSION_CONFLICT',
          reason: `Version conflict: client mutation was based on version '${clientBaseVersionStr}', but current server version is '${currentServerVersionStr}'.`,
        };
      }
    }

    // 6. State Machine validity check for STATUS_TRANSITION
    if (mutation.operationType === 'STATUS_TRANSITION') {
      if (mutation.entityType === 'service_cases') {
        const targetStatus = (mutation.payload as any)?.toStatus as OperationalStatus;
        const currentStatus = serverRecord.operational_status as OperationalStatus;

        if (!targetStatus) {
          return {
            isConflict: true,
            conflictCode: 'SERVER_VALIDATION_FAILED',
            reason: 'Missing target status in STATUS_TRANSITION mutation payload.',
          };
        }

        if (targetStatus === currentStatus) {
          return { isConflict: false };
        }

        const allowedNext = VALID_CASE_TRANSITIONS[currentStatus] || [];
        if (!allowedNext.includes(targetStatus)) {
          return {
            isConflict: true,
            conflictCode: 'INVALID_STATE_TRANSITION',
            reason: `Invalid transition from current server status '${currentStatus}' to requested status '${targetStatus}'. Allowed: ${allowedNext.join(', ')}.`,
          };
        }
      } else if (mutation.entityType === 'field_visits') {
        const targetStatus = (mutation.payload as any)?.toStatus as VisitStatus;
        const currentStatus = serverRecord.status as VisitStatus;

        if (!targetStatus) {
          return {
            isConflict: true,
            conflictCode: 'SERVER_VALIDATION_FAILED',
            reason: 'Missing target status in field visit STATUS_TRANSITION mutation payload.',
          };
        }

        if (targetStatus === currentStatus) {
          return { isConflict: false };
        }

        const allowedNext = VALID_VISIT_TRANSITIONS[currentStatus] || [];
        if (!allowedNext.includes(targetStatus)) {
          return {
            isConflict: true,
            conflictCode: 'INVALID_STATE_TRANSITION',
            reason: `Invalid transition from current visit status '${currentStatus}' to requested status '${targetStatus}'. Allowed: ${allowedNext.join(', ')}.`,
          };
        }
      } else if (mutation.entityType === 'conveyance_claims') {
        const targetStatus = (mutation.payload as any)?.toStatus as ConveyanceClaimStatus;
        const currentStatus = (serverRecord.claim_status || serverRecord.status) as ConveyanceClaimStatus;

        if (!targetStatus) {
          return {
            isConflict: true,
            conflictCode: 'SERVER_VALIDATION_FAILED',
            reason: 'Missing target status in conveyance claim STATUS_TRANSITION mutation payload.',
          };
        }

        if (targetStatus === currentStatus) {
          return { isConflict: false };
        }

        const allowedNext = VALID_CLAIM_TRANSITIONS[currentStatus] || [];
        if (!allowedNext.includes(targetStatus)) {
          return {
            isConflict: true,
            conflictCode: 'INVALID_STATE_TRANSITION',
            reason: `Invalid transition from current claim status '${currentStatus}' to requested status '${targetStatus}'. Allowed: ${allowedNext.join(', ')}.`,
          };
        }
      }
    }

    // 7. Evidence files immutability check for UPDATE and other mutations
    if (mutation.entityType === 'evidence_files') {
      if (serverRecord.upload_status === 'FINALIZED' || serverRecord.upload_status === 'VERIFIED') {
        const payload = (mutation.payload || {}) as Record<string, unknown>;
        if (
          (payload.storagePath && payload.storagePath !== serverRecord.storage_path) ||
          (payload.fileChecksumSha256 && payload.fileChecksumSha256 !== serverRecord.file_checksum_sha256) ||
          (payload.serviceCaseId && payload.serviceCaseId !== serverRecord.service_case_id) ||
          (payload.visitId && payload.visitId !== serverRecord.visit_id)
        ) {
          return {
            isConflict: true,
            conflictCode: 'INVALID_STATE_TRANSITION',
            reason: `Finalized evidence ${mutation.entityId} is immutable. Cannot modify storage path, checksum, or case/visit lineage.`,
          };
        }
      }
    }

    // 8. Conveyance claims terminal/approved immutability check
    if (mutation.entityType === 'conveyance_claims' && serverRecord) {
      const claimStatus = serverRecord.claim_status || serverRecord.status;
      if (['APPROVED', 'PAID', 'REJECTED'].includes(claimStatus)) {
        if (mutation.operationType === 'UPDATE') {
          return {
            isConflict: true,
            conflictCode: 'INVALID_STATE_TRANSITION',
            reason: `Conveyance claim ${mutation.entityId} is in non-editable state '${claimStatus}'. Modifications prohibited.`,
          };
        }
      }
    }

    return { isConflict: false };
  }
}

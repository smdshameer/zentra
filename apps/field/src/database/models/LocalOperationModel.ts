/**
 * ZENTRA Field — Local Operation Queue Model
 * apps/field/src/database/models/LocalOperationModel.ts
 *
 * Persistent, durable transaction ledger for offline mutations.
 * Survives process kills, crashes, and device restarts.
 */

import { Model } from '@nozbe/watermelondb';
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators';

export type QueueOperationType = 'INSERT' | 'UPDATE' | 'STATUS_TRANSITION';
export type QueueOperationStatus = 'QUEUED' | 'IN_FLIGHT' | 'FAILED' | 'ACKNOWLEDGED' | 'CONFLICT';

export class LocalOperationModel extends Model {
  static table = 'local_operations';

  @text('client_operation_id') clientOperationId!: string;
  @text('entity_type') entityType!: string;
  @text('local_entity_id') localEntityId!: string;
  @text('server_entity_id') serverEntityId?: string | null;
  @text('operation_type') operationType!: QueueOperationType;
  @text('payload_json') payloadJson!: string;
  @text('base_version') baseVersion?: string | null;
  @text('status') status!: QueueOperationStatus;
  @field('retry_count') retryCount!: number;
  @date('last_attempt_at') lastAttemptAt?: Date | null;
  @text('error_message') errorMessage?: string | null;
  @text('conflict_code') conflictCode?: string | null;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;

  get isPending(): boolean {
    return this.status === 'QUEUED' || this.status === 'FAILED';
  }
}

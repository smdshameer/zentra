/**
 * ZENTRA — Field Visit Status History Repository
 * apps/api/src/modules/visits/repositories/visit-status-history.repository.ts
 *
 * Implements append-only audit tracking for field visit lifecycle transitions.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, Transaction, Selectable, Insertable } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema, FieldVisitStatusHistoryTable } from '../../../database/database.types';
import type { FieldVisitStatusHistoryEntry, VisitStatus } from '@zentra/types';

@Injectable()
export class VisitStatusHistoryRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  /**
   * Records an immutable transition entry in field_visit_status_history.
   */
  async recordTransition(
    data: Insertable<FieldVisitStatusHistoryTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<FieldVisitStatusHistoryTable>> {
    const client = trx || this.db;
    return await client
      .insertInto('field_visit_status_history')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Retrieves the full transition history for a visit.
   */
  async findByVisitId(
    visitId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<FieldVisitStatusHistoryEntry[]> {
    const client = trx || this.db;
    const rows = await client
      .selectFrom('field_visit_status_history')
      .leftJoin('users', 'users.user_id', 'field_visit_status_history.changed_by_user_id')
      .where('field_visit_status_history.visit_id', '=', visitId)
      .select([
        'field_visit_status_history.history_id',
        'field_visit_status_history.visit_id',
        'field_visit_status_history.from_status',
        'field_visit_status_history.to_status',
        'field_visit_status_history.changed_by_user_id',
        'users.full_name as changed_by_user_name',
        'field_visit_status_history.transition_reason',
        'field_visit_status_history.client_operation_id',
        'field_visit_status_history.created_at',
      ])
      .orderBy('field_visit_status_history.created_at', 'asc')
      .execute();

    return rows.map((r) => ({
      historyId: r.history_id,
      visitId: r.visit_id,
      fromStatus: r.from_status as VisitStatus,
      toStatus: r.to_status as VisitStatus,
      changedByUserId: r.changed_by_user_id || null,
      changedByUserName: r.changed_by_user_name || null,
      transitionReason: r.transition_reason || null,
      clientOperationId: r.client_operation_id || null,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}

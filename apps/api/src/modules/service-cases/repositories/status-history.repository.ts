/**
 * ZENTRA — Status History Repository
 * apps/api/src/modules/service-cases/repositories/status-history.repository.ts
 *
 * Implements append-only audit tracking for service case operational state transitions.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, Transaction, Insertable } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema, ServiceCaseStatusHistoryTable } from '../../../database/database.types';
import type { ServiceCaseStatusHistoryEntry, OperationalStatus } from '@zentra/types';

@Injectable()
export class StatusHistoryRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  async record(
    entry: Insertable<ServiceCaseStatusHistoryTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<void> {
    const client = trx || this.db;
    await client
      .insertInto('service_case_status_history')
      .values(entry)
      .execute();
  }

  async findByCaseId(
    serviceCaseId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<ServiceCaseStatusHistoryEntry[]> {
    const client = trx || this.db;
    const rows = await client
      .selectFrom('service_case_status_history')
      .leftJoin('users', 'users.user_id', 'service_case_status_history.changed_by_user_id')
      .where('service_case_status_history.service_case_id', '=', serviceCaseId)
      .select([
        'service_case_status_history.status_history_id',
        'service_case_status_history.service_case_id',
        'service_case_status_history.from_status',
        'service_case_status_history.to_status',
        'service_case_status_history.changed_by_user_id',
        'users.full_name as changed_by_user_name',
        'service_case_status_history.transition_reason',
        'service_case_status_history.created_at',
      ])
      .orderBy('service_case_status_history.created_at', 'asc')
      .execute();

    return rows.map((r) => ({
      statusHistoryId: r.status_history_id,
      serviceCaseId: r.service_case_id,
      fromStatus: r.from_status as OperationalStatus,
      toStatus: r.to_status as OperationalStatus,
      changedByUserId: r.changed_by_user_id || null,
      changedByUserName: r.changed_by_user_name || null,
      transitionReason: r.transition_reason || null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }
}

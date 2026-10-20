/**
 * ZENTRA — Assignment History Repository
 * apps/api/src/modules/service-cases/repositories/assignment-history.repository.ts
 *
 * Implements genuine append-only operational dispatch ledger.
 * Updates and Deletes are prohibited both at application and PostgreSQL trigger level.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, Transaction, Insertable } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema, AssignmentHistoryTable } from '../../../database/database.types';
import type { AssignmentHistoryEntry, AssignmentRole, AssignmentAction } from '@zentra/types';

@Injectable()
export class AssignmentHistoryRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  async record(
    entry: Insertable<AssignmentHistoryTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<void> {
    const client = trx || this.db;
    await client
      .insertInto('assignment_history')
      .values(entry)
      .execute();
  }

  async findByCaseId(
    serviceCaseId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<AssignmentHistoryEntry[]> {
    const client = trx || this.db;
    const rows = await client
      .selectFrom('assignment_history')
      .leftJoin('users as assigned_by', 'assigned_by.user_id', 'assignment_history.assigned_by_user_id')
      .leftJoin('users as engineer', 'engineer.user_id', 'assignment_history.engineer_id')
      .leftJoin('users as prev_engineer', 'prev_engineer.user_id', 'assignment_history.previous_engineer_id')
      .where('assignment_history.service_case_id', '=', serviceCaseId)
      .select([
        'assignment_history.assignment_history_id',
        'assignment_history.service_case_id',
        'assignment_history.assigned_by_user_id',
        'assigned_by.full_name as assigned_by_user_name',
        'assignment_history.engineer_id',
        'engineer.full_name as engineer_name',
        'assignment_history.assignment_role',
        'assignment_history.previous_engineer_id',
        'prev_engineer.full_name as previous_engineer_name',
        'assignment_history.action',
        'assignment_history.assigned_at',
        'assignment_history.reassignment_reason',
        'assignment_history.is_emergency_cross_district',
        'assignment_history.emergency_justification',
        'assignment_history.created_at',
      ])
      .orderBy('assignment_history.created_at', 'asc')
      .execute();

    return rows.map((r) => ({
      assignmentHistoryId: r.assignment_history_id,
      serviceCaseId: r.service_case_id,
      assignedByUserId: r.assigned_by_user_id || null,
      assignedByUserName: r.assigned_by_user_name || null,
      engineerId: r.engineer_id,
      engineerName: r.engineer_name || null,
      assignmentRole: (r.assignment_role as AssignmentRole) || 'PRIMARY',
      previousEngineerId: r.previous_engineer_id || null,
      previousEngineerName: r.previous_engineer_name || null,
      action: (r.action as AssignmentAction) || 'ASSIGNED',
      assignedAt: r.assigned_at instanceof Date ? r.assigned_at.toISOString() : String(r.assigned_at),
      reassignmentReason: r.reassignment_reason || null,
      isEmergencyCrossDistrict: Boolean(r.is_emergency_cross_district),
      emergencyJustification: r.emergency_justification || null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }
}

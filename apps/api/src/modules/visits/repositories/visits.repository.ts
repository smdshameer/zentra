/**
 * ZENTRA — Field Visits Repository
 * apps/api/src/modules/visits/repositories/visits.repository.ts
 *
 * Provides database access for Field Visits with transactional execution,
 * sequence number generation, and deterministic filtering.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, Transaction, Selectable, Insertable, Updateable, sql } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema, FieldVisitsTable } from '../../../database/database.types';
import type { FieldVisit, FieldVisitQueryFilters } from '@zentra/types';

@Injectable()
export class VisitsRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  /**
   * Calculates the next sequence number for a service case inside a transaction.
   * Ensures deterministic, immutable sequence numbers starting at 1.
   */
  async getNextSequenceNumber(
    serviceCaseId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<number> {
    const client = trx || this.db;
    if (trx) {
      await trx
        .selectFrom('service_cases')
        .where('service_case_id', '=', serviceCaseId)
        .select(['service_case_id'])
        .forUpdate()
        .execute();
    }
    const result = await client
      .selectFrom('field_visits')
      .where('service_case_id', '=', serviceCaseId)
      .select(sql<number>`COALESCE(MAX(visit_sequence_number), 0) + 1`.as('next_seq'))
      .executeTakeFirstOrThrow();

    return Number(result.next_seq);
  }

  /**
   * Inserts a new field visit record.
   */
  async create(
    data: Insertable<FieldVisitsTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<FieldVisitsTable>> {
    const client = trx || this.db;
    return await client
      .insertInto('field_visits')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Finds a field visit by ID.
   */
  async findById(
    visitId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<FieldVisit | null> {
    const client = trx || this.db;
    const row = await client
      .selectFrom('field_visits')
      .leftJoin('users as eng', 'eng.user_id', 'field_visits.engineer_id')
      .where('field_visits.visit_id', '=', visitId)
      .where('field_visits.is_deleted', '=', false)
      .select([
        'field_visits.visit_id',
        'field_visits.service_case_id',
        'field_visits.engineer_id',
        'eng.full_name as engineer_name',
        'field_visits.visit_sequence_number',
        'field_visits.visit_date',
        'field_visits.status',
        'field_visits.check_in_timestamp',
        'field_visits.check_in_at_device',
        'field_visits.check_in_at_server',
        'field_visits.check_in_latitude',
        'field_visits.check_in_longitude',
        'field_visits.check_in_accuracy_meters',
        'field_visits.check_in_distance_meters',
        'field_visits.check_in_within_geofence',
        'field_visits.equipment_condition_observed',
        'field_visits.on_site_diagnosis',
        'field_visits.work_performed',
        'field_visits.visit_outcome',
        'field_visits.pending_reason_text',
        'field_visits.target_next_visit_date',
        'field_visits.check_out_timestamp',
        'field_visits.check_out_at_device',
        'field_visits.check_out_at_server',
        'field_visits.check_out_latitude',
        'field_visits.check_out_longitude',
        'field_visits.check_out_accuracy_meters',
        'field_visits.notes',
        'field_visits.version',
        'field_visits.client_operation_id',
        'field_visits.is_deleted',
        'field_visits.created_at',
        'field_visits.updated_at',
      ])
      .executeTakeFirst();

    if (!row) return null;
    return this.mapToFieldVisit(row);
  }

  /**
   * Finds all visits belonging to a service case, ordered by visit_sequence_number ascending.
   */
  async findByCaseId(
    serviceCaseId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<FieldVisit[]> {
    const client = trx || this.db;
    const rows = await client
      .selectFrom('field_visits')
      .leftJoin('users as eng', 'eng.user_id', 'field_visits.engineer_id')
      .where('field_visits.service_case_id', '=', serviceCaseId)
      .where('field_visits.is_deleted', '=', false)
      .select([
        'field_visits.visit_id',
        'field_visits.service_case_id',
        'field_visits.engineer_id',
        'eng.full_name as engineer_name',
        'field_visits.visit_sequence_number',
        'field_visits.visit_date',
        'field_visits.status',
        'field_visits.check_in_timestamp',
        'field_visits.check_in_at_device',
        'field_visits.check_in_at_server',
        'field_visits.check_in_latitude',
        'field_visits.check_in_longitude',
        'field_visits.check_in_accuracy_meters',
        'field_visits.check_in_distance_meters',
        'field_visits.check_in_within_geofence',
        'field_visits.equipment_condition_observed',
        'field_visits.on_site_diagnosis',
        'field_visits.work_performed',
        'field_visits.visit_outcome',
        'field_visits.pending_reason_text',
        'field_visits.target_next_visit_date',
        'field_visits.check_out_timestamp',
        'field_visits.check_out_at_device',
        'field_visits.check_out_at_server',
        'field_visits.check_out_latitude',
        'field_visits.check_out_longitude',
        'field_visits.check_out_accuracy_meters',
        'field_visits.notes',
        'field_visits.version',
        'field_visits.client_operation_id',
        'field_visits.is_deleted',
        'field_visits.created_at',
        'field_visits.updated_at',
      ])
      .orderBy('field_visits.visit_sequence_number', 'asc')
      .execute();

    return rows.map((r) => this.mapToFieldVisit(r));
  }

  /**
   * Queries field visits matching filter criteria.
   */
  async queryVisits(
    filters: FieldVisitQueryFilters,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<{ data: FieldVisit[]; total: number }> {
    const client = trx || this.db;
    let query = client
      .selectFrom('field_visits')
      .leftJoin('users as eng', 'eng.user_id', 'field_visits.engineer_id')
      .where('field_visits.is_deleted', '=', false);

    if (filters.serviceCaseId) {
      query = query.where('field_visits.service_case_id', '=', filters.serviceCaseId);
    }
    if (filters.engineerId) {
      query = query.where('field_visits.engineer_id', '=', filters.engineerId);
    }
    if (filters.status) {
      query = query.where('field_visits.status', '=', filters.status);
    }
    if (filters.outcome) {
      query = query.where('field_visits.visit_outcome', '=', filters.outcome);
    }

    const countResult = await query
      .select(sql<number>`count(*)`.as('total'))
      .executeTakeFirst();
    const total = Number(countResult?.total ?? 0);

    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const rows = await query
      .select([
        'field_visits.visit_id',
        'field_visits.service_case_id',
        'field_visits.engineer_id',
        'eng.full_name as engineer_name',
        'field_visits.visit_sequence_number',
        'field_visits.visit_date',
        'field_visits.status',
        'field_visits.check_in_timestamp',
        'field_visits.check_in_at_device',
        'field_visits.check_in_at_server',
        'field_visits.check_in_latitude',
        'field_visits.check_in_longitude',
        'field_visits.check_in_accuracy_meters',
        'field_visits.check_in_distance_meters',
        'field_visits.check_in_within_geofence',
        'field_visits.equipment_condition_observed',
        'field_visits.on_site_diagnosis',
        'field_visits.work_performed',
        'field_visits.visit_outcome',
        'field_visits.pending_reason_text',
        'field_visits.target_next_visit_date',
        'field_visits.check_out_timestamp',
        'field_visits.check_out_at_device',
        'field_visits.check_out_at_server',
        'field_visits.check_out_latitude',
        'field_visits.check_out_longitude',
        'field_visits.check_out_accuracy_meters',
        'field_visits.notes',
        'field_visits.version',
        'field_visits.client_operation_id',
        'field_visits.is_deleted',
        'field_visits.created_at',
        'field_visits.updated_at',
      ])
      .orderBy('field_visits.visit_date', 'desc')
      .orderBy('field_visits.visit_sequence_number', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return {
      data: rows.map((r) => this.mapToFieldVisit(r)),
      total,
    };
  }

  /**
   * Updates a field visit and increments version.
   */
  async update(
    visitId: string,
    data: Updateable<FieldVisitsTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<FieldVisitsTable>> {
    const client = trx || this.db;
    return await client
      .updateTable('field_visits')
      .set({
        ...data,
        updated_at: new Date(),
      })
      .where('visit_id', '=', visitId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private mapToFieldVisit(row: any): FieldVisit {
    return {
      visitId: row.visit_id,
      serviceCaseId: row.service_case_id,
      engineerId: row.engineer_id,
      engineerName: row.engineer_name || null,
      visitSequenceNumber: Number(row.visit_sequence_number),
      visitDate: row.visit_date instanceof Date ? row.visit_date.toISOString().split('T')[0]! : String(row.visit_date),
      status: row.status as any,
      checkInTimestamp: row.check_in_timestamp ? new Date(row.check_in_timestamp).toISOString() : null,
      checkInAtDevice: row.check_in_at_device ? new Date(row.check_in_at_device).toISOString() : null,
      checkInAtServer: row.check_in_at_server ? new Date(row.check_in_at_server).toISOString() : null,
      checkInLatitude: row.check_in_latitude !== null ? Number(row.check_in_latitude) : null,
      checkInLongitude: row.check_in_longitude !== null ? Number(row.check_in_longitude) : null,
      checkInAccuracyMeters: row.check_in_accuracy_meters !== null ? Number(row.check_in_accuracy_meters) : null,
      checkInDistanceMeters: row.check_in_distance_meters !== null ? Number(row.check_in_distance_meters) : null,
      checkInWithinGeofence: row.check_in_within_geofence !== null ? Boolean(row.check_in_within_geofence) : null,
      equipmentConditionObserved: row.equipment_condition_observed || null,
      onSiteDiagnosis: row.on_site_diagnosis || null,
      workPerformed: row.work_performed || null,
      visitOutcome: row.visit_outcome as any,
      pendingReasonText: row.pending_reason_text || null,
      targetNextVisitDate: row.target_next_visit_date instanceof Date ? row.target_next_visit_date.toISOString().split('T')[0]! : (row.target_next_visit_date ? String(row.target_next_visit_date) : null),
      checkOutTimestamp: row.check_out_timestamp ? new Date(row.check_out_timestamp).toISOString() : null,
      checkOutAtDevice: row.check_out_at_device ? new Date(row.check_out_at_device).toISOString() : null,
      checkOutAtServer: row.check_out_at_server ? new Date(row.check_out_at_server).toISOString() : null,
      checkOutLatitude: row.check_out_latitude !== null ? Number(row.check_out_latitude) : null,
      checkOutLongitude: row.check_out_longitude !== null ? Number(row.check_out_longitude) : null,
      checkOutAccuracyMeters: row.check_out_accuracy_meters !== null ? Number(row.check_out_accuracy_meters) : null,
      notes: row.notes || null,
      version: Number(row.version ?? 1),
      clientOperationId: row.client_operation_id || null,
      isDeleted: Boolean(row.is_deleted),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

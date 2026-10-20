/**
 * ZENTRA — Service Cases Repository
 * apps/api/src/modules/service-cases/repositories/service-cases.repository.ts
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, Transaction, Selectable, Insertable, Updateable } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema, ServiceCasesTable } from '../../../database/database.types';
import type { ServiceCase, ServiceCaseQueryFilters } from '@zentra/types';

@Injectable()
export class ServiceCasesRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  async create(
    data: Insertable<ServiceCasesTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<ServiceCasesTable>> {
    const client = trx || this.db;
    return await client
      .insertInto('service_cases')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(
    serviceCaseId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<ServiceCase | null> {
    const client = trx || this.db;
    const row = await client
      .selectFrom('service_cases')
      .leftJoin('schools', 'schools.school_id', 'service_cases.school_id')
      .leftJoin('districts', 'districts.district_id', 'schools.district_id')
      .leftJoin('hi_tech_labs', 'hi_tech_labs.lab_id', 'service_cases.lab_id')
      .leftJoin('users as primary_eng', 'primary_eng.user_id', 'service_cases.assigned_primary_engineer_id')
      .leftJoin('users as sec_eng', 'sec_eng.user_id', 'service_cases.assigned_secondary_engineer_id')
      .where('service_cases.service_case_id', '=', serviceCaseId)
      .where('service_cases.is_deleted', '=', false)
      .select([
        'service_cases.service_case_id',
        'service_cases.source_complaint_id',
        'service_cases.zentra_case_code',
        'service_cases.school_id',
        'schools.school_name as school_name',
        'schools.udise_code as udise_code',
        'schools.district_id as district_id',
        'districts.district_name as district_name',
        'service_cases.lab_id',
        'hi_tech_labs.lab_code as lab_code',
        'service_cases.lab_equipment_id',
        'service_cases.operational_status',
        'service_cases.internal_priority',
        'service_cases.assigned_primary_engineer_id',
        'primary_eng.full_name as primary_engineer_name',
        'service_cases.assigned_secondary_engineer_id',
        'sec_eng.full_name as secondary_engineer_name',
        'service_cases.assigned_at',
        'service_cases.sla_policy_id',
        'service_cases.sla_target_at',
        'service_cases.sla_breach_status',
        'service_cases.actual_diagnosis_summary',
        'service_cases.actual_action_taken_summary',
        'service_cases.verification_status',
        'service_cases.verified_by_user_id',
        'service_cases.resolved_at',
        'service_cases.closed_at',
        'service_cases.is_deleted',
        'service_cases.created_at',
        'service_cases.updated_at',
      ])
      .executeTakeFirst();

    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByCaseCode(
    caseCode: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<ServiceCase | null> {
    const client = trx || this.db;
    const row = await client
      .selectFrom('service_cases')
      .where('service_cases.zentra_case_code', '=', caseCode)
      .where('service_cases.is_deleted', '=', false)
      .selectAll()
      .executeTakeFirst();

    if (!row) return null;
    return this.findById(row.service_case_id, trx);
  }

  async findBySourceComplaintId(
    sourceComplaintId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<ServiceCasesTable> | null> {
    const client = trx || this.db;
    const row = await client
      .selectFrom('service_cases')
      .where('service_cases.source_complaint_id', '=', sourceComplaintId)
      .selectAll()
      .executeTakeFirst();
    return row || null;
  }

  async update(
    serviceCaseId: string,
    updates: Updateable<ServiceCasesTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<ServiceCasesTable>> {
    const client = trx || this.db;
    return await client
      .updateTable('service_cases')
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where('service_case_id', '=', serviceCaseId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateStatus(
    serviceCaseId: string,
    status: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<void> {
    const client = trx || this.db;
    await client
      .updateTable('service_cases')
      .set({
        operational_status: status,
        updated_at: new Date(),
      })
      .where('service_case_id', '=', serviceCaseId)
      .execute();
  }

  async findPaginated(
    filters: ServiceCaseQueryFilters,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<ServiceCase[]> {
    const client = trx || this.db;
    let query = client
      .selectFrom('service_cases')
      .leftJoin('schools', 'schools.school_id', 'service_cases.school_id')
      .leftJoin('districts', 'districts.district_id', 'schools.district_id')
      .leftJoin('hi_tech_labs', 'hi_tech_labs.lab_id', 'service_cases.lab_id')
      .leftJoin('users as primary_eng', 'primary_eng.user_id', 'service_cases.assigned_primary_engineer_id')
      .leftJoin('users as sec_eng', 'sec_eng.user_id', 'service_cases.assigned_secondary_engineer_id')
      .where('service_cases.is_deleted', '=', false);

    if (filters.districtId) {
      query = query.where('schools.district_id', '=', filters.districtId);
    }
    if (filters.blockId) {
      query = query.where('schools.block_id', '=', filters.blockId);
    }
    if (filters.schoolId) {
      query = query.where('service_cases.school_id', '=', filters.schoolId);
    }
    if (filters.labId) {
      query = query.where('service_cases.lab_id', '=', filters.labId);
    }
    if (filters.operationalStatus) {
      query = query.where('service_cases.operational_status', '=', filters.operationalStatus);
    }
    if (filters.internalPriority) {
      query = query.where('service_cases.internal_priority', '=', filters.internalPriority);
    }
    if (filters.assignedEngineerId) {
      const engId = filters.assignedEngineerId;
      query = query.where((eb) =>
        eb.or([
          eb('service_cases.assigned_primary_engineer_id', '=', engId),
          eb('service_cases.assigned_secondary_engineer_id', '=', engId),
        ]),
      );
    }
    if (filters.slaBreachStatus) {
      query = query.where('service_cases.sla_breach_status', '=', filters.slaBreachStatus);
    }
    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('service_cases.zentra_case_code', 'ilike', term),
          eb('schools.school_name', 'ilike', term),
          eb('schools.udise_code', 'ilike', term),
        ]),
      );
    }

    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? filters.limit : 20;
    const offset = (page - 1) * limit;

    const rows = await query
      .select([
        'service_cases.service_case_id',
        'service_cases.source_complaint_id',
        'service_cases.zentra_case_code',
        'service_cases.school_id',
        'schools.school_name as school_name',
        'schools.udise_code as udise_code',
        'schools.district_id as district_id',
        'districts.district_name as district_name',
        'service_cases.lab_id',
        'hi_tech_labs.lab_code as lab_code',
        'service_cases.lab_equipment_id',
        'service_cases.operational_status',
        'service_cases.internal_priority',
        'service_cases.assigned_primary_engineer_id',
        'primary_eng.full_name as primary_engineer_name',
        'service_cases.assigned_secondary_engineer_id',
        'sec_eng.full_name as secondary_engineer_name',
        'service_cases.assigned_at',
        'service_cases.sla_policy_id',
        'service_cases.sla_target_at',
        'service_cases.sla_breach_status',
        'service_cases.actual_diagnosis_summary',
        'service_cases.actual_action_taken_summary',
        'service_cases.verification_status',
        'service_cases.verified_by_user_id',
        'service_cases.resolved_at',
        'service_cases.closed_at',
        'service_cases.is_deleted',
        'service_cases.created_at',
        'service_cases.updated_at',
      ])
      .orderBy('service_cases.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return rows.map((r) => this.mapToDomain(r));
  }

  async count(
    filters: ServiceCaseQueryFilters,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<number> {
    const client = trx || this.db;
    let query = client
      .selectFrom('service_cases')
      .leftJoin('schools', 'schools.school_id', 'service_cases.school_id')
      .where('service_cases.is_deleted', '=', false);

    if (filters.districtId) {
      query = query.where('schools.district_id', '=', filters.districtId);
    }
    if (filters.blockId) {
      query = query.where('schools.block_id', '=', filters.blockId);
    }
    if (filters.schoolId) {
      query = query.where('service_cases.school_id', '=', filters.schoolId);
    }
    if (filters.labId) {
      query = query.where('service_cases.lab_id', '=', filters.labId);
    }
    if (filters.operationalStatus) {
      query = query.where('service_cases.operational_status', '=', filters.operationalStatus);
    }
    if (filters.internalPriority) {
      query = query.where('service_cases.internal_priority', '=', filters.internalPriority);
    }
    if (filters.assignedEngineerId) {
      const engId = filters.assignedEngineerId;
      query = query.where((eb) =>
        eb.or([
          eb('service_cases.assigned_primary_engineer_id', '=', engId),
          eb('service_cases.assigned_secondary_engineer_id', '=', engId),
        ]),
      );
    }
    if (filters.slaBreachStatus) {
      query = query.where('service_cases.sla_breach_status', '=', filters.slaBreachStatus);
    }
    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('service_cases.zentra_case_code', 'ilike', term),
          eb('schools.school_name', 'ilike', term),
          eb('schools.udise_code', 'ilike', term),
        ]),
      );
    }

    const res = await query
      .select((eb) => eb.fn.count<string>('service_cases.service_case_id').as('count'))
      .executeTakeFirst();
    return Number(res?.count || 0);
  }

  async findCases(
    filters: ServiceCaseQueryFilters,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<{
    items: ServiceCase[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  }> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? filters.limit : 20;

    const [items, total] = await Promise.all([
      this.findPaginated(filters, trx),
      this.count(filters, trx),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items,
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  async countActiveCasesByEngineer(
    engineerId: string,
    activeStatuses?: string[],
    trx?: Transaction<DatabaseSchema>,
  ): Promise<number> {
    const client = trx || this.db;
    let query = client
      .selectFrom('service_cases')
      .where('is_deleted', '=', false)
      .where((eb) =>
        eb.or([
          eb('assigned_primary_engineer_id', '=', engineerId),
          eb('assigned_secondary_engineer_id', '=', engineerId),
        ]),
      );

    if (activeStatuses && activeStatuses.length > 0) {
      query = query.where('operational_status', 'in', activeStatuses);
    } else {
      query = query.where('operational_status', 'not in', ['RESOLVED', 'VERIFIED', 'CLOSED']);
    }

    const res = await query
      .select((eb) => eb.fn.count<string>('service_case_id').as('count'))
      .executeTakeFirst();
    return Number(res?.count || 0);
  }

  private mapToDomain(row: any): ServiceCase {
    return {
      serviceCaseId: row.service_case_id,
      sourceComplaintId: row.source_complaint_id,
      zentraCaseCode: row.zentra_case_code,
      schoolId: row.school_id,
      schoolName: row.school_name || undefined,
      udiseCode: row.udise_code || undefined,
      districtId: row.district_id || undefined,
      districtName: row.district_name || undefined,
      labId: row.lab_id,
      labCode: row.lab_code || undefined,
      labEquipmentId: row.lab_equipment_id || null,
      operationalStatus: row.operational_status as any,
      internalPriority: row.internal_priority as any,
      assignedPrimaryEngineerId: row.assigned_primary_engineer_id || null,
      primaryEngineerName: row.primary_engineer_name || null,
      assignedSecondaryEngineerId: row.assigned_secondary_engineer_id || null,
      secondaryEngineerName: row.secondary_engineer_name || null,
      assignedAt: row.assigned_at instanceof Date ? row.assigned_at.toISOString() : (row.assigned_at ? String(row.assigned_at) : null),
      slaPolicyId: row.sla_policy_id || null,
      slaTargetAt: row.sla_target_at instanceof Date ? row.sla_target_at.toISOString() : (row.sla_target_at ? String(row.sla_target_at) : null),
      slaBreachStatus: row.sla_breach_status as any,
      actualDiagnosisSummary: row.actual_diagnosis_summary || null,
      actualActionTakenSummary: row.actual_action_taken_summary || null,
      verificationStatus: row.verification_status as any,
      verifiedByUserId: row.verified_by_user_id || null,
      resolvedAt: row.resolved_at instanceof Date ? row.resolved_at.toISOString() : (row.resolved_at ? String(row.resolved_at) : null),
      closedAt: row.closed_at instanceof Date ? row.closed_at.toISOString() : (row.closed_at ? String(row.closed_at) : null),
      isDeleted: row.is_deleted,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }
}

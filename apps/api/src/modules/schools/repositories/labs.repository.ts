/**
 * ZENTRA — Hi-Tech Labs Repository
 * apps/api/src/modules/schools/repositories/labs.repository.ts
 */

import { Injectable, Inject } from '@nestjs/common';
import {
  Kysely,
  type Transaction,
  type Selectable,
  type Insertable,
  type Updateable,
  sql,
} from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema, HiTechLabsTable } from '../../../database/database.types';

@Injectable()
export class LabsRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  private getExecutor(trx?: Transaction<DatabaseSchema>): Kysely<DatabaseSchema> | Transaction<DatabaseSchema> {
    return trx || this.db;
  }

  async findById(
    labId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<HiTechLabsTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('hi_tech_labs')
      .selectAll()
      .where('lab_id', '=', labId)
      .executeTakeFirst();
  }

  async findBySchoolId(
    schoolId: string,
    options?: { activeOnly?: boolean },
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<HiTechLabsTable>[]> {
    const executor = this.getExecutor(trx);
    let query = executor
      .selectFrom('hi_tech_labs')
      .selectAll()
      .where('school_id', '=', schoolId)
      .orderBy('lab_code', 'asc');

    if (options?.activeOnly) {
      query = query.where('is_active', '=', true);
    }

    return await query.execute();
  }

  async findBySchoolAndCode(
    schoolId: string,
    labCode: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<HiTechLabsTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('hi_tech_labs')
      .selectAll()
      .where('school_id', '=', schoolId)
      .where('lab_code', '=', labCode.trim())
      .executeTakeFirst();
  }

  async create(
    data: Insertable<HiTechLabsTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<HiTechLabsTable>> {
    const executor = this.getExecutor(trx);
    return await executor
      .insertInto('hi_tech_labs')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    labId: string,
    data: Updateable<HiTechLabsTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<HiTechLabsTable>> {
    const executor = this.getExecutor(trx);
    return await executor
      .updateTable('hi_tech_labs')
      .set({
        ...data,
        updated_at: new Date(),
      })
      .where('lab_id', '=', labId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async softDelete(
    labId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<HiTechLabsTable>> {
    return await this.update(labId, { is_active: false }, trx);
  }

  async countBySchool(
    schoolId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<number> {
    const executor = this.getExecutor(trx);
    const result = await executor
      .selectFrom('hi_tech_labs')
      .select(sql<number>`COUNT(*)::int`.as('count'))
      .where('school_id', '=', schoolId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    return result?.count ?? 0;
  }

  async exists(
    labId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<boolean> {
    const executor = this.getExecutor(trx);
    const result = await executor
      .selectFrom('hi_tech_labs')
      .select('lab_id')
      .where('lab_id', '=', labId)
      .executeTakeFirst();
    return Boolean(result);
  }
}

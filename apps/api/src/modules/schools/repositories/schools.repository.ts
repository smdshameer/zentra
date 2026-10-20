/**
 * ZENTRA — Schools Repository
 * apps/api/src/modules/schools/repositories/schools.repository.ts
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
import type { DatabaseSchema, SchoolsTable } from '../../../database/database.types';

export interface SchoolListFilters {
  districtId?: string;
  blockId?: string;
  udiseCode?: string;
  search?: string;
  isActive?: boolean;
  page: number;
  limit: number;
}

@Injectable()
export class SchoolsRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  private getExecutor(trx?: Transaction<DatabaseSchema>): Kysely<DatabaseSchema> | Transaction<DatabaseSchema> {
    return trx || this.db;
  }

  async findById(
    schoolId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<SchoolsTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('schools')
      .selectAll()
      .where('school_id', '=', schoolId)
      .executeTakeFirst();
  }

  async findByUdise(
    udiseCode: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<SchoolsTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('schools')
      .selectAll()
      .where('udise_code', '=', udiseCode)
      .executeTakeFirst();
  }

  async findMany(
    filters: SchoolListFilters,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<SchoolsTable>[]> {
    const executor = this.getExecutor(trx);
    let query = executor.selectFrom('schools').selectAll();

    if (filters.districtId) {
      query = query.where('district_id', '=', filters.districtId);
    }
    if (filters.blockId) {
      query = query.where('block_id', '=', filters.blockId);
    }
    if (filters.udiseCode) {
      query = query.where('udise_code', '=', filters.udiseCode);
    }
    if (filters.isActive !== undefined) {
      query = query.where('is_active', '=', filters.isActive);
    }
    if (filters.search) {
      const term = `%${filters.search.trim().toLowerCase()}%`;
      query = query.where((eb) =>
        eb.or([
          sql<boolean>`LOWER(school_name) LIKE ${term}`,
          sql<boolean>`udise_code LIKE ${term}`,
        ]),
      );
    }

    const offset = (filters.page - 1) * filters.limit;
    return await query
      .orderBy('school_name', 'asc')
      .limit(filters.limit)
      .offset(offset)
      .execute();
  }

  async count(
    filters: Omit<SchoolListFilters, 'page' | 'limit'>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<number> {
    const executor = this.getExecutor(trx);
    let query = executor.selectFrom('schools').select(sql<number>`COUNT(*)::int`.as('count'));

    if (filters.districtId) {
      query = query.where('district_id', '=', filters.districtId);
    }
    if (filters.blockId) {
      query = query.where('block_id', '=', filters.blockId);
    }
    if (filters.udiseCode) {
      query = query.where('udise_code', '=', filters.udiseCode);
    }
    if (filters.isActive !== undefined) {
      query = query.where('is_active', '=', filters.isActive);
    }
    if (filters.search) {
      const term = `%${filters.search.trim().toLowerCase()}%`;
      query = query.where((eb) =>
        eb.or([
          sql<boolean>`LOWER(school_name) LIKE ${term}`,
          sql<boolean>`udise_code LIKE ${term}`,
        ]),
      );
    }

    const result = await query.executeTakeFirst();
    return result?.count ?? 0;
  }

  async create(
    data: Insertable<SchoolsTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<SchoolsTable>> {
    const executor = this.getExecutor(trx);
    return await executor
      .insertInto('schools')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    schoolId: string,
    data: Updateable<SchoolsTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<SchoolsTable>> {
    const executor = this.getExecutor(trx);
    return await executor
      .updateTable('schools')
      .set({
        ...data,
        updated_at: new Date(),
      })
      .where('school_id', '=', schoolId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async softDelete(
    schoolId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<SchoolsTable>> {
    return await this.update(schoolId, { is_active: false }, trx);
  }

  async exists(
    schoolId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<boolean> {
    const executor = this.getExecutor(trx);
    const result = await executor
      .selectFrom('schools')
      .select('school_id')
      .where('school_id', '=', schoolId)
      .executeTakeFirst();
    return Boolean(result);
  }
}

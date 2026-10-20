/**
 * ZENTRA — OEM Manufacturers Repository
 * apps/api/src/modules/equipment/repositories/oems.repository.ts
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
import type { DatabaseSchema, OemManufacturersTable } from '../../../database/database.types';

@Injectable()
export class OemsRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  private getExecutor(
    trx?: Transaction<DatabaseSchema>,
  ): Kysely<DatabaseSchema> | Transaction<DatabaseSchema> {
    return trx || this.db;
  }

  async findAll(
    options?: { activeOnly?: boolean; search?: string },
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<OemManufacturersTable>[]> {
    const executor = this.getExecutor(trx);
    let query = executor
      .selectFrom('oem_manufacturers')
      .selectAll()
      .orderBy('oem_name', 'asc');

    if (options?.activeOnly) {
      query = query.where('is_active', '=', true);
    }

    if (options?.search) {
      const term = `%${options.search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb('oem_name', 'ilike', term),
          eb('oem_code', 'ilike', term),
        ]),
      );
    }

    return await query.execute();
  }

  async findById(
    oemId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<OemManufacturersTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('oem_manufacturers')
      .selectAll()
      .where('oem_id', '=', oemId)
      .executeTakeFirst();
  }

  async findByName(
    oemName: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<OemManufacturersTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('oem_manufacturers')
      .selectAll()
      .where(sql`lower(oem_name)`, '=', oemName.trim().toLowerCase())
      .executeTakeFirst();
  }

  async findByCode(
    oemCode: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<OemManufacturersTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('oem_manufacturers')
      .selectAll()
      .where(sql`lower(oem_code)`, '=', oemCode.trim().toLowerCase())
      .executeTakeFirst();
  }

  async create(
    data: Insertable<OemManufacturersTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<OemManufacturersTable>> {
    const executor = this.getExecutor(trx);
    return await executor
      .insertInto('oem_manufacturers')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    oemId: string,
    data: Updateable<OemManufacturersTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<OemManufacturersTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .updateTable('oem_manufacturers')
      .set({
        ...data,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where('oem_id', '=', oemId)
      .returningAll()
      .executeTakeFirst();
  }

  async softDelete(
    oemId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<OemManufacturersTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .updateTable('oem_manufacturers')
      .set({
        is_active: false,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where('oem_id', '=', oemId)
      .returningAll()
      .executeTakeFirst();
  }
}

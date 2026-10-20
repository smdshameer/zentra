/**
 * ZENTRA — Equipment Types Repository
 * apps/api/src/modules/equipment/repositories/equipment-types.repository.ts
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
import type { DatabaseSchema, EquipmentTypesTable } from '../../../database/database.types';

@Injectable()
export class EquipmentTypesRepository {
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
  ): Promise<Selectable<EquipmentTypesTable>[]> {
    const executor = this.getExecutor(trx);
    let query = executor
      .selectFrom('equipment_types')
      .selectAll()
      .orderBy('type_name', 'asc');

    if (options?.activeOnly) {
      query = query.where('is_active', '=', true);
    }

    if (options?.search) {
      const term = `%${options.search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb('type_name', 'ilike', term),
          eb('type_code', 'ilike', term),
          eb('description', 'ilike', term),
        ]),
      );
    }

    return await query.execute();
  }

  async findById(
    equipmentTypeId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<EquipmentTypesTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('equipment_types')
      .selectAll()
      .where('equipment_type_id', '=', equipmentTypeId)
      .executeTakeFirst();
  }

  async findByCode(
    typeCode: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<EquipmentTypesTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('equipment_types')
      .selectAll()
      .where(sql`lower(type_code)`, '=', typeCode.trim().toLowerCase())
      .executeTakeFirst();
  }

  async create(
    data: Insertable<EquipmentTypesTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<EquipmentTypesTable>> {
    const executor = this.getExecutor(trx);
    return await executor
      .insertInto('equipment_types')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    equipmentTypeId: string,
    data: Updateable<EquipmentTypesTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<EquipmentTypesTable> | undefined> {
    const executor = this.getExecutor(trx);
    const [updated] = await executor
      .updateTable('equipment_types')
      .set({
        ...data,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where('equipment_type_id', '=', equipmentTypeId)
      .returningAll()
      .execute();

    return updated;
  }

  async softDelete(
    equipmentTypeId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<EquipmentTypesTable> | undefined> {
    const executor = this.getExecutor(trx);
    const [deleted] = await executor
      .updateTable('equipment_types')
      .set({
        is_active: false,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where('equipment_type_id', '=', equipmentTypeId)
      .returningAll()
      .execute();

    return deleted;
  }
}

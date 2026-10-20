/**
 * ZENTRA — Equipment Attribute Definitions Repository
 * apps/api/src/modules/equipment/repositories/attribute-definitions.repository.ts
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
import type { DatabaseSchema, EquipmentAttributeDefinitionsTable } from '../../../database/database.types';

@Injectable()
export class AttributeDefinitionsRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  private getExecutor(
    trx?: Transaction<DatabaseSchema>,
  ): Kysely<DatabaseSchema> | Transaction<DatabaseSchema> {
    return trx || this.db;
  }

  async findByTypeId(
    equipmentTypeId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<EquipmentAttributeDefinitionsTable>[]> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('equipment_attribute_definitions')
      .selectAll()
      .where('equipment_type_id', '=', equipmentTypeId)
      .orderBy('attribute_label', 'asc')
      .execute();
  }

  async findById(
    attributeDefId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<EquipmentAttributeDefinitionsTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('equipment_attribute_definitions')
      .selectAll()
      .where('attribute_def_id', '=', attributeDefId)
      .executeTakeFirst();
  }

  async findByTypeAndKey(
    equipmentTypeId: string,
    attributeKey: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<EquipmentAttributeDefinitionsTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('equipment_attribute_definitions')
      .selectAll()
      .where('equipment_type_id', '=', equipmentTypeId)
      .where(sql`lower(attribute_key)`, '=', attributeKey.trim().toLowerCase())
      .executeTakeFirst();
  }

  async create(
    data: Insertable<EquipmentAttributeDefinitionsTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<EquipmentAttributeDefinitionsTable>> {
    const executor = this.getExecutor(trx);
    return await executor
      .insertInto('equipment_attribute_definitions')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    attributeDefId: string,
    data: Updateable<EquipmentAttributeDefinitionsTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<EquipmentAttributeDefinitionsTable> | undefined> {
    const executor = this.getExecutor(trx);
    const [updated] = await executor
      .updateTable('equipment_attribute_definitions')
      .set({
        ...data,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where('attribute_def_id', '=', attributeDefId)
      .returningAll()
      .execute();

    return updated;
  }

  async delete(
    attributeDefId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<EquipmentAttributeDefinitionsTable> | undefined> {
    const executor = this.getExecutor(trx);
    const [deleted] = await executor
      .deleteFrom('equipment_attribute_definitions')
      .where('attribute_def_id', '=', attributeDefId)
      .returningAll()
      .execute();

    return deleted;
  }
}

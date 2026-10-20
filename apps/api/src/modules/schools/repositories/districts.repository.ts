/**
 * ZENTRA — Districts Repository
 * apps/api/src/modules/schools/repositories/districts.repository.ts
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, type Selectable } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema, DistrictsTable } from '../../../database/database.types';

@Injectable()
export class DistrictsRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  async findAll(options?: { activeOnly?: boolean }): Promise<Selectable<DistrictsTable>[]> {
    let query = this.db.selectFrom('districts').selectAll().orderBy('district_name', 'asc');

    if (options?.activeOnly) {
      query = query.where('is_active', '=', true);
    }

    return await query.execute();
  }

  async findById(districtId: string): Promise<Selectable<DistrictsTable> | undefined> {
    return await this.db
      .selectFrom('districts')
      .selectAll()
      .where('district_id', '=', districtId)
      .executeTakeFirst();
  }

  async findByCode(districtCode: string): Promise<Selectable<DistrictsTable> | undefined> {
    return await this.db
      .selectFrom('districts')
      .selectAll()
      .where('district_code', '=', districtCode.toUpperCase())
      .executeTakeFirst();
  }

  async exists(districtId: string): Promise<boolean> {
    const res = await this.db
      .selectFrom('districts')
      .select('district_id')
      .where('district_id', '=', districtId)
      .executeTakeFirst();
    return Boolean(res);
  }
}

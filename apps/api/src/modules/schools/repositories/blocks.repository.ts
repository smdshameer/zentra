/**
 * ZENTRA — Blocks Repository
 * apps/api/src/modules/schools/repositories/blocks.repository.ts
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, type Selectable } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema, BlocksTable } from '../../../database/database.types';

@Injectable()
export class BlocksRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  async findById(blockId: string): Promise<Selectable<BlocksTable> | undefined> {
    return await this.db
      .selectFrom('blocks')
      .selectAll()
      .where('block_id', '=', blockId)
      .executeTakeFirst();
  }

  async findByDistrictId(
    districtId: string,
    options?: { activeOnly?: boolean },
  ): Promise<Selectable<BlocksTable>[]> {
    let query = this.db
      .selectFrom('blocks')
      .selectAll()
      .where('district_id', '=', districtId)
      .orderBy('block_name', 'asc');

    if (options?.activeOnly) {
      query = query.where('is_active', '=', true);
    }

    return await query.execute();
  }

  async findByCode(districtId: string, blockCode: string): Promise<Selectable<BlocksTable> | undefined> {
    return await this.db
      .selectFrom('blocks')
      .selectAll()
      .where('district_id', '=', districtId)
      .where('block_code', '=', blockCode.toUpperCase())
      .executeTakeFirst();
  }

  async exists(blockId: string): Promise<boolean> {
    const res = await this.db
      .selectFrom('blocks')
      .select('block_id')
      .where('block_id', '=', blockId)
      .executeTakeFirst();
    return Boolean(res);
  }

  async belongsToDistrict(blockId: string, districtId: string): Promise<boolean> {
    const res = await this.db
      .selectFrom('blocks')
      .select('block_id')
      .where('block_id', '=', blockId)
      .where('district_id', '=', districtId)
      .executeTakeFirst();
    return Boolean(res);
  }
}

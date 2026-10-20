/**
 * ZENTRA Field — Block Local Model
 * apps/field/src/database/models/BlockModel.ts
 */

import { Model } from '@nozbe/watermelondb';
import { text, date, readonly } from '@nozbe/watermelondb/decorators';

export class BlockModel extends Model {
  static table = 'blocks';

  @text('server_id') serverId!: string;
  @text('district_id') districtId!: string;
  @text('block_code') blockCode!: string;
  @text('block_name') blockName!: string;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}

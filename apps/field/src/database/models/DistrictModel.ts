/**
 * ZENTRA Field — District Local Model
 * apps/field/src/database/models/DistrictModel.ts
 */

import { Model } from '@nozbe/watermelondb';
import { text, date, readonly } from '@nozbe/watermelondb/decorators';

export class DistrictModel extends Model {
  static table = 'districts';

  @text('server_id') serverId!: string;
  @text('district_code') districtCode!: string;
  @text('district_name') districtName!: string;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}

/**
 * ZENTRA Field — School Master Dossier Local Model
 * apps/field/src/database/models/SchoolModel.ts
 */

import { Model } from '@nozbe/watermelondb';
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators';

export class SchoolModel extends Model {
  static table = 'schools';

  @text('server_id') serverId!: string;
  @text('udise_code') udiseCode!: string;
  @text('district_id') districtId!: string;
  @text('block_id') blockId!: string;
  @text('school_name') schoolName!: string;
  @text('category') category!: string;
  @field('latitude') latitude?: number | null;
  @field('longitude') longitude?: number | null;
  @text('headmaster_name') headmasterName?: string | null;
  @text('headmaster_phone') headmasterPhone?: string | null;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}

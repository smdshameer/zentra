/**
 * ZENTRA Field — Hi-Tech Lab Local Model
 * apps/field/src/database/models/HiTechLabModel.ts
 */

import { Model } from '@nozbe/watermelondb';
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators';

export class HiTechLabModel extends Model {
  static table = 'hi_tech_labs';

  @text('server_id') serverId!: string;
  @text('school_id') schoolId!: string;
  @text('lab_type') labType!: string;
  @text('room_number') roomNumber?: string | null;
  @field('total_systems') totalSystems!: number;
  @field('is_functional') isFunctional!: boolean;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}

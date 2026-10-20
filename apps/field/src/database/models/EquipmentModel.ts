/**
 * ZENTRA Field — Equipment Local Model
 * apps/field/src/database/models/EquipmentModel.ts
 */

import { Model } from '@nozbe/watermelondb';
import { text, date, readonly } from '@nozbe/watermelondb/decorators';

export class EquipmentModel extends Model {
  static table = 'equipment';

  @text('server_id') serverId!: string;
  @text('lab_id') labId!: string;
  @text('equipment_type_id') equipmentTypeId!: string;
  @text('equipment_type_name') equipmentTypeName!: string;
  @text('serial_number') serialNumber!: string;
  @text('oem_name') oemName!: string;
  @text('model_number') modelNumber!: string;
  @text('functional_status') functionalStatus!: string;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}

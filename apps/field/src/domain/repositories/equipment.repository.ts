/**
 * ZENTRA Field — Equipment Local Repository
 * apps/field/src/domain/repositories/equipment.repository.ts
 *
 * Implements offline caching and queries for lab hardware equipment inventory.
 */

import { Database, Q } from '@nozbe/watermelondb';
import { EquipmentModel } from '../../database/models/EquipmentModel';
import type { LabEquipment } from '@zentra/types';

export class EquipmentRepository {
  constructor(private readonly database: Database) {}

  async findById(id: string): Promise<EquipmentModel | null> {
    try {
      return await this.database.get<EquipmentModel>('equipment').find(id);
    } catch {
      return null;
    }
  }

  async findByServerId(serverId: string): Promise<EquipmentModel | null> {
    const records = await this.database
      .get<EquipmentModel>('equipment')
      .query(Q.where('server_id', serverId))
      .fetch();
    return records[0] || null;
  }

  async findByLabId(labId: string): Promise<EquipmentModel[]> {
    return await this.database
      .get<EquipmentModel>('equipment')
      .query(Q.where('lab_id', labId))
      .fetch();
  }

  async upsertEquipmentFromServer(items: LabEquipment[]): Promise<EquipmentModel[]> {
    return await this.database.write(async () => {
      const results: EquipmentModel[] = [];

      for (const item of items) {
        const existing = await this.findByServerId(item.labEquipmentId);

        if (existing) {
          const updated = await existing.update((rec) => {
            rec.labId = item.labId;
            rec.equipmentTypeId = item.equipmentTypeId;
            rec.equipmentTypeName = 'Hardware Device';
            rec.serialNumber = item.serialNumber || 'N/A';
            rec.oemName = item.oemName || 'OEM';
            rec.modelNumber = item.modelNumber || 'Model';
            rec.functionalStatus = item.operationalCondition;
          });
          results.push(updated);
        } else {
          const created = await this.database.get<EquipmentModel>('equipment').create((rec) => {
            rec.serverId = item.labEquipmentId;
            rec.labId = item.labId;
            rec.equipmentTypeId = item.equipmentTypeId;
            rec.equipmentTypeName = 'Hardware Device';
            rec.serialNumber = item.serialNumber || 'N/A';
            rec.oemName = item.oemName || 'OEM';
            rec.modelNumber = item.modelNumber || 'Model';
            rec.functionalStatus = item.operationalCondition;
          });
          results.push(created);
        }
      }

      return results;
    });
  }
}

/**
 * ZENTRA Field — Hi-Tech Lab Local Repository
 * apps/field/src/domain/repositories/lab.repository.ts
 *
 * Implements offline caching and queries for Hi-Tech Lab records.
 */

import { Database, Q } from '@nozbe/watermelondb';
import { HiTechLabModel } from '../../database/models/HiTechLabModel';
import type { HiTechLab } from '@zentra/types';

export class LabRepository {
  constructor(private readonly database: Database) {}

  async findById(id: string): Promise<HiTechLabModel | null> {
    try {
      return await this.database.get<HiTechLabModel>('hi_tech_labs').find(id);
    } catch {
      return null;
    }
  }

  async findByServerId(serverId: string): Promise<HiTechLabModel | null> {
    const records = await this.database
      .get<HiTechLabModel>('hi_tech_labs')
      .query(Q.where('server_id', serverId))
      .fetch();
    return records[0] || null;
  }

  async findBySchoolId(schoolId: string): Promise<HiTechLabModel[]> {
    return await this.database
      .get<HiTechLabModel>('hi_tech_labs')
      .query(Q.where('school_id', schoolId))
      .fetch();
  }

  async upsertLabsFromServer(labs: HiTechLab[]): Promise<HiTechLabModel[]> {
    return await this.database.write(async () => {
      const results: HiTechLabModel[] = [];

      for (const item of labs) {
        const existing = await this.findByServerId(item.labId);

        if (existing) {
          const updated = await existing.update((rec) => {
            rec.schoolId = item.schoolId;
            rec.labType = item.labType;
            rec.roomNumber = item.roomLocation || null;
            rec.totalSystems = item.activeComputersCount;
            rec.isFunctional = item.isActive;
          });
          results.push(updated);
        } else {
          const created = await this.database.get<HiTechLabModel>('hi_tech_labs').create((rec) => {
            rec.serverId = item.labId;
            rec.schoolId = item.schoolId;
            rec.labType = item.labType;
            rec.roomNumber = item.roomLocation || null;
            rec.totalSystems = item.activeComputersCount;
            rec.isFunctional = item.isActive;
          });
          results.push(created);
        }
      }

      return results;
    });
  }
}

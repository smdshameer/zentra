/**
 * ZENTRA Field — School Local Repository
 * apps/field/src/domain/repositories/school.repository.ts
 *
 * Implements offline caching and queries for school master records.
 */

import { Database, Q } from '@nozbe/watermelondb';
import { SchoolModel } from '../../database/models/SchoolModel';
import type { School } from '@zentra/types';

export class SchoolRepository {
  constructor(private readonly database: Database) {}

  async findById(id: string): Promise<SchoolModel | null> {
    try {
      return await this.database.get<SchoolModel>('schools').find(id);
    } catch {
      return null;
    }
  }

  async findByServerId(serverId: string): Promise<SchoolModel | null> {
    const records = await this.database
      .get<SchoolModel>('schools')
      .query(Q.where('server_id', serverId))
      .fetch();
    return records[0] || null;
  }

  async findByUdiseCode(udiseCode: string): Promise<SchoolModel | null> {
    const records = await this.database
      .get<SchoolModel>('schools')
      .query(Q.where('udise_code', udiseCode))
      .fetch();
    return records[0] || null;
  }

  async findByDistrictId(districtId: string): Promise<SchoolModel[]> {
    return await this.database
      .get<SchoolModel>('schools')
      .query(Q.where('district_id', districtId), Q.sortBy('school_name', Q.asc))
      .fetch();
  }

  async upsertSchoolsFromServer(schools: School[]): Promise<SchoolModel[]> {
    return await this.database.write(async () => {
      const results: SchoolModel[] = [];

      for (const item of schools) {
        const existing = await this.findByServerId(item.schoolId);

        const lat =
          item.latitude !== null && item.latitude !== undefined
            ? Number(item.latitude)
            : null;
        const lng =
          item.longitude !== null && item.longitude !== undefined
            ? Number(item.longitude)
            : null;

        if (existing) {
          const updated = await existing.update((rec) => {
            rec.udiseCode = item.udiseCode;
            rec.districtId = item.districtId;
            rec.blockId = item.blockId;
            rec.schoolName = item.schoolName;
            rec.category = String(item.schoolCategory || 'OTHER');
            rec.latitude = isNaN(lat as number) ? null : lat;
            rec.longitude = isNaN(lng as number) ? null : lng;
            rec.headmasterName = item.hmName || null;
            rec.headmasterPhone = item.hmPhone || null;
          });
          results.push(updated);
        } else {
          const created = await this.database.get<SchoolModel>('schools').create((rec) => {
            rec.serverId = item.schoolId;
            rec.udiseCode = item.udiseCode;
            rec.districtId = item.districtId;
            rec.blockId = item.blockId;
            rec.schoolName = item.schoolName;
            rec.category = String(item.schoolCategory || 'OTHER');
            rec.latitude = isNaN(lat as number) ? null : lat;
            rec.longitude = isNaN(lng as number) ? null : lng;
            rec.headmasterName = item.hmName || null;
            rec.headmasterPhone = item.hmPhone || null;
          });
          results.push(created);
        }
      }

      return results;
    });
  }
}

/**
 * ZENTRA Field — Reference Data API Service
 * apps/field/src/api/reference-api.ts
 *
 * Fetches authorized reference data for local cache preloading:
 * - Districts and blocks for the engineer's assigned territory
 * - School dossiers, labs, and equipment for assigned cases
 */

import type { ApiClient } from './api-client';
import type { School, HiTechLab, LabEquipment, District, Block } from '@zentra/types';

export class ReferenceApiService {
  constructor(private readonly client: ApiClient) {}

  /**
   * Fetches district reference by ID
   */
  async fetchDistrict(districtId: string): Promise<District> {
    return await this.client.get<District>(`districts/${districtId}`);
  }

  /**
   * Fetches block reference by ID
   */
  async fetchBlock(blockId: string): Promise<Block> {
    return await this.client.get<Block>(`blocks/${blockId}`);
  }

  /**
   * Fetches school dossier by school ID
   */
  async fetchSchool(schoolId: string): Promise<School> {
    return await this.client.get<School>(`schools/${schoolId}`);
  }

  /**
   * Fetches lab records for a school
   */
  async fetchLabsForSchool(schoolId: string): Promise<HiTechLab[]> {
    return await this.client.get<HiTechLab[]>(`schools/${schoolId}/labs`);
  }

  /**
   * Fetches equipment inventory for a lab
   */
  async fetchEquipmentForLab(labId: string): Promise<LabEquipment[]> {
    return await this.client.get<LabEquipment[]>(`labs/${labId}/equipment`);
  }
}

/**
 * ZENTRA — Territory Service (Districts & Blocks)
 * apps/api/src/modules/schools/services/territory.service.ts
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import type { Selectable } from 'kysely';
import { DistrictsRepository } from '../repositories/districts.repository';
import { BlocksRepository } from '../repositories/blocks.repository';
import type { District, Block } from '@zentra/types';
import type { DistrictsTable, BlocksTable } from '../../../database/database.types';

@Injectable()
export class TerritoryService {
  constructor(
    @Inject(DistrictsRepository)
    private readonly districtsRepo: DistrictsRepository,
    @Inject(BlocksRepository)
    private readonly blocksRepo: BlocksRepository,
  ) {}

  async listDistricts(options?: { activeOnly?: boolean }): Promise<District[]> {
    const districts = await this.districtsRepo.findAll(options);
    return districts.map((d) => this.mapDistrictToDto(d));
  }

  async getDistrictById(districtId: string): Promise<District> {
    const district = await this.districtsRepo.findById(districtId);
    if (!district) {
      throw new NotFoundException(`District with ID '${districtId}' not found`);
    }
    return this.mapDistrictToDto(district);
  }

  async listBlocksByDistrict(
    districtId: string,
    options?: { activeOnly?: boolean },
  ): Promise<Block[]> {
    const districtExists = await this.districtsRepo.exists(districtId);
    if (!districtExists) {
      throw new NotFoundException(`District with ID '${districtId}' not found`);
    }

    const blocks = await this.blocksRepo.findByDistrictId(districtId, options);
    return blocks.map((b) => this.mapBlockToDto(b));
  }

  async getBlockById(blockId: string): Promise<Block> {
    const block = await this.blocksRepo.findById(blockId);
    if (!block) {
      throw new NotFoundException(`Block with ID '${blockId}' not found`);
    }
    return this.mapBlockToDto(block);
  }

  async validateHierarchy(districtId: string, blockId: string): Promise<void> {
    const districtExists = await this.districtsRepo.exists(districtId);
    if (!districtExists) {
      throw new BadRequestException(`Invalid districtId: District '${districtId}' does not exist`);
    }

    const block = await this.blocksRepo.findById(blockId);
    if (!block) {
      throw new BadRequestException(`Invalid blockId: Block '${blockId}' does not exist`);
    }

    if (block.district_id !== districtId) {
      throw new BadRequestException(
        `Hierarchy conflict: Block '${blockId}' (${block.block_name}) does not belong to District '${districtId}'`,
      );
    }
  }

  private mapDistrictToDto(d: Selectable<DistrictsTable>): District {
    return {
      districtId: d.district_id,
      districtCode: d.district_code,
      districtName: d.district_name,
      isActive: Boolean(d.is_active),
      createdAt: d.created_at instanceof Date ? d.created_at.toISOString() : String(d.created_at),
      updatedAt: d.updated_at instanceof Date ? d.updated_at.toISOString() : String(d.updated_at),
    };
  }

  private mapBlockToDto(b: Selectable<BlocksTable>): Block {
    return {
      blockId: b.block_id,
      districtId: b.district_id,
      blockCode: b.block_code,
      blockName: b.block_name,
      isActive: Boolean(b.is_active),
      createdAt: b.created_at instanceof Date ? b.created_at.toISOString() : String(b.created_at),
      updatedAt: b.updated_at instanceof Date ? b.updated_at.toISOString() : String(b.updated_at),
    };
  }
}

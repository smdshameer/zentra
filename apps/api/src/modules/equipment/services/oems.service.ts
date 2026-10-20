/**
 * ZENTRA — OEM Manufacturers Domain Service
 * apps/api/src/modules/equipment/services/oems.service.ts
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import type { Selectable } from 'kysely';
import type { OemManufacturersTable } from '../../../database/database.types';
import { OemsRepository } from '../repositories/oems.repository';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../database/database.types';
import { generateUuidV7 } from '@zentra/shared';
import type { CreateOemDto, UpdateOemDto } from '@zentra/contracts';
import type { OemManufacturer, AccessTokenClaims } from '@zentra/types';

export interface ClientMetadata {
  ipAddress?: string;
  deviceId?: string;
  userAgent?: string;
}

@Injectable()
export class OemsService {
  constructor(
    @Inject(OemsRepository)
    private readonly oemsRepo: OemsRepository,
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  async listOems(options?: {
    activeOnly?: boolean;
    search?: string;
  }): Promise<OemManufacturer[]> {
    const oems = await this.oemsRepo.findAll(options);
    return oems.map((o) => this.mapOemToDto(o));
  }

  async getOemById(oemId: string): Promise<OemManufacturer> {
    const oem = await this.oemsRepo.findById(oemId);
    if (!oem) {
      throw new NotFoundException(`OEM Manufacturer with ID '${oemId}' not found`);
    }
    return this.mapOemToDto(oem);
  }

  async createOem(
    dto: CreateOemDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<OemManufacturer> {
    // 1. Uniqueness check for oem_name
    const existingByName = await this.oemsRepo.findByName(dto.oemName);
    if (existingByName) {
      throw new ConflictException(
        `OEM Manufacturer with name '${dto.oemName}' already exists`,
      );
    }

    // 2. Uniqueness check for oem_code if provided
    if (dto.oemCode) {
      const existingByCode = await this.oemsRepo.findByCode(dto.oemCode);
      if (existingByCode) {
        throw new ConflictException(
          `OEM Manufacturer with code '${dto.oemCode}' already exists`,
        );
      }
    }

    const oemId = generateUuidV7();

    // 3. Persist with audit logging
    const created = await this.db.transaction().execute(async (trx) => {
      const record = await this.oemsRepo.create(
        {
          oem_id: oemId,
          oem_name: dto.oemName.trim(),
          oem_code: dto.oemCode ? dto.oemCode.trim() : null,
          support_contact_info: dto.supportContactInfo ? dto.supportContactInfo.trim() : null,
          is_active: true,
        },
        trx,
      );

      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          event_category: 'ADMINISTRATIVE',
          action_type: 'OEM_CREATED',
          actor_user_id: user.sub,
          target_entity_type: 'oem_manufacturers',
          target_entity_id: oemId,
          actor_ip_address: clientMeta?.ipAddress ?? null,
          actor_device_id: clientMeta?.deviceId ?? null,
          pre_mutation_state: null,
          post_mutation_state: {
            oemName: dto.oemName,
            oemCode: dto.oemCode,
            supportContactInfo: dto.supportContactInfo,
          },
        })
        .execute();

      return record;
    });

    return this.mapOemToDto(created);
  }

  async updateOem(
    oemId: string,
    dto: UpdateOemDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<OemManufacturer> {
    const existing = await this.oemsRepo.findById(oemId);
    if (!existing) {
      throw new NotFoundException(`OEM Manufacturer with ID '${oemId}' not found`);
    }

    // Uniqueness checks if updating name or code
    if (dto.oemName && dto.oemName.trim().toLowerCase() !== existing.oem_name.toLowerCase()) {
      const duplicate = await this.oemsRepo.findByName(dto.oemName);
      if (duplicate && duplicate.oem_id !== oemId) {
        throw new ConflictException(
          `OEM Manufacturer with name '${dto.oemName}' already exists`,
        );
      }
    }

    if (dto.oemCode && dto.oemCode.trim().toLowerCase() !== (existing.oem_code || '').toLowerCase()) {
      const duplicate = await this.oemsRepo.findByCode(dto.oemCode);
      if (duplicate && duplicate.oem_id !== oemId) {
        throw new ConflictException(
          `OEM Manufacturer with code '${dto.oemCode}' already exists`,
        );
      }
    }

    const updated = await this.db.transaction().execute(async (trx) => {
      const record = await this.oemsRepo.update(
        oemId,
        {
          ...(dto.oemName !== undefined ? { oem_name: dto.oemName.trim() } : {}),
          ...(dto.oemCode !== undefined ? { oem_code: dto.oemCode ? dto.oemCode.trim() : null } : {}),
          ...(dto.supportContactInfo !== undefined
            ? { support_contact_info: dto.supportContactInfo ? dto.supportContactInfo.trim() : null }
            : {}),
          ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
        },
        trx,
      );

      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          event_category: 'ADMINISTRATIVE',
          action_type: 'OEM_UPDATED',
          actor_user_id: user.sub,
          target_entity_type: 'oem_manufacturers',
          target_entity_id: oemId,
          actor_ip_address: clientMeta?.ipAddress ?? null,
          actor_device_id: clientMeta?.deviceId ?? null,
          pre_mutation_state: {
            oemName: existing.oem_name,
            oemCode: existing.oem_code,
            isActive: existing.is_active,
          },
          post_mutation_state: {
            oemName: record?.oem_name,
            oemCode: record?.oem_code,
            isActive: record?.is_active,
          },
        })
        .execute();

      return record;
    });

    if (!updated) {
      throw new NotFoundException(`OEM Manufacturer with ID '${oemId}' not found`);
    }

    return this.mapOemToDto(updated);
  }

  async deactivateOem(
    oemId: string,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<OemManufacturer> {
    const existing = await this.oemsRepo.findById(oemId);
    if (!existing) {
      throw new NotFoundException(`OEM Manufacturer with ID '${oemId}' not found`);
    }

    const deactivated = await this.db.transaction().execute(async (trx) => {
      const record = await this.oemsRepo.softDelete(oemId, trx);

      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          event_category: 'ADMINISTRATIVE',
          action_type: 'OEM_DEACTIVATED',
          actor_user_id: user.sub,
          target_entity_type: 'oem_manufacturers',
          target_entity_id: oemId,
          actor_ip_address: clientMeta?.ipAddress ?? null,
          actor_device_id: clientMeta?.deviceId ?? null,
          pre_mutation_state: { isActive: true },
          post_mutation_state: { isActive: false },
        })
        .execute();

      return record;
    });

    if (!deactivated) {
      throw new NotFoundException(`OEM Manufacturer with ID '${oemId}' not found`);
    }

    return this.mapOemToDto(deactivated);
  }

  private mapOemToDto(row: Selectable<OemManufacturersTable>): OemManufacturer {
    return {
      oemId: row.oem_id,
      oemName: row.oem_name,
      oemCode: row.oem_code,
      supportContactInfo: row.support_contact_info,
      isActive: row.is_active,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }
}

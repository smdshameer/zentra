/**
 * ZENTRA — Equipment Types & Attribute Definitions Domain Service
 * apps/api/src/modules/equipment/services/equipment-types.service.ts
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import type { Selectable } from 'kysely';
import type {
  EquipmentTypesTable,
  EquipmentAttributeDefinitionsTable,
} from '../../../database/database.types';
import { EquipmentTypesRepository } from '../repositories/equipment-types.repository';
import { AttributeDefinitionsRepository } from '../repositories/attribute-definitions.repository';
import { LabEquipmentRepository } from '../repositories/lab-equipment.repository';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../database/database.types';
import { generateUuidV7 } from '@zentra/shared';
import type {
  CreateEquipmentTypeDto,
  UpdateEquipmentTypeDto,
  CreateAttributeDefinitionDto,
  UpdateAttributeDefinitionDto,
} from '@zentra/contracts';
import type {
  EquipmentType,
  EquipmentAttributeDefinition,
  AttributeDataType,
  AccessTokenClaims,
} from '@zentra/types';
import type { ClientMetadata } from './oems.service';

@Injectable()
export class EquipmentTypesService {
  constructor(
    @Inject(EquipmentTypesRepository)
    private readonly typesRepo: EquipmentTypesRepository,
    @Inject(AttributeDefinitionsRepository)
    private readonly attributeDefsRepo: AttributeDefinitionsRepository,
    @Inject(LabEquipmentRepository)
    private readonly labEquipmentRepo: LabEquipmentRepository,
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  // ==========================================
  // Equipment Types
  // ==========================================

  async listTypes(options?: {
    activeOnly?: boolean;
    search?: string;
  }): Promise<EquipmentType[]> {
    const types = await this.typesRepo.findAll(options);
    return types.map((t) => this.mapTypeToDto(t));
  }

  async getTypeById(equipmentTypeId: string): Promise<EquipmentType> {
    const type = await this.typesRepo.findById(equipmentTypeId);
    if (!type) {
      throw new NotFoundException(`Equipment Type with ID '${equipmentTypeId}' not found`);
    }
    return this.mapTypeToDto(type);
  }

  async createType(
    dto: CreateEquipmentTypeDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<EquipmentType> {
    // Uniqueness check for type_code
    const existing = await this.typesRepo.findByCode(dto.typeCode);
    if (existing) {
      throw new ConflictException(
        `Equipment Type with code '${dto.typeCode}' already exists`,
      );
    }

    const typeId = generateUuidV7();

    const created = await this.db.transaction().execute(async (trx) => {
      const record = await this.typesRepo.create(
        {
          equipment_type_id: typeId,
          type_code: dto.typeCode.trim().toUpperCase(),
          type_name: dto.typeName.trim(),
          description: dto.description ? dto.description.trim() : null,
          is_active: true,
        },
        trx,
      );

      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          event_category: 'ADMINISTRATIVE',
          action_type: 'EQUIPMENT_TYPE_CREATED',
          actor_user_id: user.sub,
          target_entity_type: 'equipment_types',
          target_entity_id: typeId,
          actor_ip_address: clientMeta?.ipAddress ?? null,
          actor_device_id: clientMeta?.deviceId ?? null,
          pre_mutation_state: null,
          post_mutation_state: {
            typeCode: dto.typeCode,
            typeName: dto.typeName,
            description: dto.description,
          },
        })
        .execute();

      return record;
    });

    return this.mapTypeToDto(created);
  }

  async updateType(
    equipmentTypeId: string,
    dto: UpdateEquipmentTypeDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<EquipmentType> {
    const existing = await this.typesRepo.findById(equipmentTypeId);
    if (!existing) {
      throw new NotFoundException(`Equipment Type with ID '${equipmentTypeId}' not found`);
    }

    if (dto.typeCode && dto.typeCode.trim().toLowerCase() !== existing.type_code.toLowerCase()) {
      const duplicate = await this.typesRepo.findByCode(dto.typeCode);
      if (duplicate && duplicate.equipment_type_id !== equipmentTypeId) {
        throw new ConflictException(
          `Equipment Type with code '${dto.typeCode}' already exists`,
        );
      }
    }

    const updated = await this.db.transaction().execute(async (trx) => {
      const record = await this.typesRepo.update(
        equipmentTypeId,
        {
          ...(dto.typeCode !== undefined ? { type_code: dto.typeCode.trim().toUpperCase() } : {}),
          ...(dto.typeName !== undefined ? { type_name: dto.typeName.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description ? dto.description.trim() : null } : {}),
          ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
        },
        trx,
      );

      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          event_category: 'ADMINISTRATIVE',
          action_type: 'EQUIPMENT_TYPE_UPDATED',
          actor_user_id: user.sub,
          target_entity_type: 'equipment_types',
          target_entity_id: equipmentTypeId,
          actor_ip_address: clientMeta?.ipAddress ?? null,
          actor_device_id: clientMeta?.deviceId ?? null,
          pre_mutation_state: {
            typeCode: existing.type_code,
            typeName: existing.type_name,
            isActive: existing.is_active,
          },
          post_mutation_state: {
            typeCode: record?.type_code,
            typeName: record?.type_name,
            isActive: record?.is_active,
          },
        })
        .execute();

      return record;
    });

    if (!updated) {
      throw new NotFoundException(`Equipment Type with ID '${equipmentTypeId}' not found`);
    }

    return this.mapTypeToDto(updated);
  }

  async deactivateType(
    equipmentTypeId: string,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<EquipmentType> {
    const existing = await this.typesRepo.findById(equipmentTypeId);
    if (!existing) {
      throw new NotFoundException(`Equipment Type with ID '${equipmentTypeId}' not found`);
    }

    const deactivated = await this.db.transaction().execute(async (trx) => {
      const record = await this.typesRepo.softDelete(equipmentTypeId, trx);

      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          event_category: 'ADMINISTRATIVE',
          action_type: 'EQUIPMENT_TYPE_DEACTIVATED',
          actor_user_id: user.sub,
          target_entity_type: 'equipment_types',
          target_entity_id: equipmentTypeId,
          actor_ip_address: clientMeta?.ipAddress ?? null,
          actor_device_id: clientMeta?.deviceId ?? null,
          pre_mutation_state: { isActive: true },
          post_mutation_state: { isActive: false },
        })
        .execute();

      return record;
    });

    if (!deactivated) {
      throw new NotFoundException(`Equipment Type with ID '${equipmentTypeId}' not found`);
    }

    return this.mapTypeToDto(deactivated);
  }

  // ==========================================
  // Attribute Definitions
  // ==========================================

  async listAttributes(equipmentTypeId: string): Promise<EquipmentAttributeDefinition[]> {
    const type = await this.typesRepo.findById(equipmentTypeId);
    if (!type) {
      throw new NotFoundException(`Equipment Type with ID '${equipmentTypeId}' not found`);
    }

    const attrs = await this.attributeDefsRepo.findByTypeId(equipmentTypeId);
    return attrs.map((a) => this.mapAttributeToDto(a));
  }

  async getAttributeById(attributeDefId: string): Promise<EquipmentAttributeDefinition> {
    const attr = await this.attributeDefsRepo.findById(attributeDefId);
    if (!attr) {
      throw new NotFoundException(`Attribute Definition with ID '${attributeDefId}' not found`);
    }
    return this.mapAttributeToDto(attr);
  }

  async createAttribute(
    equipmentTypeId: string,
    dto: CreateAttributeDefinitionDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<EquipmentAttributeDefinition> {
    const type = await this.typesRepo.findById(equipmentTypeId);
    if (!type) {
      throw new NotFoundException(`Equipment Type with ID '${equipmentTypeId}' not found`);
    }

    // Uniqueness check: (equipment_type_id, attribute_key)
    const existingKey = await this.attributeDefsRepo.findByTypeAndKey(
      equipmentTypeId,
      dto.attributeKey,
    );
    if (existingKey) {
      throw new ConflictException(
        `Attribute with key '${dto.attributeKey}' already exists for equipment type '${type.type_name}'`,
      );
    }

    const normalizedDataType = (
      dto.dataType === 'STRING' ? 'TEXT' : dto.dataType
    ) as AttributeDataType;

    if (normalizedDataType === 'DROPDOWN' && (!dto.dropdownOptions || dto.dropdownOptions.length === 0)) {
      throw new BadRequestException('Dropdown data type requires a non-empty array of dropdown options');
    }

    const attributeDefId = generateUuidV7();

    const created = await this.db.transaction().execute(async (trx) => {
      const record = await this.attributeDefsRepo.create(
        {
          attribute_def_id: attributeDefId,
          equipment_type_id: equipmentTypeId,
          attribute_key: dto.attributeKey.trim().toLowerCase(),
          attribute_label: dto.attributeLabel.trim(),
          data_type: normalizedDataType,
          dropdown_options: dto.dropdownOptions ? JSON.stringify(dto.dropdownOptions) : null,
          is_diagnostic_field: dto.isDiagnosticField ?? false,
          is_required: dto.isRequired ?? false,
        },
        trx,
      );

      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          event_category: 'ADMINISTRATIVE',
          action_type: 'ATTRIBUTE_DEF_CREATED',
          actor_user_id: user.sub,
          target_entity_type: 'equipment_attribute_definitions',
          target_entity_id: attributeDefId,
          actor_ip_address: clientMeta?.ipAddress ?? null,
          actor_device_id: clientMeta?.deviceId ?? null,
          pre_mutation_state: null,
          post_mutation_state: {
            equipmentTypeId,
            attributeKey: dto.attributeKey,
            attributeLabel: dto.attributeLabel,
            dataType: normalizedDataType,
            dropdownOptions: dto.dropdownOptions,
            isRequired: dto.isRequired,
          },
        })
        .execute();

      return record;
    });

    return this.mapAttributeToDto(created);
  }

  async updateAttribute(
    equipmentTypeId: string,
    attributeDefId: string,
    dto: UpdateAttributeDefinitionDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<EquipmentAttributeDefinition> {
    const existing = await this.attributeDefsRepo.findById(attributeDefId);
    if (!existing || existing.equipment_type_id !== equipmentTypeId) {
      throw new NotFoundException(
        `Attribute Definition with ID '${attributeDefId}' not found for type '${equipmentTypeId}'`,
      );
    }

    const normalizedDataType = dto.dataType
      ? ((dto.dataType === 'STRING' ? 'TEXT' : dto.dataType) as AttributeDataType)
      : undefined;

    if (
      normalizedDataType === 'DROPDOWN' &&
      dto.dropdownOptions !== undefined &&
      (!dto.dropdownOptions || dto.dropdownOptions.length === 0)
    ) {
      throw new BadRequestException('Dropdown data type requires a non-empty array of dropdown options');
    }

    const updated = await this.db.transaction().execute(async (trx) => {
      const record = await this.attributeDefsRepo.update(
        attributeDefId,
        {
          ...(dto.attributeLabel !== undefined ? { attribute_label: dto.attributeLabel.trim() } : {}),
          ...(normalizedDataType !== undefined ? { data_type: normalizedDataType } : {}),
          ...(dto.dropdownOptions !== undefined
            ? { dropdown_options: dto.dropdownOptions ? JSON.stringify(dto.dropdownOptions) : null }
            : {}),
          ...(dto.isDiagnosticField !== undefined ? { is_diagnostic_field: dto.isDiagnosticField } : {}),
          ...(dto.isRequired !== undefined ? { is_required: dto.isRequired } : {}),
        },
        trx,
      );

      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          event_category: 'ADMINISTRATIVE',
          action_type: 'ATTRIBUTE_DEF_UPDATED',
          actor_user_id: user.sub,
          target_entity_type: 'equipment_attribute_definitions',
          target_entity_id: attributeDefId,
          actor_ip_address: clientMeta?.ipAddress ?? null,
          actor_device_id: clientMeta?.deviceId ?? null,
          pre_mutation_state: {
            attributeLabel: existing.attribute_label,
            dataType: existing.data_type,
            isRequired: existing.is_required,
          },
          post_mutation_state: {
            attributeLabel: record?.attribute_label,
            dataType: record?.data_type,
            isRequired: record?.is_required,
          },
        })
        .execute();

      return record;
    });

    if (!updated) {
      throw new NotFoundException(`Attribute Definition with ID '${attributeDefId}' not found`);
    }

    return this.mapAttributeToDto(updated);
  }

  async deleteAttribute(
    equipmentTypeId: string,
    attributeDefId: string,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<EquipmentAttributeDefinition> {
    const existing = await this.attributeDefsRepo.findById(attributeDefId);
    if (!existing || existing.equipment_type_id !== equipmentTypeId) {
      throw new NotFoundException(
        `Attribute Definition with ID '${attributeDefId}' not found for type '${equipmentTypeId}'`,
      );
    }

    // Historical Safety Directive: Prevent deleting attribute definitions if existing equipment records reference it
    const usageCount = await this.labEquipmentRepo.countByAttributeKey(
      equipmentTypeId,
      existing.attribute_key,
    );
    if (usageCount > 0) {
      throw new ConflictException(
        `Cannot delete attribute definition '${existing.attribute_label}' (${existing.attribute_key}) because it is actively referenced by ${usageCount} equipment record(s). Historical equipment data must not lose its authoritative definition.`,
      );
    }

    const deleted = await this.db.transaction().execute(async (trx) => {
      const record = await this.attributeDefsRepo.delete(attributeDefId, trx);

      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          event_category: 'ADMINISTRATIVE',
          action_type: 'ATTRIBUTE_DEF_DELETED',
          actor_user_id: user.sub,
          target_entity_type: 'equipment_attribute_definitions',
          target_entity_id: attributeDefId,
          actor_ip_address: clientMeta?.ipAddress ?? null,
          actor_device_id: clientMeta?.deviceId ?? null,
          pre_mutation_state: {
            attributeKey: existing.attribute_key,
            attributeLabel: existing.attribute_label,
          },
          post_mutation_state: null,
        })
        .execute();

      return record;
    });

    if (!deleted) {
      throw new NotFoundException(`Attribute Definition with ID '${attributeDefId}' not found`);
    }

    return this.mapAttributeToDto(deleted);
  }

  private mapTypeToDto(row: Selectable<EquipmentTypesTable>): EquipmentType {
    return {
      equipmentTypeId: row.equipment_type_id,
      typeCode: row.type_code,
      typeName: row.type_name,
      description: row.description,
      isActive: row.is_active,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }

  private mapAttributeToDto(
    row: Selectable<EquipmentAttributeDefinitionsTable>,
  ): EquipmentAttributeDefinition {
    let parsedDropdownOptions: string[] | null = null;
    if (row.dropdown_options) {
      if (typeof row.dropdown_options === 'string') {
        try {
          parsedDropdownOptions = JSON.parse(row.dropdown_options);
        } catch {
          parsedDropdownOptions = [row.dropdown_options];
        }
      } else if (Array.isArray(row.dropdown_options)) {
        parsedDropdownOptions = row.dropdown_options as string[];
      }
    }

    return {
      attributeDefId: row.attribute_def_id,
      equipmentTypeId: row.equipment_type_id,
      attributeKey: row.attribute_key,
      attributeLabel: row.attribute_label,
      dataType: (row.data_type === 'STRING' ? 'TEXT' : row.data_type) as AttributeDataType,
      dropdownOptions: parsedDropdownOptions,
      isDiagnosticField: row.is_diagnostic_field,
      isRequired: row.is_required,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }
}

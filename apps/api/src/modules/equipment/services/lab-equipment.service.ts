/**
 * ZENTRA — Lab Equipment Domain Service
 * apps/api/src/modules/equipment/services/lab-equipment.service.ts
 */

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { LabEquipmentRepository } from '../repositories/lab-equipment.repository';
import { EquipmentTypesRepository } from '../repositories/equipment-types.repository';
import { OemsRepository } from '../repositories/oems.repository';
import { LabsRepository } from '../../schools/repositories/labs.repository';
import { SchoolsRepository } from '../../schools/repositories/schools.repository';
import { DynamicAttributeEngineService } from './dynamic-attribute-engine.service';
import { RlsService } from '../../auth/rls.service';
import { generateUuidV7 } from '@zentra/shared';
import type {
  CreateEquipmentDto,
  UpdateEquipmentDto,
  EquipmentQueryDto,
} from '@zentra/contracts';
import type {
  LabEquipmentWithDetails,
  AccessTokenClaims,
  UserRole,
  PaginationMeta,
} from '@zentra/types';
import type { ClientMetadata } from './oems.service';

@Injectable()
export class LabEquipmentService {
  constructor(
    @Inject(LabEquipmentRepository)
    private readonly equipmentRepo: LabEquipmentRepository,
    @Inject(EquipmentTypesRepository)
    private readonly typesRepo: EquipmentTypesRepository,
    @Inject(OemsRepository)
    private readonly oemsRepo: OemsRepository,
    @Inject(LabsRepository)
    private readonly labsRepo: LabsRepository,
    @Inject(SchoolsRepository)
    private readonly schoolsRepo: SchoolsRepository,
    @Inject(DynamicAttributeEngineService)
    private readonly attributeEngine: DynamicAttributeEngineService,
    @Inject(RlsService)
    private readonly rlsService: RlsService,
  ) {}

  /**
   * Retrieves equipment instance by ID with full relational hierarchy details.
   */
  async getEquipmentById(
    labEquipmentId: string,
    user: AccessTokenClaims,
  ): Promise<LabEquipmentWithDetails> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    const equipment = await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        return await this.equipmentRepo.findByIdWithDetails(labEquipmentId, trx);
      },
    );

    if (!equipment) {
      throw new NotFoundException(`Equipment with ID '${labEquipmentId}' not found`);
    }

    return equipment;
  }

  /**
   * Lists equipment instances matching query filters under RLS isolation.
   */
  async listEquipment(
    filters: EquipmentQueryDto,
    user: AccessTokenClaims,
  ): Promise<{ data: LabEquipmentWithDetails[]; meta: PaginationMeta }> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';
    const page = filters.page || 1;
    const limit = filters.limit || 20;

    return await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        const [items, total] = await Promise.all([
          this.equipmentRepo.findAll(filters, trx),
          this.equipmentRepo.count(filters, trx),
        ]);

        const totalPages = Math.ceil(total / limit) || 1;

        return {
          data: items,
          meta: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
          },
        };
      },
    );
  }

  /**
   * Creates a new lab equipment instance with validation and administrative audit logging.
   */
  async createEquipment(
    dto: CreateEquipmentDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<LabEquipmentWithDetails> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    // 1. Resolve Hierarchy & Territory Access
    const lab = await this.labsRepo.findById(dto.labId);
    if (!lab) {
      throw new NotFoundException(`Hi-Tech Lab with ID '${dto.labId}' not found`);
    }

    const school = await this.schoolsRepo.findById(lab.school_id);
    if (!school) {
      throw new NotFoundException(`School with ID '${lab.school_id}' not found`);
    }

    this.assertTerritoryAuthorization(user, school.district_id);

    // 2. Validate Equipment Type
    const equipmentType = await this.typesRepo.findById(dto.equipmentTypeId);
    if (!equipmentType) {
      throw new NotFoundException(`Equipment Type with ID '${dto.equipmentTypeId}' not found`);
    }
    if (!equipmentType.is_active) {
      throw new BadRequestException(`Equipment Type '${equipmentType.type_name}' is not active`);
    }

    // 3. Validate OEM if specified
    let resolvedOemName = dto.oemName ?? null;
    if (dto.oemId) {
      const oem = await this.oemsRepo.findById(dto.oemId);
      if (!oem) {
        throw new NotFoundException(`OEM Manufacturer with ID '${dto.oemId}' not found`);
      }
      if (!resolvedOemName) {
        resolvedOemName = oem.oem_name;
      }
    }

    // 4. Validate Dynamic Attributes against active definitions
    await this.attributeEngine.validateOrThrow(dto.equipmentTypeId, dto.customAttributes || {});

    // 5. Persist with RLS and Audit Event
    const equipmentId = generateUuidV7();

    await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        await this.equipmentRepo.create(
          {
            lab_equipment_id: equipmentId,
            lab_id: dto.labId,
            equipment_type_id: dto.equipmentTypeId,
            oem_id: dto.oemId ?? null,
            oem_name: resolvedOemName,
            model_number: dto.modelNumber ?? null,
            serial_number: dto.serialNumber ?? null,
            asset_barcode: dto.assetBarcode ?? null,
            installation_date: dto.installationDate ? new Date(dto.installationDate) : null,
            warranty_end_date: dto.warrantyEndDate ? new Date(dto.warrantyEndDate) : null,
            operational_condition: dto.operationalCondition || 'OPERATIONAL',
            custom_attributes: dto.customAttributes || {},
            is_active: true,
          },
          trx,
        );

        await trx
          .insertInto('audit_events')
          .values({
            audit_event_id: generateUuidV7(),
            event_category: 'ADMINISTRATIVE',
            action_type: 'EQUIPMENT_CREATED',
            actor_user_id: user.sub,
            target_entity_type: 'lab_equipment',
            target_entity_id: equipmentId,
            actor_ip_address: clientMeta?.ipAddress ?? null,
            actor_device_id: clientMeta?.deviceId ?? null,
            pre_mutation_state: null,
            post_mutation_state: {
              labId: dto.labId,
              equipmentTypeId: dto.equipmentTypeId,
              modelNumber: dto.modelNumber,
              serialNumber: dto.serialNumber,
              operationalCondition: dto.operationalCondition,
              customAttributes: dto.customAttributes,
            },
          })
          .execute();
      },
    );

    const created = await this.equipmentRepo.findByIdWithDetails(equipmentId);
    if (!created) {
      throw new NotFoundException(`Failed to retrieve newly created equipment`);
    }

    return created;
  }

  /**
   * Updates an existing lab equipment instance.
   */
  async updateEquipment(
    labEquipmentId: string,
    dto: UpdateEquipmentDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<LabEquipmentWithDetails> {
    const existing = await this.equipmentRepo.findByIdWithDetails(labEquipmentId);
    if (!existing) {
      throw new NotFoundException(`Equipment with ID '${labEquipmentId}' not found`);
    }

    // Verify territory authorization based on existing equipment's lab district
    if (existing.districtId) {
      this.assertTerritoryAuthorization(user, existing.districtId);
    }

    const targetTypeId = dto.equipmentTypeId || existing.equipmentTypeId;

    // Validate type if changing
    if (dto.equipmentTypeId && dto.equipmentTypeId !== existing.equipmentTypeId) {
      const type = await this.typesRepo.findById(dto.equipmentTypeId);
      if (!type) {
        throw new NotFoundException(`Equipment Type with ID '${dto.equipmentTypeId}' not found`);
      }
    }

    // Validate OEM if changing
    let resolvedOemName = dto.oemName !== undefined ? dto.oemName : existing.oemName;
    if (dto.oemId && dto.oemId !== existing.oemId) {
      const oem = await this.oemsRepo.findById(dto.oemId);
      if (!oem) {
        throw new NotFoundException(`OEM Manufacturer with ID '${dto.oemId}' not found`);
      }
      if (!dto.oemName) {
        resolvedOemName = oem.oem_name;
      }
    }

    // Merge & validate dynamic attributes
    const mergedAttributes = {
      ...existing.customAttributes,
      ...(dto.customAttributes || {}),
    };

    if (dto.customAttributes !== undefined || dto.equipmentTypeId !== undefined) {
      await this.attributeEngine.validateOrThrow(targetTypeId, mergedAttributes);
    }

    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        await this.equipmentRepo.update(
          labEquipmentId,
          {
            ...(dto.equipmentTypeId ? { equipment_type_id: dto.equipmentTypeId } : {}),
            ...(dto.oemId !== undefined ? { oem_id: dto.oemId } : {}),
            ...(resolvedOemName !== undefined ? { oem_name: resolvedOemName } : {}),
            ...(dto.modelNumber !== undefined ? { model_number: dto.modelNumber } : {}),
            ...(dto.serialNumber !== undefined ? { serial_number: dto.serialNumber } : {}),
            ...(dto.assetBarcode !== undefined ? { asset_barcode: dto.assetBarcode } : {}),
            ...(dto.installationDate !== undefined
              ? { installation_date: dto.installationDate ? new Date(dto.installationDate) : null }
              : {}),
            ...(dto.warrantyEndDate !== undefined
              ? { warranty_end_date: dto.warrantyEndDate ? new Date(dto.warrantyEndDate) : null }
              : {}),
            ...(dto.operationalCondition ? { operational_condition: dto.operationalCondition } : {}),
            ...(dto.customAttributes ? { custom_attributes: mergedAttributes } : {}),
            ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
          },
          trx,
        );

        await trx
          .insertInto('audit_events')
          .values({
            audit_event_id: generateUuidV7(),
            event_category: 'ADMINISTRATIVE',
            action_type: 'EQUIPMENT_UPDATED',
            actor_user_id: user.sub,
            target_entity_type: 'lab_equipment',
            target_entity_id: labEquipmentId,
            actor_ip_address: clientMeta?.ipAddress ?? null,
            actor_device_id: clientMeta?.deviceId ?? null,
            pre_mutation_state: {
              modelNumber: existing.modelNumber,
              serialNumber: existing.serialNumber,
              operationalCondition: existing.operationalCondition,
              customAttributes: existing.customAttributes,
              isActive: existing.isActive,
            },
            post_mutation_state: {
              modelNumber: dto.modelNumber ?? existing.modelNumber,
              serialNumber: dto.serialNumber ?? existing.serialNumber,
              operationalCondition: dto.operationalCondition ?? existing.operationalCondition,
              customAttributes: mergedAttributes,
              isActive: dto.isActive ?? existing.isActive,
            },
          })
          .execute();
      },
    );

    const updated = await this.equipmentRepo.findByIdWithDetails(labEquipmentId);
    if (!updated) {
      throw new NotFoundException(`Equipment with ID '${labEquipmentId}' not found`);
    }

    return updated;
  }

  /**
   * Deactivates (soft-deletes) an equipment instance.
   */
  async deactivateEquipment(
    labEquipmentId: string,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<LabEquipmentWithDetails> {
    const existing = await this.equipmentRepo.findByIdWithDetails(labEquipmentId);
    if (!existing) {
      throw new NotFoundException(`Equipment with ID '${labEquipmentId}' not found`);
    }

    if (existing.districtId) {
      this.assertTerritoryAuthorization(user, existing.districtId);
    }

    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        await this.equipmentRepo.softDelete(labEquipmentId, trx);

        await trx
          .insertInto('audit_events')
          .values({
            audit_event_id: generateUuidV7(),
            event_category: 'ADMINISTRATIVE',
            action_type: 'EQUIPMENT_DEACTIVATED',
            actor_user_id: user.sub,
            target_entity_type: 'lab_equipment',
            target_entity_id: labEquipmentId,
            actor_ip_address: clientMeta?.ipAddress ?? null,
            actor_device_id: clientMeta?.deviceId ?? null,
            pre_mutation_state: { isActive: true },
            post_mutation_state: { isActive: false },
          })
          .execute();
      },
    );

    const deactivated = await this.equipmentRepo.findByIdWithDetails(labEquipmentId);
    if (!deactivated) {
      throw new NotFoundException(`Equipment with ID '${labEquipmentId}' not found`);
    }

    return deactivated;
  }

  /**
   * Helper asserting territory authorization for mutator roles.
   */
  private assertTerritoryAuthorization(user: AccessTokenClaims, districtId: string): void {
    const roles: UserRole[] = user.roles || [];
    const activeRole = user.activeRole || roles[0];

    // Statewide roles bypass territory restriction
    if (activeRole === 'MASTER_ADMIN' || activeRole === 'REPORTING_HEAD') {
      return;
    }

    // Scoped roles must have explicit district assignment
    const assignedDistricts = user.territoryDistrictIds || [];
    if (!assignedDistricts.includes(districtId)) {
      throw new ForbiddenException(
        `User does not hold territorial authorization for district '${districtId}'`,
      );
    }
  }
}

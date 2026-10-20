/**
 * ZENTRA — Schools Domain Service
 * apps/api/src/modules/schools/services/schools.service.ts
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import type { Selectable } from 'kysely';
import type { SchoolsTable } from '../../../database/database.types';
import { SchoolsRepository, type SchoolListFilters } from '../repositories/schools.repository';
import { LabsRepository } from '../repositories/labs.repository';
import { TerritoryService } from './territory.service';
import { RlsService } from '../../auth/rls.service';
import { generateUuidV7 } from '@zentra/shared';
import type {
  CreateSchoolDto,
  UpdateSchoolDto,
  SchoolQueryDto,
} from '@zentra/contracts';
import type {
  School,
  SchoolWithLabs,
  PaginationMeta,
  AccessTokenClaims,
  UserRole,
} from '@zentra/types';

export interface ClientMetadata {
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
}

@Injectable()
export class SchoolsService {
  constructor(
    @Inject(SchoolsRepository)
    private readonly schoolsRepo: SchoolsRepository,
    @Inject(LabsRepository)
    private readonly labsRepo: LabsRepository,
    @Inject(TerritoryService)
    private readonly territoryService: TerritoryService,
    @Inject(RlsService)
    private readonly rlsService: RlsService,
  ) {}

  async createSchool(
    dto: CreateSchoolDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<School> {
    // 1. Hierarchy integrity verification
    await this.territoryService.validateHierarchy(dto.districtId, dto.blockId);

    // 2. Resource-level territory authorization
    this.assertCanMutateTerritory(user, dto.districtId);

    // 3. Unique UDISE verification
    const existingSchool = await this.schoolsRepo.findByUdise(dto.udiseCode);
    if (existingSchool) {
      throw new ConflictException(`School with UDISE code '${dto.udiseCode}' already exists`);
    }

    // 4. Kernel RLS-enforced persistence
    const schoolId = generateUuidV7();
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    const created = await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        const schoolRecord = await this.schoolsRepo.create(
          {
            school_id: schoolId,
            udise_code: dto.udiseCode,
            school_name: dto.schoolName,
            district_id: dto.districtId,
            block_id: dto.blockId,
            school_category: dto.schoolCategory,
            base_pincode: dto.basePincode ?? null,
            is_special_zone: dto.isSpecialZone,
            latitude: dto.latitude != null ? String(dto.latitude) : null,
            longitude: dto.longitude != null ? String(dto.longitude) : null,
            hm_name: dto.hmName ?? null,
            hm_phone: dto.hmPhone ?? null,
            ai_name: dto.aiName ?? null,
            ai_phone: dto.aiPhone ?? null,
            ai_emp_id: dto.aiEmpId ?? null,
            is_active: true,
          },
          trx,
        );

        // Audit Event
        await trx
          .insertInto('audit_events')
          .values({
            audit_event_id: generateUuidV7(),
            event_category: 'ADMINISTRATIVE',
            action_type: 'SCHOOL_CREATED',
            actor_user_id: user.sub,
            target_entity_type: 'schools',
            target_entity_id: schoolId,
            actor_ip_address: clientMeta?.ipAddress ?? null,
            actor_device_id: clientMeta?.deviceId ?? null,
            pre_mutation_state: null,
            post_mutation_state: {
              udiseCode: dto.udiseCode,
              schoolName: dto.schoolName,
              districtId: dto.districtId,
              blockId: dto.blockId,
            },
          })
          .execute();

        return schoolRecord;
      },
    );

    return this.mapSchoolToDto(created);
  }

  async updateSchool(
    schoolId: string,
    dto: UpdateSchoolDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<School> {
    const existing = await this.schoolsRepo.findById(schoolId);
    if (!existing) {
      throw new NotFoundException(`School with ID '${schoolId}' not found`);
    }

    // Resource-level territory authorization on current district
    this.assertCanMutateTerritory(user, existing.district_id);

    // If changing district or block, validate hierarchy and new territory authorization
    const targetDistrictId = dto.districtId || existing.district_id;
    const targetBlockId = dto.blockId || existing.block_id;

    if (dto.districtId || dto.blockId) {
      await this.territoryService.validateHierarchy(targetDistrictId, targetBlockId);
      if (dto.districtId && dto.districtId !== existing.district_id) {
        this.assertCanMutateTerritory(user, dto.districtId);
      }
    }

    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    const updated = await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        const updatedRecord = await this.schoolsRepo.update(
          schoolId,
          {
            school_name: dto.schoolName,
            district_id: dto.districtId,
            block_id: dto.blockId,
            school_category: dto.schoolCategory,
            base_pincode: dto.basePincode,
            is_special_zone: dto.isSpecialZone,
            latitude: dto.latitude != null ? String(dto.latitude) : undefined,
            longitude: dto.longitude != null ? String(dto.longitude) : undefined,
            hm_name: dto.hmName,
            hm_phone: dto.hmPhone,
            ai_name: dto.aiName,
            ai_phone: dto.aiPhone,
            ai_emp_id: dto.aiEmpId,
            is_active: dto.isActive,
          },
          trx,
        );

        // Audit Event
        await trx
          .insertInto('audit_events')
          .values({
            audit_event_id: generateUuidV7(),
            event_category: 'ADMINISTRATIVE',
            action_type: 'SCHOOL_UPDATED',
            actor_user_id: user.sub,
            target_entity_type: 'schools',
            target_entity_id: schoolId,
            actor_ip_address: clientMeta?.ipAddress ?? null,
            actor_device_id: clientMeta?.deviceId ?? null,
            pre_mutation_state: {
              schoolName: existing.school_name,
              districtId: existing.district_id,
              blockId: existing.block_id,
              isActive: existing.is_active,
            },
            post_mutation_state: {
              schoolName: updatedRecord.school_name,
              districtId: updatedRecord.district_id,
              blockId: updatedRecord.block_id,
              isActive: updatedRecord.is_active,
            },
          })
          .execute();

        return updatedRecord;
      },
    );

    return this.mapSchoolToDto(updated);
  }

  async getSchoolById(
    schoolId: string,
    user: AccessTokenClaims,
  ): Promise<SchoolWithLabs> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    const result = await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        const school = await this.schoolsRepo.findById(schoolId, trx);
        if (!school) {
          return null;
        }

        const labs = await this.labsRepo.findBySchoolId(schoolId, undefined, trx);
        return { school, labs };
      },
    );

    if (!result) {
      throw new NotFoundException(`School with ID '${schoolId}' not found`);
    }

    return {
      ...this.mapSchoolToDto(result.school),
      labs: result.labs.map((l) => ({
        labId: l.lab_id,
        schoolId: l.school_id,
        labCode: l.lab_code,
        labType: l.lab_type,
        roomLocation: l.room_location ?? null,
        activeComputersCount: l.active_computers_count,
        commissioningDate: l.commissioning_date
          ? (l.commissioning_date instanceof Date
              ? l.commissioning_date.toISOString().slice(0, 10)
              : String(l.commissioning_date))
          : null,
        isActive: Boolean(l.is_active),
        createdAt: l.created_at instanceof Date ? l.created_at.toISOString() : String(l.created_at),
        updatedAt: l.updated_at instanceof Date ? l.updated_at.toISOString() : String(l.updated_at),
      })),
    };
  }

  async listSchools(
    query: SchoolQueryDto,
    user: AccessTokenClaims,
  ): Promise<{ data: School[]; meta: PaginationMeta }> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    // Route / Territory authorization check
    if (query.districtId) {
      this.assertCanReadTerritory(user, query.districtId);
    }

    const filters: SchoolListFilters = {
      districtId: query.districtId,
      blockId: query.blockId,
      udiseCode: query.udiseCode,
      search: query.search,
      isActive: query.isActive,
      page: query.page,
      limit: query.limit,
    };

    const { schools, total } = await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        const rows = await this.schoolsRepo.findMany(filters, trx);
        const count = await this.schoolsRepo.count(filters, trx);
        return { schools: rows, total: count };
      },
    );

    const totalPages = Math.ceil(total / query.limit) || 1;

    return {
      data: schools.map((s) => this.mapSchoolToDto(s)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
        hasNext: query.page < totalPages,
        hasPrev: query.page > 1,
      },
    };
  }

  async deactivateSchool(
    schoolId: string,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<School> {
    const existing = await this.schoolsRepo.findById(schoolId);
    if (!existing) {
      throw new NotFoundException(`School with ID '${schoolId}' not found`);
    }

    this.assertCanMutateTerritory(user, existing.district_id);

    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    const deactivated = await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        const record = await this.schoolsRepo.softDelete(schoolId, trx);

        // Audit Event
        await trx
          .insertInto('audit_events')
          .values({
            audit_event_id: generateUuidV7(),
            event_category: 'ADMINISTRATIVE',
            action_type: 'SCHOOL_DEACTIVATED',
            actor_user_id: user.sub,
            target_entity_type: 'schools',
            target_entity_id: schoolId,
            actor_ip_address: clientMeta?.ipAddress ?? null,
            actor_device_id: clientMeta?.deviceId ?? null,
            pre_mutation_state: { isActive: true },
            post_mutation_state: { isActive: false },
          })
          .execute();

        return record;
      },
    );

    return this.mapSchoolToDto(deactivated);
  }

  // --- Authorization Helpers ---

  private assertCanMutateTerritory(user: AccessTokenClaims, districtId: string): void {
    const activeRole: UserRole = user.activeRole || user.roles[0] || 'FIELD_ENGINEER';

    if (activeRole === 'MASTER_ADMIN') {
      return; // Statewide mutation permitted
    }

    if (activeRole === 'DISTRICT_COORDINATOR') {
      if (user.territoryDistrictIds.includes(districtId)) {
        return; // Authorized for assigned district
      }
      throw new ForbiddenException(
        `User is not authorized to mutate school resources in district '${districtId}'`,
      );
    }

    // REPORTING_HEAD is strictly analytical / read-only
    if (activeRole === 'REPORTING_HEAD') {
      throw new ForbiddenException(
        'REPORTING_HEAD role is strictly read-only and prohibited from performing administrative mutations',
      );
    }

    // FIELD_ENGINEER, AI, HM cannot perform administrative school mutations
    throw new ForbiddenException(
      `Role '${activeRole}' possesses insufficient privileges to perform school administrative mutations`,
    );
  }

  private assertCanReadTerritory(user: AccessTokenClaims, districtId: string): void {
    const activeRole: UserRole = user.activeRole || user.roles[0] || 'FIELD_ENGINEER';

    if (activeRole === 'MASTER_ADMIN' || activeRole === 'REPORTING_HEAD') {
      return; // Statewide read permitted
    }

    if (user.territoryDistrictIds.includes(districtId)) {
      return; // Permitted district
    }

    throw new ForbiddenException(
      `User is not assigned to district '${districtId}' and cannot read its school records`,
    );
  }

  private mapSchoolToDto(s: Selectable<SchoolsTable>): School {
    return {
      schoolId: s.school_id,
      udiseCode: s.udise_code,
      schoolName: s.school_name,
      districtId: s.district_id,
      blockId: s.block_id,
      schoolCategory: s.school_category,
      basePincode: s.base_pincode ?? null,
      isSpecialZone: Boolean(s.is_special_zone),
      latitude: s.latitude != null ? Number(s.latitude) : null,
      longitude: s.longitude != null ? Number(s.longitude) : null,
      hmName: s.hm_name ?? null,
      hmPhone: s.hm_phone ?? null,
      aiName: s.ai_name ?? null,
      aiPhone: s.ai_phone ?? null,
      aiEmpId: s.ai_emp_id ?? null,
      isActive: Boolean(s.is_active),
      createdAt: s.created_at instanceof Date ? s.created_at.toISOString() : String(s.created_at),
      updatedAt: s.updated_at instanceof Date ? s.updated_at.toISOString() : String(s.updated_at),
    };
  }
}

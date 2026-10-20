/**
 * ZENTRA — Hi-Tech Labs Domain Service
 * apps/api/src/modules/schools/services/labs.service.ts
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import type { Selectable } from 'kysely';
import type { HiTechLabsTable } from '../../../database/database.types';
import { LabsRepository } from '../repositories/labs.repository';
import { SchoolsRepository } from '../repositories/schools.repository';
import { RlsService } from '../../auth/rls.service';
import { generateUuidV7 } from '@zentra/shared';
import type { CreateLabDto, UpdateLabDto } from '@zentra/contracts';
import type {
  HiTechLab,
  AccessTokenClaims,
  UserRole,
} from '@zentra/types';
import type { ClientMetadata } from './schools.service';

@Injectable()
export class LabsService {
  constructor(
    @Inject(LabsRepository)
    private readonly labsRepo: LabsRepository,
    @Inject(SchoolsRepository)
    private readonly schoolsRepo: SchoolsRepository,
    @Inject(RlsService)
    private readonly rlsService: RlsService,
  ) {}

  async getLabById(
    labId: string,
    user: AccessTokenClaims,
  ): Promise<HiTechLab> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    const lab = await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        return await this.labsRepo.findById(labId, trx);
      },
    );

    if (!lab) {
      throw new NotFoundException(`Hi-Tech Lab with ID '${labId}' not found`);
    }

    return this.mapLabToDto(lab);
  }

  async listLabsBySchool(
    schoolId: string,
    user: AccessTokenClaims,
    options?: { activeOnly?: boolean },
  ): Promise<HiTechLab[]> {
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    // Verify school exists and user has access under RLS
    const labs = await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        const school = await this.schoolsRepo.findById(schoolId, trx);
        if (!school) {
          throw new NotFoundException(`School with ID '${schoolId}' not found`);
        }
        return await this.labsRepo.findBySchoolId(schoolId, options, trx);
      },
    );

    return labs.map((l) => this.mapLabToDto(l));
  }

  async createLab(
    schoolId: string,
    dto: CreateLabDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<HiTechLab> {
    // 1. Verify school exists
    const school = await this.schoolsRepo.findById(schoolId);
    if (!school) {
      throw new NotFoundException(`School with ID '${schoolId}' not found`);
    }

    // 2. Resource-level territory mutation authorization
    this.assertCanMutateTerritory(user, school.district_id);

    // 3. Unique lab code per school check
    const existingLab = await this.labsRepo.findBySchoolAndCode(schoolId, dto.labCode);
    if (existingLab) {
      throw new ConflictException(
        `Lab with code '${dto.labCode}' already exists for school '${school.school_name}'`,
      );
    }

    // 4. Persistence with RLS & Audit
    const labId = generateUuidV7();
    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    const created = await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        const labRecord = await this.labsRepo.create(
          {
            lab_id: labId,
            school_id: schoolId,
            lab_code: dto.labCode.trim(),
            lab_type: dto.labType || 'PRIMARY',
            room_location: dto.roomLocation ?? null,
            active_computers_count: dto.activeComputersCount ?? 10,
            commissioning_date: dto.commissioningDate ? new Date(dto.commissioningDate) : null,
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
            action_type: 'LAB_CREATED',
            actor_user_id: user.sub,
            target_entity_type: 'hi_tech_labs',
            target_entity_id: labId,
            actor_ip_address: clientMeta?.ipAddress ?? null,
            actor_device_id: clientMeta?.deviceId ?? null,
            pre_mutation_state: null,
            post_mutation_state: {
              labCode: dto.labCode,
              labType: dto.labType,
              schoolId,
              activeComputersCount: dto.activeComputersCount,
            },
          })
          .execute();

        return labRecord;
      },
    );

    return this.mapLabToDto(created);
  }

  async updateLab(
    labId: string,
    dto: UpdateLabDto,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<HiTechLab> {
    const existing = await this.labsRepo.findById(labId);
    if (!existing) {
      throw new NotFoundException(`Hi-Tech Lab with ID '${labId}' not found`);
    }

    const school = await this.schoolsRepo.findById(existing.school_id);
    if (!school) {
      throw new NotFoundException(`Associated school with ID '${existing.school_id}' not found`);
    }

    this.assertCanMutateTerritory(user, school.district_id);

    // If updating labCode, verify uniqueness within school
    if (dto.labCode && dto.labCode.trim() !== existing.lab_code) {
      const codeConflict = await this.labsRepo.findBySchoolAndCode(existing.school_id, dto.labCode);
      if (codeConflict && codeConflict.lab_id !== labId) {
        throw new ConflictException(
          `Lab with code '${dto.labCode}' already exists for school '${school.school_name}'`,
        );
      }
    }

    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    const updated = await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        const updatedRecord = await this.labsRepo.update(
          labId,
          {
            lab_code: dto.labCode ? dto.labCode.trim() : undefined,
            lab_type: dto.labType,
            room_location: dto.roomLocation,
            active_computers_count: dto.activeComputersCount,
            commissioning_date: dto.commissioningDate !== undefined
              ? (dto.commissioningDate ? new Date(dto.commissioningDate) : null)
              : undefined,
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
            action_type: 'LAB_UPDATED',
            actor_user_id: user.sub,
            target_entity_type: 'hi_tech_labs',
            target_entity_id: labId,
            actor_ip_address: clientMeta?.ipAddress ?? null,
            actor_device_id: clientMeta?.deviceId ?? null,
            pre_mutation_state: {
              labCode: existing.lab_code,
              labType: existing.lab_type,
              activeComputersCount: existing.active_computers_count,
              isActive: existing.is_active,
            },
            post_mutation_state: {
              labCode: updatedRecord.lab_code,
              labType: updatedRecord.lab_type,
              activeComputersCount: updatedRecord.active_computers_count,
              isActive: updatedRecord.is_active,
            },
          })
          .execute();

        return updatedRecord;
      },
    );

    return this.mapLabToDto(updated);
  }

  async deactivateLab(
    labId: string,
    user: AccessTokenClaims,
    clientMeta?: ClientMetadata,
  ): Promise<HiTechLab> {
    const existing = await this.labsRepo.findById(labId);
    if (!existing) {
      throw new NotFoundException(`Hi-Tech Lab with ID '${labId}' not found`);
    }

    const school = await this.schoolsRepo.findById(existing.school_id);
    if (!school) {
      throw new NotFoundException(`Associated school with ID '${existing.school_id}' not found`);
    }

    this.assertCanMutateTerritory(user, school.district_id);

    const activeRole = user.activeRole || user.roles[0] || 'MASTER_ADMIN';

    const deactivated = await this.rlsService.withSecurityContext(
      { userId: user.sub, role: activeRole },
      async (trx) => {
        const record = await this.labsRepo.softDelete(labId, trx);

        // Audit Event
        await trx
          .insertInto('audit_events')
          .values({
            audit_event_id: generateUuidV7(),
            event_category: 'ADMINISTRATIVE',
            action_type: 'LAB_DEACTIVATED',
            actor_user_id: user.sub,
            target_entity_type: 'hi_tech_labs',
            target_entity_id: labId,
            actor_ip_address: clientMeta?.ipAddress ?? null,
            actor_device_id: clientMeta?.deviceId ?? null,
            pre_mutation_state: { isActive: true },
            post_mutation_state: { isActive: false },
          })
          .execute();

        return record;
      },
    );

    return this.mapLabToDto(deactivated);
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
        `User is not authorized to mutate lab resources in district '${districtId}'`,
      );
    }

    if (activeRole === 'REPORTING_HEAD') {
      throw new ForbiddenException(
        'REPORTING_HEAD role is strictly read-only and prohibited from performing administrative mutations',
      );
    }

    throw new ForbiddenException(
      `Role '${activeRole}' possesses insufficient privileges to perform lab administrative mutations`,
    );
  }

  private mapLabToDto(l: Selectable<HiTechLabsTable>): HiTechLab {
    return {
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
    };
  }
}

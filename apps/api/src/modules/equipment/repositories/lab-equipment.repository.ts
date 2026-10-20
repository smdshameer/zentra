/**
 * ZENTRA — Lab Equipment Instances Repository
 * apps/api/src/modules/equipment/repositories/lab-equipment.repository.ts
 */

import { Injectable, Inject } from '@nestjs/common';
import {
  Kysely,
  type Transaction,
  type Selectable,
  type Insertable,
  type Updateable,
  sql,
} from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema, LabEquipmentTable } from '../../../database/database.types';
import type { EquipmentQueryFilters, LabEquipmentWithDetails } from '@zentra/types';

@Injectable()
export class LabEquipmentRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  private getExecutor(
    trx?: Transaction<DatabaseSchema>,
  ): Kysely<DatabaseSchema> | Transaction<DatabaseSchema> {
    return trx || this.db;
  }

  async findById(
    labEquipmentId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<LabEquipmentTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .selectFrom('lab_equipment')
      .selectAll()
      .where('lab_equipment_id', '=', labEquipmentId)
      .executeTakeFirst();
  }

  async findByIdWithDetails(
    labEquipmentId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<LabEquipmentWithDetails | undefined> {
    const executor = this.getExecutor(trx);
    const row = await executor
      .selectFrom('lab_equipment')
      .innerJoin('hi_tech_labs', 'hi_tech_labs.lab_id', 'lab_equipment.lab_id')
      .innerJoin('schools', 'schools.school_id', 'hi_tech_labs.school_id')
      .innerJoin('districts', 'districts.district_id', 'schools.district_id')
      .innerJoin('equipment_types', 'equipment_types.equipment_type_id', 'lab_equipment.equipment_type_id')
      .leftJoin('oem_manufacturers', 'oem_manufacturers.oem_id', 'lab_equipment.oem_id')
      .select([
        'lab_equipment.lab_equipment_id as labEquipmentId',
        'lab_equipment.lab_id as labId',
        'lab_equipment.equipment_type_id as equipmentTypeId',
        'lab_equipment.oem_id as oemId',
        'lab_equipment.oem_name as oemName',
        'lab_equipment.model_number as modelNumber',
        'lab_equipment.serial_number as serialNumber',
        'lab_equipment.asset_barcode as assetBarcode',
        'lab_equipment.installation_date as installationDate',
        'lab_equipment.warranty_end_date as warrantyEndDate',
        'lab_equipment.operational_condition as operationalCondition',
        'lab_equipment.custom_attributes as customAttributes',
        'lab_equipment.is_active as isActive',
        'lab_equipment.created_at as createdAt',
        'lab_equipment.updated_at as updatedAt',
        'equipment_types.type_name as typeName',
        'equipment_types.type_code as typeCode',
        'oem_manufacturers.oem_code as oemCode',
        'hi_tech_labs.lab_code as labCode',
        'schools.school_id as schoolId',
        'schools.school_name as schoolName',
        'schools.udise_code as udiseCode',
        'districts.district_id as districtId',
        'districts.district_name as districtName',
      ])
      .where('lab_equipment.lab_equipment_id', '=', labEquipmentId)
      .executeTakeFirst();

    if (!row) return undefined;

    return {
      labEquipmentId: row.labEquipmentId,
      labId: row.labId,
      equipmentTypeId: row.equipmentTypeId,
      oemId: row.oemId,
      oemName: row.oemName,
      modelNumber: row.modelNumber,
      serialNumber: row.serialNumber,
      assetBarcode: row.assetBarcode,
      installationDate: row.installationDate ? String(row.installationDate) : null,
      warrantyEndDate: row.warrantyEndDate ? String(row.warrantyEndDate) : null,
      operationalCondition: row.operationalCondition,
      customAttributes: (row.customAttributes as Record<string, unknown>) || {},
      isActive: row.isActive,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
      typeName: row.typeName,
      typeCode: row.typeCode,
      oemCode: row.oemCode,
      labCode: row.labCode,
      schoolId: row.schoolId,
      schoolName: row.schoolName,
      udiseCode: row.udiseCode,
      districtId: row.districtId,
      districtName: row.districtName,
    };
  }

  async findAll(
    filters: EquipmentQueryFilters,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<LabEquipmentWithDetails[]> {
    const executor = this.getExecutor(trx);
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    let query = executor
      .selectFrom('lab_equipment')
      .innerJoin('hi_tech_labs', 'hi_tech_labs.lab_id', 'lab_equipment.lab_id')
      .innerJoin('schools', 'schools.school_id', 'hi_tech_labs.school_id')
      .innerJoin('districts', 'districts.district_id', 'schools.district_id')
      .innerJoin('equipment_types', 'equipment_types.equipment_type_id', 'lab_equipment.equipment_type_id')
      .leftJoin('oem_manufacturers', 'oem_manufacturers.oem_id', 'lab_equipment.oem_id')
      .select([
        'lab_equipment.lab_equipment_id as labEquipmentId',
        'lab_equipment.lab_id as labId',
        'lab_equipment.equipment_type_id as equipmentTypeId',
        'lab_equipment.oem_id as oemId',
        'lab_equipment.oem_name as oemName',
        'lab_equipment.model_number as modelNumber',
        'lab_equipment.serial_number as serialNumber',
        'lab_equipment.asset_barcode as assetBarcode',
        'lab_equipment.installation_date as installationDate',
        'lab_equipment.warranty_end_date as warrantyEndDate',
        'lab_equipment.operational_condition as operationalCondition',
        'lab_equipment.custom_attributes as customAttributes',
        'lab_equipment.is_active as isActive',
        'lab_equipment.created_at as createdAt',
        'lab_equipment.updated_at as updatedAt',
        'equipment_types.type_name as typeName',
        'equipment_types.type_code as typeCode',
        'oem_manufacturers.oem_code as oemCode',
        'hi_tech_labs.lab_code as labCode',
        'schools.school_id as schoolId',
        'schools.school_name as schoolName',
        'schools.udise_code as udiseCode',
        'districts.district_id as districtId',
        'districts.district_name as districtName',
      ])
      .orderBy('lab_equipment.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (filters.labId) {
      query = query.where('lab_equipment.lab_id', '=', filters.labId);
    }

    if (filters.schoolId) {
      query = query.where('hi_tech_labs.school_id', '=', filters.schoolId);
    }

    if (filters.districtId) {
      query = query.where('schools.district_id', '=', filters.districtId);
    }

    if (filters.equipmentTypeId) {
      query = query.where('lab_equipment.equipment_type_id', '=', filters.equipmentTypeId);
    }

    if (filters.oemId) {
      query = query.where('lab_equipment.oem_id', '=', filters.oemId);
    }

    if (filters.serialNumber) {
      query = query.where('lab_equipment.serial_number', '=', filters.serialNumber.trim());
    }

    if (filters.assetBarcode) {
      query = query.where('lab_equipment.asset_barcode', '=', filters.assetBarcode.trim());
    }

    if (filters.operationalCondition) {
      query = query.where('lab_equipment.operational_condition', '=', filters.operationalCondition);
    }

    if (filters.isActive !== undefined) {
      query = query.where('lab_equipment.is_active', '=', filters.isActive);
    }

    if (filters.search) {
      const term = `%${filters.search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb('lab_equipment.serial_number', 'ilike', term),
          eb('lab_equipment.asset_barcode', 'ilike', term),
          eb('lab_equipment.model_number', 'ilike', term),
          eb('lab_equipment.oem_name', 'ilike', term),
          eb('equipment_types.type_name', 'ilike', term),
          eb('schools.school_name', 'ilike', term),
        ]),
      );
    }

    const rows = await query.execute();
    return rows.map((row) => ({
      labEquipmentId: row.labEquipmentId,
      labId: row.labId,
      equipmentTypeId: row.equipmentTypeId,
      oemId: row.oemId,
      oemName: row.oemName,
      modelNumber: row.modelNumber,
      serialNumber: row.serialNumber,
      assetBarcode: row.assetBarcode,
      installationDate: row.installationDate ? String(row.installationDate) : null,
      warrantyEndDate: row.warrantyEndDate ? String(row.warrantyEndDate) : null,
      operationalCondition: row.operationalCondition,
      customAttributes: (row.customAttributes as Record<string, unknown>) || {},
      isActive: row.isActive,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
      typeName: row.typeName,
      typeCode: row.typeCode,
      oemCode: row.oemCode,
      labCode: row.labCode,
      schoolId: row.schoolId,
      schoolName: row.schoolName,
      udiseCode: row.udiseCode,
      districtId: row.districtId,
      districtName: row.districtName,
    }));
  }

  async count(
    filters: EquipmentQueryFilters,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<number> {
    const executor = this.getExecutor(trx);
    let query = executor
      .selectFrom('lab_equipment')
      .innerJoin('hi_tech_labs', 'hi_tech_labs.lab_id', 'lab_equipment.lab_id')
      .innerJoin('schools', 'schools.school_id', 'hi_tech_labs.school_id')
      .innerJoin('districts', 'districts.district_id', 'schools.district_id')
      .innerJoin('equipment_types', 'equipment_types.equipment_type_id', 'lab_equipment.equipment_type_id')
      .leftJoin('oem_manufacturers', 'oem_manufacturers.oem_id', 'lab_equipment.oem_id')
      .select(sql<number>`count(lab_equipment.lab_equipment_id)`.as('count'));

    if (filters.labId) {
      query = query.where('lab_equipment.lab_id', '=', filters.labId);
    }

    if (filters.schoolId) {
      query = query.where('hi_tech_labs.school_id', '=', filters.schoolId);
    }

    if (filters.districtId) {
      query = query.where('schools.district_id', '=', filters.districtId);
    }

    if (filters.equipmentTypeId) {
      query = query.where('lab_equipment.equipment_type_id', '=', filters.equipmentTypeId);
    }

    if (filters.oemId) {
      query = query.where('lab_equipment.oem_id', '=', filters.oemId);
    }

    if (filters.serialNumber) {
      query = query.where('lab_equipment.serial_number', '=', filters.serialNumber.trim());
    }

    if (filters.assetBarcode) {
      query = query.where('lab_equipment.asset_barcode', '=', filters.assetBarcode.trim());
    }

    if (filters.operationalCondition) {
      query = query.where('lab_equipment.operational_condition', '=', filters.operationalCondition);
    }

    if (filters.isActive !== undefined) {
      query = query.where('lab_equipment.is_active', '=', filters.isActive);
    }

    if (filters.search) {
      const term = `%${filters.search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb('lab_equipment.serial_number', 'ilike', term),
          eb('lab_equipment.asset_barcode', 'ilike', term),
          eb('lab_equipment.model_number', 'ilike', term),
          eb('lab_equipment.oem_name', 'ilike', term),
          eb('equipment_types.type_name', 'ilike', term),
          eb('schools.school_name', 'ilike', term),
        ]),
      );
    }

    const res = await query.executeTakeFirst();
    return Number(res?.count || 0);
  }

  async findByLabId(
    labId: string,
    options?: { activeOnly?: boolean },
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<LabEquipmentTable>[]> {
    const executor = this.getExecutor(trx);
    let query = executor
      .selectFrom('lab_equipment')
      .selectAll()
      .where('lab_id', '=', labId)
      .orderBy('created_at', 'asc');

    if (options?.activeOnly) {
      query = query.where('is_active', '=', true);
    }

    return await query.execute();
  }

  async create(
    data: Insertable<LabEquipmentTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<LabEquipmentTable>> {
    const executor = this.getExecutor(trx);
    return await executor
      .insertInto('lab_equipment')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    labEquipmentId: string,
    data: Updateable<LabEquipmentTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<LabEquipmentTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .updateTable('lab_equipment')
      .set({
        ...data,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where('lab_equipment_id', '=', labEquipmentId)
      .returningAll()
      .executeTakeFirst();
  }

  async softDelete(
    labEquipmentId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<LabEquipmentTable> | undefined> {
    const executor = this.getExecutor(trx);
    return await executor
      .updateTable('lab_equipment')
      .set({
        is_active: false,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where('lab_equipment_id', '=', labEquipmentId)
      .returningAll()
      .executeTakeFirst();
  }

  async countByAttributeKey(
    equipmentTypeId: string,
    attributeKey: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<number> {
    const executor = this.getExecutor(trx);
    const result = await executor
      .selectFrom('lab_equipment')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('equipment_type_id', '=', equipmentTypeId)
      .where(sql<boolean>`custom_attributes ? ${attributeKey}`)
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }
}

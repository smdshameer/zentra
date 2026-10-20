/**
 * ZENTRA Field — Local Database & Repositories Test Suite
 * apps/field/test/local-database.spec.ts
 *
 * Verifies WatermelonDB initialization, schema v1, models, and repository operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAppDatabase } from '../src/database/database';
import { appDatabaseSchema, APP_SCHEMA_VERSION } from '../src/database/schema';
import { ServiceCaseRepository } from '../src/domain/repositories/service-case.repository';
import { SchoolRepository } from '../src/domain/repositories/school.repository';
import { LabRepository } from '../src/domain/repositories/lab.repository';
import { EquipmentRepository } from '../src/domain/repositories/equipment.repository';
import type { Database } from '@nozbe/watermelondb';

describe('Phase 10 — Local Database & WatermelonDB Engine', () => {
  let db: Database;
  let serviceCaseRepo: ServiceCaseRepository;
  let schoolRepo: SchoolRepository;
  let labRepo: LabRepository;
  let equipmentRepo: EquipmentRepository;

  beforeEach(async () => {
    db = createAppDatabase({ inMemory: true, dbName: 'test_db_' + Date.now() });
    serviceCaseRepo = new ServiceCaseRepository(db);
    schoolRepo = new SchoolRepository(db);
    labRepo = new LabRepository(db);
    equipmentRepo = new EquipmentRepository(db);
  });

  it('initializes WatermelonDB with schema version 1 and 8 tables', () => {
    expect(appDatabaseSchema.version).toBe(APP_SCHEMA_VERSION);
    const tableNames = Object.keys(appDatabaseSchema.tables);
    expect(tableNames).toContain('districts');
    expect(tableNames).toContain('blocks');
    expect(tableNames).toContain('schools');
    expect(tableNames).toContain('hi_tech_labs');
    expect(tableNames).toContain('equipment');
    expect(tableNames).toContain('service_cases');
    expect(tableNames).toContain('local_operations');
    expect(tableNames).toContain('sync_metadata');
  });

  it('supports caching and offline querying of schools in SchoolRepository', async () => {
    await schoolRepo.upsertSchoolsFromServer([
      {
        schoolId: 'sch-erode-01',
        udiseCode: '33100100101',
        districtId: 'dst-erode',
        blockId: 'blk-bhavani',
        schoolName: 'GHSS Bhavani',
        schoolCategory: 'Higher Secondary',
        basePincode: '638301',
        isSpecialZone: false,
        latitude: 11.45,
        longitude: 77.68,
        hmName: 'M. Selvaraj',
        hmPhone: '9443322110',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const byServerId = await schoolRepo.findByServerId('sch-erode-01');
    expect(byServerId).not.toBeNull();
    expect(byServerId?.schoolName).toBe('GHSS Bhavani');
    expect(byServerId?.udiseCode).toBe('33100100101');
    expect(byServerId?.headmasterName).toBe('M. Selvaraj');

    const byDistrict = await schoolRepo.findByDistrictId('dst-erode');
    expect(byDistrict.length).toBe(1);
    expect(byDistrict[0]?.schoolName).toBe('GHSS Bhavani');
  });

  it('supports caching and offline querying of labs in LabRepository', async () => {
    await labRepo.upsertLabsFromServer([
      {
        labId: 'lab-erode-01',
        schoolId: 'sch-erode-01',
        labCode: 'LAB-01',
        labType: 'SECONDARY',
        roomLocation: 'Room 204',
        activeComputersCount: 20,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const lab = await labRepo.findByServerId('lab-erode-01');
    expect(lab).not.toBeNull();
    expect(lab?.labType).toBe('SECONDARY');
    expect(lab?.roomNumber).toBe('Room 204');
    expect(lab?.totalSystems).toBe(20);
    expect(lab?.isFunctional).toBe(true);

    const schoolLabs = await labRepo.findBySchoolId('sch-erode-01');
    expect(schoolLabs.length).toBe(1);
  });

  it('supports caching and offline querying of equipment in EquipmentRepository', async () => {
    await equipmentRepo.upsertEquipmentFromServer([
      {
        labEquipmentId: 'eq-erode-01',
        labId: 'lab-erode-01',
        equipmentTypeId: 'eqt-desktop',
        oemId: 'oem-acer',
        oemName: 'Acer',
        modelNumber: 'Veriton M200',
        serialNumber: 'ACER-SN-998877',
        assetBarcode: 'BAR-001',
        installationDate: null,
        warrantyEndDate: null,
        operationalCondition: 'OPERATIONAL',
        customAttributes: {},
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const eq = await equipmentRepo.findByServerId('eq-erode-01');
    expect(eq).not.toBeNull();
    expect(eq?.serialNumber).toBe('ACER-SN-998877');
    expect(eq?.oemName).toBe('Acer');
    expect(eq?.functionalStatus).toBe('OPERATIONAL');

    const labEquipment = await equipmentRepo.findByLabId('lab-erode-01');
    expect(labEquipment.length).toBe(1);
  });

  it('supports caching server service cases and reading offline via ServiceCaseRepository', async () => {
    const engineerId = 'fe-user-01';

    await serviceCaseRepo.upsertCasesFromServer([
      {
        serviceCaseId: 'sc-erode-101',
        sourceComplaintId: 'src-cmp-101',
        zentraCaseCode: 'ZNT-2026-ERO-000101',
        schoolId: 'sch-erode-01',
        labId: 'lab-erode-01',
        labEquipmentId: 'eq-erode-01',
        operationalStatus: 'ASSIGNED',
        internalPriority: 'HIGH',
        assignedPrimaryEngineerId: engineerId,
        slaBreachStatus: 'WITHIN_SLA',
        actualDiagnosisSummary: 'Master projector lamp not turning on',
        verificationStatus: 'PENDING_REVIEW',
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const assigned = await serviceCaseRepo.getAssignedCases(engineerId);
    expect(assigned.length).toBe(1);
    expect(assigned[0]?.zentraCaseCode).toBe('ZNT-2026-ERO-000101');
    expect(assigned[0]?.operationalStatus).toBe('ASSIGNED');
    expect(assigned[0]?.syncState).toBe('SYNCED');
    expect(assigned[0]?.isPendingSync).toBe(false);
  });
});

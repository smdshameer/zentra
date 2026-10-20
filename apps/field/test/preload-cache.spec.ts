/**
 * ZENTRA Field — Preload & Cache Manager Test Suite
 * apps/field/test/preload-cache.spec.ts
 *
 * Verifies controlled, authorization-scoped local cache preloading:
 * - Scoped strictly to engineer's assigned service cases
 * - Fetches reference dossiers only for referenced schools, labs, and equipment
 * - Volume is bounded; no whole-state database downloading
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAppDatabase } from '../src/database/database';
import { PreloadManager } from '../src/domain/preload/preload-manager';
import { ServiceCaseRepository } from '../src/domain/repositories/service-case.repository';
import { SchoolRepository } from '../src/domain/repositories/school.repository';
import { LabRepository } from '../src/domain/repositories/lab.repository';
import { EquipmentRepository } from '../src/domain/repositories/equipment.repository';
import type { Database } from '@nozbe/watermelondb';

describe('Phase 10 — Controlled Preload & Cache Architecture', () => {
  let db: Database;
  let serviceCaseRepo: ServiceCaseRepository;
  let schoolRepo: SchoolRepository;
  let labRepo: LabRepository;
  let equipmentRepo: EquipmentRepository;

  beforeEach(() => {
    db = createAppDatabase({ inMemory: true, dbName: 'test_preload_' + Date.now() });
    serviceCaseRepo = new ServiceCaseRepository(db);
    schoolRepo = new SchoolRepository(db);
    labRepo = new LabRepository(db);
    equipmentRepo = new EquipmentRepository(db);
  });

  it('preloads assigned cases and only their referenced school/lab/equipment dossiers', async () => {
    const engineerId = 'fe-user-77';

    // Mock API services
    const mockCasesApi: any = {
      fetchAssignedCases: vi.fn().mockResolvedValue([
        {
          serviceCaseId: 'sc-001',
          sourceComplaintId: 'src-001',
          zentraCaseCode: 'ZNT-2026-ERO-000001',
          schoolId: 'sch-ref-01',
          labId: 'lab-ref-01',
          labEquipmentId: 'eq-ref-01',
          operationalStatus: 'ASSIGNED',
          internalPriority: 'HIGH',
          assignedPrimaryEngineerId: engineerId,
          slaBreachStatus: 'WITHIN_SLA',
          actualDiagnosisSummary: 'Projector HDMI port damaged',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    };

    const mockRefApi: any = {
      fetchSchool: vi.fn().mockResolvedValue({
        schoolId: 'sch-ref-01',
        udiseCode: '33100200202',
        districtId: 'dst-erode',
        blockId: 'blk-perundurai',
        schoolName: 'GHSS Perundurai',
        schoolCategory: 'Higher Secondary',
        basePincode: '638052',
        isSpecialZone: false,
        latitude: 11.27,
        longitude: 77.58,
        hmName: 'A. Raman',
        hmPhone: '9842100000',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      fetchLabsForSchool: vi.fn().mockResolvedValue([
        {
          labId: 'lab-ref-01',
          schoolId: 'sch-ref-01',
          labCode: 'LAB-A',
          labType: 'SECONDARY',
          roomLocation: 'First Floor',
          activeComputersCount: 20,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
      fetchEquipmentForLab: vi.fn().mockResolvedValue([
        {
          labEquipmentId: 'eq-ref-01',
          labId: 'lab-ref-01',
          equipmentTypeId: 'eqt-proj',
          oemId: 'oem-epson',
          oemName: 'Epson',
          modelNumber: 'EB-E01',
          serialNumber: 'EPS-9911',
          assetBarcode: 'BAR-P1',
          installationDate: null,
          warrantyEndDate: null,
          operationalCondition: 'DEGRADED',
          customAttributes: {},
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    };

    const preloadManager = new PreloadManager(
      mockCasesApi,
      mockRefApi,
      serviceCaseRepo,
      schoolRepo,
      labRepo,
      equipmentRepo,
    );

    const summary = await preloadManager.preloadAssignedDossier(engineerId);

    expect(summary.casesPreloaded).toBe(1);
    expect(summary.schoolsPreloaded).toBe(1);
    expect(summary.labsPreloaded).toBe(1);
    expect(summary.equipmentPreloaded).toBe(1);

    // Verify local database now contains all preloaded records
    const localCases = await serviceCaseRepo.getAssignedCases(engineerId);
    expect(localCases.length).toBe(1);
    expect(localCases[0]?.zentraCaseCode).toBe('ZNT-2026-ERO-000001');

    const localSchool = await schoolRepo.findByServerId('sch-ref-01');
    expect(localSchool).not.toBeNull();
    expect(localSchool?.schoolName).toBe('GHSS Perundurai');

    const localLab = await labRepo.findByServerId('lab-ref-01');
    expect(localLab).not.toBeNull();
    expect(localLab?.roomNumber).toBe('First Floor');

    const localEquipment = await equipmentRepo.findByServerId('eq-ref-01');
    expect(localEquipment).not.toBeNull();
    expect(localEquipment?.serialNumber).toBe('EPS-9911');
  });

  it('handles partial reference fetch failures gracefully without aborting case preload', async () => {
    const engineerId = 'fe-user-77';

    const mockCasesApi: any = {
      fetchAssignedCases: vi.fn().mockResolvedValue([
        {
          serviceCaseId: 'sc-002',
          sourceComplaintId: 'src-002',
          zentraCaseCode: 'ZNT-2026-ERO-000002',
          schoolId: 'sch-ref-offline',
          labId: 'lab-ref-offline',
          operationalStatus: 'ASSIGNED',
          internalPriority: 'MEDIUM',
          assignedPrimaryEngineerId: engineerId,
          slaBreachStatus: 'WITHIN_SLA',
          actualDiagnosisSummary: 'UPS backup failing',
          verificationStatus: 'PENDING_REVIEW',
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    };

    const mockRefApi: any = {
      fetchSchool: vi.fn().mockRejectedValue(new Error('Network connection timeout')),
      fetchLabsForSchool: vi.fn(),
      fetchEquipmentForLab: vi.fn(),
    };

    const preloadManager = new PreloadManager(
      mockCasesApi,
      mockRefApi,
      serviceCaseRepo,
      schoolRepo,
      labRepo,
      equipmentRepo,
    );

    const summary = await preloadManager.preloadAssignedDossier(engineerId);

    // Cases still succeeded even though school reference failed
    expect(summary.casesPreloaded).toBe(1);
    expect(summary.schoolsPreloaded).toBe(0);

    const localCases = await serviceCaseRepo.getAssignedCases(engineerId);
    expect(localCases.length).toBe(1);
  });

  it('confirms preload does not perform synchronization, create delta tokens, or alter operation queue', async () => {
    const engineerId = 'fe-user-77';

    const mockCasesApi: any = {
      fetchAssignedCases: vi.fn().mockResolvedValue([]),
    };
    const mockRefApi: any = {
      fetchSchool: vi.fn(),
      fetchLabsForSchool: vi.fn(),
      fetchEquipmentForLab: vi.fn(),
    };

    const preloadManager = new PreloadManager(
      mockCasesApi,
      mockRefApi,
      serviceCaseRepo,
      schoolRepo,
      labRepo,
      equipmentRepo,
    );

    // Verify PreloadManager has zero sync engine methods
    expect((preloadManager as any).pushSync).toBeUndefined();
    expect((preloadManager as any).pullDelta).toBeUndefined();
    expect((preloadManager as any).generateDeltaToken).toBeUndefined();
    expect((preloadManager as any).arbitrateConflicts).toBeUndefined();

    // Verify that running preload leaves operation queue completely untouched
    await preloadManager.preloadAssignedDossier(engineerId);
    const operations = await db.get('local_operations').query().fetch();
    expect(operations.length).toBe(0);
  });
});

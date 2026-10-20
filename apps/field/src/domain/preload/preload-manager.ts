/**
 * ZENTRA Field — Preload & Cache Manager
 * apps/field/src/domain/preload/preload-manager.ts
 *
 * Implements authorization-scoped local cache preloading:
 * - Scoped strictly to the authenticated Field Engineer's assigned cases
 * - Fetches dossiers only for schools, labs, and equipment referenced by assigned cases
 * - GUARANTEE: Never downloads whole-state dataset; volume is bounded and configurable.
 *
 * ARCHITECTURAL BOUNDARY:
 * PRELOAD/CACHE ≠ SYNCHRONIZATION
 * This manager strictly performs read/cache foundation retrieval for offline access.
 * It does NOT implement delta synchronization, delta tokens, conflict resolution,
 * operation pushes, or state reconciliation. All synchronization is strictly deferred to Phase 12.
 */

import type { CasesApiService } from '../../api/cases-api';
import type { ReferenceApiService } from '../../api/reference-api';
import type { ServiceCaseRepository } from '../repositories/service-case.repository';
import type { SchoolRepository } from '../repositories/school.repository';
import type { LabRepository } from '../repositories/lab.repository';
import type { EquipmentRepository } from '../repositories/equipment.repository';

export interface PreloadOptions {
  maxCases?: number;
}

export interface PreloadSummary {
  casesPreloaded: number;
  schoolsPreloaded: number;
  labsPreloaded: number;
  equipmentPreloaded: number;
  timestamp: string;
}

export class PreloadManager {
  constructor(
    private readonly casesApi: CasesApiService,
    private readonly refApi: ReferenceApiService,
    private readonly casesRepo: ServiceCaseRepository,
    private readonly schoolRepo: SchoolRepository,
    private readonly labRepo: LabRepository,
    private readonly equipmentRepo: EquipmentRepository,
  ) {}

  /**
   * Preloads assigned cases and their corresponding reference dossiers
   */
  async preloadAssignedDossier(
    engineerId: string,
    options: PreloadOptions = {},
  ): Promise<PreloadSummary> {
    const maxCases = options.maxCases || 50;

    // 1. Fetch authorized assigned service cases from server
    const cases = await this.casesApi.fetchAssignedCases(engineerId, maxCases);
    await this.casesRepo.upsertCasesFromServer(cases);

    // 2. Collect unique referenced school IDs
    const schoolIds = Array.from(new Set(cases.map((c) => c.schoolId).filter(Boolean)));
    let schoolsCount = 0;
    let labsCount = 0;
    let equipmentCount = 0;

    // 3. Preload reference dossiers for referenced schools only
    for (const schoolId of schoolIds) {
      try {
        const school = await this.refApi.fetchSchool(schoolId);
        await this.schoolRepo.upsertSchoolsFromServer([school]);
        schoolsCount++;

        const labs = await this.refApi.fetchLabsForSchool(schoolId);
        await this.labRepo.upsertLabsFromServer(labs);
        labsCount += labs.length;

        for (const lab of labs) {
          try {
            const equipment = await this.refApi.fetchEquipmentForLab(lab.labId);
            await this.equipmentRepo.upsertEquipmentFromServer(equipment);
            equipmentCount += equipment.length;
          } catch {
            // Non-critical reference fetch failures do not abort overall preload
          }
        }
      } catch {
        // Individual school reference failure does not abort other schools
      }
    }

    return {
      casesPreloaded: cases.length,
      schoolsPreloaded: schoolsCount,
      labsPreloaded: labsCount,
      equipmentPreloaded: equipmentCount,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * ZENTRA Field — Service Cases API Service
 * apps/field/src/api/cases-api.ts
 *
 * Interacts with Phase 9 Service Case endpoints for querying assigned cases.
 */

import type { ApiClient } from './api-client';
import type { ServiceCase } from '@zentra/types';

export class CasesApiService {
  constructor(private readonly client: ApiClient) {}

  /**
   * Fetches service cases assigned to the authenticated field engineer
   */
  async fetchAssignedCases(assignedEngineerId: string, limit = 50): Promise<ServiceCase[]> {
    const query = new URLSearchParams({
      assignedEngineerId,
      limit: String(limit),
    });
    return await this.client.get<ServiceCase[]>(`service-cases?${query.toString()}`);
  }

  /**
   * Fetches full details for a single service case
   */
  async fetchCaseDetails(serviceCaseId: string): Promise<ServiceCase> {
    return await this.client.get<ServiceCase>(`service-cases/${serviceCaseId}`);
  }
}

/**
 * ZENTRA Field — Synchronization API Service
 * apps/field/src/sync/sync-api.service.ts
 *
 * Interfaces with ZENTRA Core REST API sync endpoints:
 * - POST /api/v1/sync/push
 * - GET  /api/v1/sync/delta
 */

import type { ApiClient } from '../api/api-client';
import type {
  SyncPushRequest,
  SyncPushResponseData,
  SyncDeltaRequestQuery,
  SyncDeltaResponseData,
} from '@zentra/types';

export class SyncApiService {
  constructor(private readonly client: ApiClient) {}

  /**
   * Pushes a batch of outbound mobile mutations to the server for processing and conflict arbitration.
   */
  async pushMutations(request: SyncPushRequest): Promise<SyncPushResponseData> {
    return await this.client.post<SyncPushResponseData>('sync/push', request);
  }

  /**
   * Pulls downstream row-level delta stream from the server since the given opaque cursor.
   */
  async pullDelta(query: SyncDeltaRequestQuery = {}): Promise<SyncDeltaResponseData> {
    const params = new URLSearchParams();
    if (query.cursor) {
      params.append('cursor', query.cursor);
    }
    if (query.limit) {
      params.append('limit', String(query.limit));
    }

    const endpoint = params.toString() ? `sync/delta?${params.toString()}` : 'sync/delta';
    return await this.client.get<SyncDeltaResponseData>(endpoint);
  }
}

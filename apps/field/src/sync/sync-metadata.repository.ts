/**
 * ZENTRA Field — Synchronization Metadata Repository
 * apps/field/src/sync/sync-metadata.repository.ts
 *
 * Persists and retrieves sync cursors and sync watermarks in the local WatermelonDB sync_metadata table.
 */

import { Database, Q } from '@nozbe/watermelondb';
import { SyncMetadataModel } from '../database/models/SyncMetadataModel';

const KEY_CURSOR = 'sync_cursor';
const KEY_LAST_SYNC_TS = 'last_sync_timestamp';

export class SyncMetadataRepository {
  constructor(private readonly database: Database) {}

  /**
   * Retrieves the current opaque sync cursor from local storage.
   */
  async getCursor(): Promise<string | null> {
    const records = await this.database
      .get<SyncMetadataModel>('sync_metadata')
      .query(Q.where('key', KEY_CURSOR))
      .fetch();

    return records.length > 0 ? records[0]!.value : null;
  }

  /**
   * Persists the opaque sync cursor to local storage.
   * Can be executed within an existing database.write transaction or standalone.
   */
  async setCursor(cursor: string): Promise<void> {
    await this.setKey(KEY_CURSOR, cursor);
  }

  /**
   * Retrieves the ISO timestamp of the last successful sync.
   */
  async getLastSyncTimestamp(): Promise<string | null> {
    const records = await this.database
      .get<SyncMetadataModel>('sync_metadata')
      .query(Q.where('key', KEY_LAST_SYNC_TS))
      .fetch();

    return records.length > 0 ? records[0]!.value : null;
  }

  /**
   * Persists the ISO timestamp of the last successful sync.
   */
  async setLastSyncTimestamp(timestamp: string): Promise<void> {
    await this.setKey(KEY_LAST_SYNC_TS, timestamp);
  }

  /**
   * Internal upsert for key-value pair in sync_metadata table.
   */
  async setKey(key: string, value: string): Promise<void> {
    await this.database.write(async () => {
      const records = await this.database
        .get<SyncMetadataModel>('sync_metadata')
        .query(Q.where('key', key))
        .fetch();

      if (records.length > 0) {
        await records[0]!.update((rec) => {
          rec.value = value;
          rec.updatedAt = new Date();
        });
      } else {
        await this.database.get<SyncMetadataModel>('sync_metadata').create((rec) => {
          rec.key = key;
          rec.value = value;
          rec.updatedAt = new Date();
        });
      }
    });
  }
}

/**
 * ZENTRA Field — Synchronization Metadata Model
 * apps/field/src/database/models/SyncMetadataModel.ts
 *
 * Schema foundation only — synchronization semantics deferred to Phase 12.
 * Minimal key-value metadata container for future Phase 12 integration.
 * Zero sync sequence negotiation, cursor handling, delta tokens, or conflict versions.
 */

import { Model } from '@nozbe/watermelondb';
import { text, date } from '@nozbe/watermelondb/decorators';

export class SyncMetadataModel extends Model {
  static table = 'sync_metadata';

  @text('key') key!: string;
  @text('value') value!: string;
  @date('updated_at') updatedAt!: Date;
}

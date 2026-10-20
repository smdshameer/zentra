/**
 * ZENTRA — Administrative Audit Logging Repository (Service Cases)
 * apps/api/src/modules/service-cases/repositories/audit-events.repository.ts
 *
 * Implements Administrative Audit Logging for service case operations.
 * Terminology: "Administrative Audit Logging" (no unverified immutability claims).
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../../../database/database.types';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import { generateUuidV7 } from '@zentra/shared';

export interface CaseAuditEventEntry {
  actorUserId?: string | null;
  actorIpAddress?: string | null;
  actorDeviceId?: string | null;
  eventCategory: string;
  targetEntityType: string;
  targetEntityId: string;
  actionType: string;
  preMutationState?: Record<string, unknown> | null;
  postMutationState?: Record<string, unknown> | null;
}

@Injectable()
export class CaseAuditEventsRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  async logEvent(
    entry: CaseAuditEventEntry,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<string> {
    const client = trx || this.db;
    const auditId = generateUuidV7();

    await client
      .insertInto('audit_events')
      .values({
        audit_event_id: auditId,
        actor_user_id: entry.actorUserId || null,
        actor_ip_address: entry.actorIpAddress || null,
        actor_device_id: entry.actorDeviceId || null,
        event_category: entry.eventCategory,
        target_entity_type: entry.targetEntityType,
        target_entity_id: entry.targetEntityId,
        action_type: entry.actionType,
        pre_mutation_state: entry.preMutationState ? entry.preMutationState : null,
        post_mutation_state: entry.postMutationState ? entry.postMutationState : null,
      })
      .execute();

    return auditId;
  }
}

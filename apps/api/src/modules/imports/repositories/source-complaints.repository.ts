/**
 * ZENTRA — Source Complaints & Complaint Sources Repository
 * apps/api/src/modules/imports/repositories/source-complaints.repository.ts
 *
 * Handles access to immutable source complaints intake ledger.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, type Transaction, type Insertable, type Selectable } from 'kysely';
import type {
  DatabaseSchema,
  SourceComplaintsTable,
  ComplaintSourcesTable,
} from '../../../database/database.types';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import { generateUuidV7 } from '@zentra/shared';

@Injectable()
export class SourceComplaintsRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  // ==========================================
  // Complaint Sources
  // ==========================================

  async findSourceByCode(
    systemCode: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<ComplaintSourcesTable> | undefined> {
    const client = trx || this.db;
    return await client
      .selectFrom('complaint_sources')
      .where('system_code', '=', systemCode)
      .selectAll()
      .executeTakeFirst();
  }

  async getOrCreateSource(
    systemCode: string,
    systemName: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<ComplaintSourcesTable>> {
    const existing = await this.findSourceByCode(systemCode, trx);
    if (existing) {
      return existing;
    }

    const client = trx || this.db;
    const sourceSystemId = generateUuidV7();

    await client
      .insertInto('complaint_sources')
      .values({
        source_system_id: sourceSystemId,
        system_code: systemCode,
        system_name: systemName,
        description: `Ingestion source: ${systemName}`,
        is_active: true,
      })
      .execute();

    const created = await this.findSourceByCode(systemCode, trx);
    return created!;
  }

  // ==========================================
  // Source Complaints
  // ==========================================

  async findByExternalTicket(
    sourceSystemId: string,
    externalTicketId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<SourceComplaintsTable> | undefined> {
    const client = trx || this.db;
    return await client
      .selectFrom('source_complaints')
      .where('source_system_id', '=', sourceSystemId)
      .where('external_ticket_id', '=', externalTicketId)
      .selectAll()
      .executeTakeFirst();
  }

  async findById(
    sourceComplaintId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<SourceComplaintsTable> | undefined> {
    const client = trx || this.db;
    return await client
      .selectFrom('source_complaints')
      .where('source_complaint_id', '=', sourceComplaintId)
      .selectAll()
      .executeTakeFirst();
  }

  async findComplaintsBySchool(
    schoolId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<SourceComplaintsTable>[]> {
    const client = trx || this.db;
    return await client
      .selectFrom('source_complaints')
      .where('school_id', '=', schoolId)
      .selectAll()
      .orderBy('registered_at', 'desc')
      .execute();
  }

  async insert(
    complaint: Insertable<SourceComplaintsTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<SourceComplaintsTable>> {
    const client = trx || this.db;
    const inserted = await client
      .insertInto('source_complaints')
      .values(complaint)
      .returningAll()
      .executeTakeFirstOrThrow();

    return inserted;
  }

  /**
   * BOUNDARY WALL METHOD:
   * Only mutates allowed unassigned source metadata on source_complaints.
   * NEVER touches service_cases, assignments, visits, or evidence files.
   */
  async updateSourceMetadata(
    sourceComplaintId: string,
    metadata: {
      source_status?: string;
      original_remarks?: string | null;
      raw_payload?: Record<string, unknown>;
    },
    trx?: Transaction<DatabaseSchema>,
  ): Promise<void> {
    const client = trx || this.db;
    const updates: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (metadata.source_status !== undefined) {
      updates.source_status = metadata.source_status;
    }
    if (metadata.original_remarks !== undefined) {
      updates.original_remarks = metadata.original_remarks;
    }
    if (metadata.raw_payload !== undefined) {
      updates.raw_payload = metadata.raw_payload;
    }

    await client
      .updateTable('source_complaints')
      .set(updates)
      .where('source_complaint_id', '=', sourceComplaintId)
      .execute();
  }
}

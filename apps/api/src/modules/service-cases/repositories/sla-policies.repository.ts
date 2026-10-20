/**
 * ZENTRA — SLA Policies Repository
 * apps/api/src/modules/service-cases/repositories/sla-policies.repository.ts
 *
 * Provides database access for SLA resolution policies.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, type Transaction, type Insertable } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema, SlaPoliciesTable } from '../../../database/database.types';
import type { SlaPolicy } from '@zentra/types';

@Injectable()
export class SlaPoliciesRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  async findByPriority(
    priority: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<SlaPolicy | null> {
    const client = trx || this.db;
    const row = await client
      .selectFrom('sla_policies')
      .selectAll()
      .where('priority_level', '=', priority)
      .where('is_active', '=', true)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findById(
    slaPolicyId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<SlaPolicy | null> {
    const client = trx || this.db;
    const row = await client
      .selectFrom('sla_policies')
      .selectAll()
      .where('sla_policy_id', '=', slaPolicyId)
      .executeTakeFirst();

    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findActivePolicies(
    trx?: Transaction<DatabaseSchema>,
  ): Promise<SlaPolicy[]> {
    const client = trx || this.db;
    const rows = await client
      .selectFrom('sla_policies')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('target_resolution_hours', 'asc')
      .execute();

    return rows.map((r) => this.mapToDomain(r));
  }

  async create(
    entry: Insertable<SlaPoliciesTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<SlaPolicy> {
    const client = trx || this.db;
    const row = await client
      .insertInto('sla_policies')
      .values(entry)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapToDomain(row);
  }

  private mapToDomain(row: {
    sla_policy_id: string;
    policy_name: string;
    priority_level: string;
    target_resolution_hours: number;
    warning_threshold_percentage: number;
    is_active: boolean;
    created_at: Date | string;
    updated_at: Date | string;
  }): SlaPolicy {
    return {
      slaPolicyId: row.sla_policy_id,
      policyName: row.policy_name,
      priorityLevel: row.priority_level,
      targetResolutionHours: Number(row.target_resolution_hours),
      warningThresholdPercentage: Number(row.warning_threshold_percentage),
      isActive: Boolean(row.is_active),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }
}

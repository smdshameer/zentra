/**
 * ZENTRA Field — Service Case Local Model
 * apps/field/src/database/models/ServiceCaseModel.ts
 *
 * Primary operational unit for offline field servicing.
 * Tracks local sync state explicitly (SYNCED vs PENDING_SYNC vs LOCAL_ONLY).
 */

import { Model } from '@nozbe/watermelondb';
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators';

export type LocalSyncState = 'SYNCED' | 'PENDING_SYNC' | 'LOCAL_ONLY' | 'CONFLICT';

export class ServiceCaseModel extends Model {
  static table = 'service_cases';

  @text('server_id') serverId!: string;
  @text('zentra_case_code') zentraCaseCode!: string;
  @text('school_id') schoolId!: string;
  @text('lab_id') labId?: string | null;
  @text('equipment_id') equipmentId?: string | null;
  @text('source_complaint_id') sourceComplaintId?: string | null;
  @text('assigned_primary_engineer_id') assignedPrimaryEngineerId!: string;
  @text('assigned_secondary_engineer_id') assignedSecondaryEngineerId?: string | null;
  @text('operational_status') operationalStatus!: string;
  @text('priority') priority!: string;
  @field('sla_target_at') slaTargetAt?: number | null;
  @text('fault_description') faultDescription!: string;
  @text('resolution_notes') resolutionNotes?: string | null;
  @text('server_version') serverVersion?: string | null;
  @text('sync_state') syncState!: LocalSyncState;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;

  get isPendingSync(): boolean {
    return this.syncState === 'PENDING_SYNC' || this.syncState === 'LOCAL_ONLY';
  }
}

/**
 * ZENTRA Field — Field Visit Local Model
 * apps/field/src/database/models/FieldVisitModel.ts
 *
 * Models physical attendance visits performed by a Field Engineer.
 * Represents individual visit lifecycle state and GPS check-in/out records.
 */

import { Model } from '@nozbe/watermelondb';
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators';
import type { LocalSyncState } from './ServiceCaseModel';

export class FieldVisitModel extends Model {
  static table = 'field_visits';

  @text('server_id') serverId!: string;
  @text('service_case_id') serviceCaseId!: string;
  @text('engineer_id') engineerId!: string;
  @field('visit_sequence_number') visitSequenceNumber!: number;
  @text('visit_date') visitDate!: string;
  @text('status') status!: string;
  @field('check_in_timestamp') checkInTimestamp?: number | null;
  @field('check_in_at_device') checkInAtDevice?: number | null;
  @field('check_in_latitude') checkInLatitude?: number | null;
  @field('check_in_longitude') checkInLongitude?: number | null;
  @field('check_in_accuracy_meters') checkInAccuracyMeters?: number | null;
  @field('check_in_distance_meters') checkInDistanceMeters?: number | null;
  @field('check_in_within_geofence') checkInWithinGeofence?: boolean | null;
  @text('equipment_condition_observed') equipmentConditionObserved?: string | null;
  @text('on_site_diagnosis') onSiteDiagnosis?: string | null;
  @text('work_performed') workPerformed?: string | null;
  @text('visit_outcome') visitOutcome?: string | null;
  @text('pending_reason_text') pendingReasonText?: string | null;
  @text('target_next_visit_date') targetNextVisitDate?: string | null;
  @field('check_out_timestamp') checkOutTimestamp?: number | null;
  @field('check_out_at_device') checkOutAtDevice?: number | null;
  @field('check_out_latitude') checkOutLatitude?: number | null;
  @field('check_out_longitude') checkOutLongitude?: number | null;
  @field('check_out_accuracy_meters') checkOutAccuracyMeters?: number | null;
  @text('notes') notes?: string | null;
  @text('server_version') serverVersion?: string | null;
  @text('sync_state') syncState!: LocalSyncState;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;

  get isPendingSync(): boolean {
    return this.syncState === 'PENDING_SYNC' || this.syncState === 'LOCAL_ONLY';
  }
}

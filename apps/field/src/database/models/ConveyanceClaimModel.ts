/**
 * ZENTRA Field — Conveyance Claim Local Model (Phase 15)
 * apps/field/src/database/models/ConveyanceClaimModel.ts
 *
 * Local WatermelonDB model for offline conveyance claims.
 * Tracks local creation, odometer entries, distance, travel mode,
 * provisional rates, calculations, and sync queue state.
 */

import { Model } from '@nozbe/watermelondb';
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators';
import type { LocalSyncState } from './ServiceCaseModel';
import type { TravelMode, ConveyanceClaimStatus } from '@zentra/types';

export class ConveyanceClaimModel extends Model {
  static table = 'conveyance_claims';

  @text('server_id') serverId?: string | null;
  @text('visit_id') visitId!: string;
  @text('service_case_id') serviceCaseId!: string;
  @text('engineer_id') engineerId!: string;
  @text('policy_id') policyId?: string | null;
  @text('travel_date') travelDate!: string;
  @text('from_location') fromLocation!: string;
  @text('to_location') toLocation!: string;
  @text('travel_mode') travelMode!: TravelMode;
  @field('starting_odometer_km') startingOdometerKm?: number | null;
  @field('ending_odometer_km') endingOdometerKm?: number | null;
  @field('calculated_odometer_distance_km') calculatedOdometerDistanceKm?: number | null;
  @field('gps_distance_km') gpsDistanceKm?: number | null;
  @field('captured_distance_km') capturedDistanceKm?: number | null;
  @field('claimed_distance_km') claimedDistanceKm!: number;
  @field('approved_distance_km') approvedDistanceKm?: number | null;
  @field('applied_rate_per_km') appliedRatePerKm!: number;
  @field('rate_policy_version') ratePolicyVersion!: number;
  @field('is_provisional_policy') isProvisionalPolicy!: boolean;
  @field('calculated_amount') calculatedAmount!: number;
  @field('claimed_amount') claimedAmount!: number;
  @field('approved_amount') approvedAmount?: number | null;
  @text('supporting_evidence_file_id') supportingEvidenceFileId?: string | null;
  @text('claim_status') claimStatus!: ConveyanceClaimStatus;
  @field('submitted_at') submittedAt?: number | null;
  @text('submitted_by_user_id') submittedByUserId?: string | null;
  @text('reviewed_by_user_id') reviewedByUserId?: string | null;
  @field('reviewed_at') reviewedAt?: number | null;
  @text('rejection_reason') rejectionReason?: string | null;
  @text('correction_notes') correctionNotes?: string | null;
  @text('remarks') remarks?: string | null;
  @field('version') version!: number;
  @text('sync_state') syncState!: LocalSyncState;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;

  get isDraft(): boolean {
    return this.claimStatus === 'DRAFT';
  }

  get isSubmitted(): boolean {
    return this.claimStatus === 'SUBMITTED';
  }

  get isApproved(): boolean {
    return this.claimStatus === 'APPROVED';
  }

  get isPaid(): boolean {
    return this.claimStatus === 'PAID';
  }

  get isEditable(): boolean {
    return (
      this.claimStatus === 'DRAFT' ||
      this.claimStatus === 'RETURNED_FOR_CORRECTION'
    );
  }
}

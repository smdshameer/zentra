/**
 * ZENTRA Field — Field Conveyance Local Repository (Phase 15)
 * apps/field/src/domain/repositories/conveyance.repository.ts
 *
 * Implements mobile-side Conveyance Claims Management:
 * - Local-first claim creation linked to completed field visits
 * - Odometer validation (ending >= starting)
 * - Calculation transparency with provisional rate disclosures
 * - Offline queueing via WatermelonDB and OperationQueue
 * - Submission transition to SUBMITTED
 */

import { Database, Q } from '@nozbe/watermelondb';
import { ConveyanceClaimModel } from '../../database/models/ConveyanceClaimModel';
import { OperationQueue } from '../queue/operation-queue';
import {
  PROVISIONAL_DEFAULT_CONVEYANCE_RATES,
} from '@zentra/contracts';
import type { TravelMode, ConveyanceClaimStatus } from '@zentra/types';
import { generateUuidV7 } from '@zentra/shared';

export interface CreateLocalClaimParams {
  visitId: string;
  serviceCaseId: string;
  engineerId: string;
  travelDate: string;
  fromLocation: string;
  toLocation: string;
  travelMode: TravelMode;
  startingOdometerKm?: number | null;
  endingOdometerKm?: number | null;
  claimedDistanceKm: number;
  supportingEvidenceFileId?: string | null;
  remarks?: string | null;
  submitImmediately?: boolean;
}

export interface CalculationResult {
  claimedDistanceKm: number;
  appliedRatePerKm: number;
  calculatedAmount: number;
  isProvisional: boolean;
  ratePolicyVersion: number;
  policyDisclaimer: string;
}

export class FieldConveyanceRepository {
  private readonly queue: OperationQueue;

  constructor(private readonly database: Database) {
    this.queue = new OperationQueue(database);
  }

  /**
   * Calculates estimated reimbursement with provisional disclosure.
   * STRICT: PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY
   */
  calculateReimbursement(
    distanceKm: number,
    travelMode: TravelMode,
  ): CalculationResult {
    const ratePerKm = PROVISIONAL_DEFAULT_CONVEYANCE_RATES[travelMode] || 5.0;
    const calculatedAmount = Math.round(distanceKm * ratePerKm * 100) / 100;

    return {
      claimedDistanceKm: distanceKm,
      appliedRatePerKm: ratePerKm,
      calculatedAmount,
      isProvisional: true,
      ratePolicyVersion: 1,
      policyDisclaimer: 'PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY',
    };
  }

  /**
   * Creates a local-first conveyance claim and queues it for sync push.
   */
  async createClaim(params: CreateLocalClaimParams): Promise<ConveyanceClaimModel> {
    // 1. Validate odometer if provided
    if (
      params.startingOdometerKm !== undefined &&
      params.startingOdometerKm !== null &&
      params.endingOdometerKm !== undefined &&
      params.endingOdometerKm !== null
    ) {
      if (params.endingOdometerKm < params.startingOdometerKm) {
        throw new Error(
          `ODOMETER_VALIDATION_ERROR: Ending odometer (${params.endingOdometerKm}) cannot be less than starting odometer (${params.startingOdometerKm})`,
        );
      }
    }

    // 2. Prevent duplicate active claim for visit in local DB
    const existing = await this.getClaimByVisitId(params.visitId);
    if (existing && existing.claimStatus !== 'REJECTED') {
      throw new Error(
        `DUPLICATE_CLAIM_ERROR: An active conveyance claim already exists for visit ${params.visitId}`,
      );
    }

    // 3. Compute calculation
    const calc = this.calculateReimbursement(
      params.claimedDistanceKm,
      params.travelMode,
    );

    const calculatedOdometer =
      params.startingOdometerKm != null && params.endingOdometerKm != null
        ? params.endingOdometerKm - params.startingOdometerKm
        : null;

    const initialStatus: ConveyanceClaimStatus = params.submitImmediately
      ? 'SUBMITTED'
      : 'DRAFT';

    const claimId = generateUuidV7();
    const now = Date.now();

    // 4. Save to WatermelonDB in action
    let claimModel!: ConveyanceClaimModel;

    await this.database.write(async () => {
      const claimsCollection = this.database.get<ConveyanceClaimModel>('conveyance_claims');

      claimModel = await claimsCollection.create((record) => {
        record._raw.id = claimId;
        record.serverId = null;
        record.visitId = params.visitId;
        record.serviceCaseId = params.serviceCaseId;
        record.engineerId = params.engineerId;
        record.policyId = null;
        record.travelDate = params.travelDate;
        record.fromLocation = params.fromLocation;
        record.toLocation = params.toLocation;
        record.travelMode = params.travelMode;
        record.startingOdometerKm = params.startingOdometerKm ?? null;
        record.endingOdometerKm = params.endingOdometerKm ?? null;
        const capturedDistance = calculatedOdometer != null ? calculatedOdometer : params.claimedDistanceKm;
        record.calculatedOdometerDistanceKm = calculatedOdometer;
        record.gpsDistanceKm = null;
        record.capturedDistanceKm = capturedDistance;
        record.claimedDistanceKm = params.claimedDistanceKm;
        record.approvedDistanceKm = null;
        record.appliedRatePerKm = calc.appliedRatePerKm;
        record.ratePolicyVersion = calc.ratePolicyVersion;
        record.isProvisionalPolicy = calc.isProvisional;
        record.calculatedAmount = calc.calculatedAmount;
        record.claimedAmount = calc.calculatedAmount;
        record.approvedAmount = null;
        record.supportingEvidenceFileId = params.supportingEvidenceFileId ?? null;
        record.claimStatus = initialStatus;
        record.submittedAt = params.submitImmediately ? now : null;
        record.submittedByUserId = params.submitImmediately ? params.engineerId : null;
        record.reviewedByUserId = null;
        record.reviewedAt = null;
        record.rejectionReason = null;
        record.correctionNotes = null;
        record.remarks = params.remarks ?? null;
        record.version = 1;
        record.syncState = 'PENDING_SYNC';
      });

      // 5. Enqueue local operation
      const capturedDistance = calculatedOdometer != null ? calculatedOdometer : params.claimedDistanceKm;
      await this.queue.enqueue({
        entityType: 'conveyance_claims',
        localEntityId: claimId,
        operationType: 'INSERT',
        payload: {
          conveyanceClaimId: claimId,
          visitId: params.visitId,
          serviceCaseId: params.serviceCaseId,
          engineerId: params.engineerId,
          submittedByUserId: params.submitImmediately ? params.engineerId : null,
          travelDate: params.travelDate,
          fromLocation: params.fromLocation,
          toLocation: params.toLocation,
          travelMode: params.travelMode,
          startingOdometerKm: params.startingOdometerKm ?? null,
          endingOdometerKm: params.endingOdometerKm ?? null,
          capturedDistanceKm: capturedDistance,
          claimedDistanceKm: params.claimedDistanceKm,
          claimedAmount: calc.calculatedAmount,
          status: initialStatus,
          remarks: params.remarks ?? null,
        },
      });
    });

    return claimModel;
  }

  /**
   * Retrieves a claim by its associated field visit ID.
   */
  async getClaimByVisitId(visitId: string): Promise<ConveyanceClaimModel | null> {
    const claims = await this.database
      .get<ConveyanceClaimModel>('conveyance_claims')
      .query(Q.where('visit_id', visitId))
      .fetch();

    return claims.length > 0 ? claims[0]! : null;
  }

  /**
   * Retrieves a claim by its primary ID.
   */
  async getClaimById(id: string): Promise<ConveyanceClaimModel | null> {
    try {
      return await this.database
        .get<ConveyanceClaimModel>('conveyance_claims')
        .find(id);
    } catch {
      return null;
    }
  }

  /**
   * Submits a draft conveyance claim for coordinator review.
   */
  async submitClaim(id: string, remarks?: string): Promise<ConveyanceClaimModel> {
    const claim = await this.getClaimById(id);
    if (!claim) {
      throw new Error(`Conveyance claim ${id} not found`);
    }

    if (!claim.isEditable) {
      throw new Error(`Cannot submit claim in status '${claim.claimStatus}'`);
    }

    await this.database.write(async () => {
      await claim.update((record) => {
        record.claimStatus = 'SUBMITTED';
        record.submittedAt = Date.now();
        if (remarks) record.remarks = remarks;
        record.syncState = 'PENDING_SYNC';
      });

      await this.queue.enqueue({
        entityType: 'conveyance_claims',
        localEntityId: id,
        operationType: 'STATUS_TRANSITION',
        payload: {
          toStatus: 'SUBMITTED',
          remarks: remarks || claim.remarks,
        },
      });
    });

    return claim;
  }

  /**
   * Lists all local claims.
   */
  async getAllClaims(): Promise<ConveyanceClaimModel[]> {
    return this.database
      .get<ConveyanceClaimModel>('conveyance_claims')
      .query(Q.sortBy('created_at', Q.desc))
      .fetch();
  }
}

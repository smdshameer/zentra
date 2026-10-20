/**
 * ZENTRA — Field Visits Service
 * apps/api/src/modules/visits/services/visits.service.ts
 *
 * Implements core domain logic for Field Visit execution:
 * - Deterministic visit sequencing (1, 2, 3...) per service case
 * - Explicit visit lifecycle state machine (PLANNED -> EN_ROUTE -> CHECKED_IN -> IN_PROGRESS -> COMPLETED)
 * - Proximity and GPS accuracy validation (<= 50m) against school coordinates
 * - Configurable geofence radius (provisional default, not permanent policy)
 * - Multi-visit support (Visit 1 PENDING_PARTS -> Visit 2 RESOLVED_ON_SITE)
 * - Append-only transition audit history and Phase 9 case lifecycle interaction
 */

import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Kysely } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema } from '../../../database/database.types';
import { VisitsRepository } from '../repositories/visits.repository';
import { VisitStatusHistoryRepository } from '../repositories/visit-status-history.repository';
import { generateUuidV7 } from '@zentra/shared';
import type {
  CreateFieldVisitDto,
  CheckInFieldVisitDto,
  StartWorkFieldVisitDto,
  CheckOutFieldVisitDto,
  QueryFieldVisitsDto,
} from '@zentra/contracts';
import type { FieldVisit, VisitStatus, OperationalStatus } from '@zentra/types';

/**
 * Valid Visit State Transitions Graph
 */
export const VALID_VISIT_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  PLANNED: ['EN_ROUTE', 'CHECKED_IN', 'CANCELLED'],
  EN_ROUTE: ['CHECKED_IN', 'CANCELLED', 'PLANNED'],
  CHECKED_IN: ['IN_PROGRESS', 'ABORTED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'PENDING_RETURN', 'ABORTED'],
  COMPLETED: [],
  CANCELLED: [],
  ABORTED: [],
  PENDING_RETURN: [],
};

export interface CheckInVerificationResult {
  distanceMeters: number;
  isWithinGeofence: boolean;
  accuracyMeters: number;
  isAccuracyValid: boolean;
  schoolLatitude: number;
  schoolLongitude: number;
}

@Injectable()
export class VisitsService {
  /**
   * Technical provisional default radius in meters.
   * PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY.
   */
  private readonly defaultGeofenceRadiusMeters: number;
  private readonly maxGpsAccuracyMeters: number = 50;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
    @Inject(VisitsRepository)
    private readonly visitsRepo: VisitsRepository,
    @Inject(VisitStatusHistoryRepository)
    private readonly historyRepo: VisitStatusHistoryRepository,
  ) {
    const envRadius = process.env.GEOFENCE_RADIUS_METERS;
    this.defaultGeofenceRadiusMeters = envRadius ? Number(envRadius) : 500;
  }

  /**
   * Resolves the active geofence radius.
   * Preserves configurable resolution without hardcoded business rules.
   */
  resolveGeofenceRadius(callerRadius?: number): number {
    return callerRadius ?? this.defaultGeofenceRadiusMeters;
  }

  /**
   * Calculates Haversine distance between two coordinates in meters.
   */
  calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000; // Earth's mean radius in meters
    const toRad = (d: number) => (d * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 100) / 100;
  }

  /**
   * Validates state machine transition.
   */
  isValidTransition(from: VisitStatus, to: VisitStatus): boolean {
    const allowed = VALID_VISIT_TRANSITIONS[from];
    if (!allowed) return false;
    return allowed.includes(to);
  }

  /**
   * Revalidates user territory and case authorization.
   */
  private async validateUserCaseAccess(
    userId: string,
    userRoles: string[],
    serviceCaseId: string,
  ): Promise<{ caseRecord: any; schoolRecord: any }> {
    const caseRecord = await this.db
      .selectFrom('service_cases')
      .where('service_case_id', '=', serviceCaseId)
      .where('is_deleted', '=', false)
      .selectAll()
      .executeTakeFirst();

    if (!caseRecord) {
      throw new NotFoundException(`Service case ${serviceCaseId} not found or inactive`);
    }

    const schoolRecord = await this.db
      .selectFrom('schools')
      .where('school_id', '=', caseRecord.school_id)
      .selectAll()
      .executeTakeFirst();

    if (!schoolRecord) {
      throw new NotFoundException(`School for service case ${serviceCaseId} not found`);
    }

    const isMasterOrReporting =
      userRoles.includes('MASTER_ADMIN') || userRoles.includes('REPORTING_HEAD');

    if (!isMasterOrReporting) {
      const userAssignments = await this.db
        .selectFrom('user_territory_assignments')
        .where('user_id', '=', userId)
        .where((eb) =>
          eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', new Date())]),
        )
        .select(['district_id', 'block_id'])
        .execute();

      const assignedDistrictIds = userAssignments.map((a) => a.district_id);

      if (userRoles.includes('FIELD_ENGINEER')) {
        const isAssignedToCase =
          caseRecord.assigned_primary_engineer_id === userId ||
          caseRecord.assigned_secondary_engineer_id === userId;
        const hasDistrictAccess = assignedDistrictIds.includes(schoolRecord.district_id);

        if (!isAssignedToCase && !hasDistrictAccess) {
          throw new ForbiddenException(
            `Field Engineer ${userId} is not assigned to case ${serviceCaseId} and lacks district territory authorization.`,
          );
        }
      } else if (userRoles.includes('DISTRICT_COORDINATOR')) {
        const hasDistrictAccess = assignedDistrictIds.includes(schoolRecord.district_id);
        if (!hasDistrictAccess) {
          throw new ForbiddenException(
            `District Coordinator ${userId} does not have territory access to district ${schoolRecord.district_id}.`,
          );
        }
      }
    }

    return { caseRecord, schoolRecord };
  }

  /**
   * Creates a new Field Visit against an active service case.
   * Transactionally calculates next sequence number (1, 2, 3...).
   */
  async createVisit(
    userId: string,
    userRoles: string[],
    dto: CreateFieldVisitDto,
  ): Promise<FieldVisit> {
    return await this.db.transaction().execute(async (trx) => {
      // 1. Authorize access
      const { caseRecord } = await this.validateUserCaseAccess(
        userId,
        userRoles,
        dto.serviceCaseId,
      );

      // 2. Validate case operational state
      const caseStatus = caseRecord.operational_status as OperationalStatus;
      if (caseStatus === 'CLOSED' || caseStatus === 'RESOLVED') {
        throw new BadRequestException(
          `Cannot create visit: Service case is in final status '${caseStatus}'.`,
        );
      }

      // 3. Determine engineer ID
      let engineerId = dto.engineerId;
      if (!engineerId) {
        if (userRoles.includes('FIELD_ENGINEER')) {
          engineerId = userId;
        } else if (caseRecord.assigned_primary_engineer_id) {
          engineerId = caseRecord.assigned_primary_engineer_id;
        } else {
          throw new BadRequestException(
            'Cannot create visit: An engineerId must be provided or service case must have an assigned primary engineer.',
          );
        }
      }

      // 4. Calculate next sequence number transactionally
      const nextSequence = await this.visitsRepo.getNextSequenceNumber(
        dto.serviceCaseId,
        trx,
      );

      const visitId = generateUuidV7();
      const visitDate = dto.visitDate || new Date().toISOString().split('T')[0]!;

      // 5. Insert field visit
      await this.visitsRepo.create(
        {
          visit_id: visitId,
          service_case_id: dto.serviceCaseId,
          engineer_id: engineerId!,
          visit_sequence_number: nextSequence,
          visit_date: visitDate,
          status: 'PLANNED',
          visit_outcome: 'RESOLVED_ON_SITE', // provisional default until checked out
          target_next_visit_date: dto.targetNextVisitDate || null,
          notes: dto.notes || null,
          version: 1,
          client_operation_id: dto.clientOperationId || null,
        },
        trx,
      );

      // 6. Record append-only status history
      await this.historyRepo.recordTransition(
        {
          history_id: generateUuidV7(),
          visit_id: visitId,
          from_status: 'PLANNED',
          to_status: 'PLANNED',
          changed_by_user_id: userId,
          transition_reason: `Initial visit creation (Sequence ${nextSequence})`,
          client_operation_id: dto.clientOperationId || null,
        },
        trx,
      );

      // 7. Record administrative audit event
      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          actor_user_id: userId,
          actor_ip_address: null,
          actor_device_id: null,
          event_category: 'FIELD_VISIT',
          target_entity_type: 'field_visits',
          target_entity_id: visitId,
          action_type: 'VISIT_CREATED',
          pre_mutation_state: null,
          post_mutation_state: {
            visitId,
            serviceCaseId: dto.serviceCaseId,
            sequenceNumber: nextSequence,
            engineerId: engineerId!,
            status: 'PLANNED',
          },
        })
        .execute();

      const visit = await this.visitsRepo.findById(visitId, trx);
      return visit!;
    });
  }

  /**
   * Executes GPS Proximity Check-In.
   * Validates GPS accuracy (<= 50m) and geofence proximity against school coordinates.
   */
  async checkIn(
    visitId: string,
    userId: string,
    userRoles: string[],
    dto: CheckInFieldVisitDto,
  ): Promise<FieldVisit> {
    return await this.db.transaction().execute(async (trx) => {
      const visit = await this.visitsRepo.findById(visitId, trx);
      if (!visit) {
        throw new NotFoundException(`Field visit ${visitId} not found`);
      }

      // Verify engineer identity: only the assigned engineer or an admin/coordinator can check in
      const isMasterOrCoordinator =
        userRoles.includes('MASTER_ADMIN') || userRoles.includes('DISTRICT_COORDINATOR');
      if (visit.engineerId !== userId && !isMasterOrCoordinator) {
        throw new ForbiddenException(
          `Only assigned engineer ${visit.engineerId} or an authorized coordinator can check in for this visit.`,
        );
      }

      // Validate lifecycle state transition
      if (!this.isValidTransition(visit.status, 'CHECKED_IN')) {
        throw new BadRequestException(
          `Cannot check in: Current visit status is '${visit.status}'. Allowed transitions: [${(VALID_VISIT_TRANSITIONS[visit.status] || []).join(', ')}]`,
        );
      }

      // Concurrency check if client base version was provided
      if (dto.clientBaseVersion !== undefined && dto.clientBaseVersion !== null) {
        if (String(dto.clientBaseVersion) !== String(visit.version)) {
          throw new BadRequestException(
            `Version conflict: client mutation based on version ${dto.clientBaseVersion}, but visit is at version ${visit.version}.`,
          );
        }
      }

      // Fetch school location
      const { caseRecord, schoolRecord } = await this.validateUserCaseAccess(
        userId,
        userRoles,
        visit.serviceCaseId,
      );

      if (caseRecord.operational_status === 'CLOSED') {
        throw new BadRequestException(
          `Cannot check in: Service case is in final status 'CLOSED'.`,
        );
      }

      // Validate GPS accuracy threshold
      if (dto.accuracyMeters > this.maxGpsAccuracyMeters) {
        throw new BadRequestException(
          `GPS accuracy of ${dto.accuracyMeters}m exceeds the required threshold of <= ${this.maxGpsAccuracyMeters}m for physical on-site evidence.`,
        );
      }

      // Calculate distance from school
      let distanceMeters: number | null = null;
      let isWithinGeofence = false;
      const radius = this.resolveGeofenceRadius();

      if (schoolRecord.latitude !== null && schoolRecord.longitude !== null) {
        const schoolLat = Number(schoolRecord.latitude);
        const schoolLon = Number(schoolRecord.longitude);
        distanceMeters = this.calculateHaversineDistance(
          dto.latitude,
          dto.longitude,
          schoolLat,
          schoolLon,
        );
        isWithinGeofence = distanceMeters <= radius;
      } else {
        // School does not have coordinates configured in master data
        isWithinGeofence = true;
      }

      const now = new Date();
      const nextVersion = visit.version + 1;

      // Update visit
      await this.visitsRepo.update(
        visitId,
        {
          status: 'CHECKED_IN',
          check_in_timestamp: now,
          check_in_at_device: new Date(dto.capturedAt),
          check_in_at_server: now,
          check_in_latitude: dto.latitude,
          check_in_longitude: dto.longitude,
          check_in_accuracy_meters: dto.accuracyMeters,
          check_in_distance_meters: distanceMeters,
          check_in_within_geofence: isWithinGeofence,
          equipment_condition_observed: dto.equipmentConditionObserved || visit.equipmentConditionObserved,
          notes: dto.notes || visit.notes,
          version: nextVersion,
          client_operation_id: dto.clientOperationId || visit.clientOperationId,
        },
        trx,
      );

      // Record status history
      await this.historyRepo.recordTransition(
        {
          history_id: generateUuidV7(),
          visit_id: visitId,
          from_status: visit.status,
          to_status: 'CHECKED_IN',
          changed_by_user_id: userId,
          transition_reason: `GPS Check-in (Distance: ${distanceMeters ?? 'unknown'}m, Accuracy: ${dto.accuracyMeters}m)`,
          client_operation_id: dto.clientOperationId || null,
        },
        trx,
      );

      // Phase 9 Service Case Lifecycle Interaction:
      // If service case is in ASSIGNED, IN_TRANSIT, or PENDING_PARTS, advance it to VISIT_STARTED
      if (
        caseRecord.operational_status === 'ASSIGNED' ||
        caseRecord.operational_status === 'IN_TRANSIT' ||
        caseRecord.operational_status === 'PENDING_PARTS'
      ) {
        await trx
          .updateTable('service_cases')
          .set({
            operational_status: 'VISIT_STARTED',
            updated_at: now,
          })
          .where('service_case_id', '=', visit.serviceCaseId)
          .execute();

        await trx
          .insertInto('service_case_status_history')
          .values({
            status_history_id: generateUuidV7(),
            service_case_id: visit.serviceCaseId,
            from_status: caseRecord.operational_status,
            to_status: 'VISIT_STARTED',
            changed_by_user_id: userId,
            transition_reason: `Field visit ${visit.visitSequenceNumber} checked in on site`,
          })
          .execute();
      }

      // Record audit event
      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          actor_user_id: userId,
          actor_ip_address: null,
          actor_device_id: null,
          event_category: 'FIELD_VISIT',
          target_entity_type: 'field_visits',
          target_entity_id: visitId,
          action_type: 'CHECK_IN',
          pre_mutation_state: { status: visit.status, version: visit.version },
          post_mutation_state: {
            status: 'CHECKED_IN',
            version: nextVersion,
            latitude: dto.latitude,
            longitude: dto.longitude,
            accuracy: dto.accuracyMeters,
            distance: distanceMeters,
            withinGeofence: isWithinGeofence,
          },
        })
        .execute();

      return (await this.visitsRepo.findById(visitId, trx))!;
    });
  }

  /**
   * Transitions visit to IN_PROGRESS when work begins.
   */
  async startWork(
    visitId: string,
    userId: string,
    userRoles: string[],
    dto: StartWorkFieldVisitDto,
  ): Promise<FieldVisit> {
    return await this.db.transaction().execute(async (trx) => {
      const visit = await this.visitsRepo.findById(visitId, trx);
      if (!visit) {
        throw new NotFoundException(`Field visit ${visitId} not found`);
      }

      const { caseRecord } = await this.validateUserCaseAccess(
        userId,
        userRoles,
        visit.serviceCaseId,
      );

      if (caseRecord.operational_status === 'CLOSED') {
        throw new BadRequestException(
          `Cannot start work: Service case is in final status 'CLOSED'.`,
        );
      }

      if (!this.isValidTransition(visit.status, 'IN_PROGRESS')) {
        throw new BadRequestException(
          `Cannot start work: Current visit status is '${visit.status}'. Allowed transitions: [${(VALID_VISIT_TRANSITIONS[visit.status] || []).join(', ')}]`,
        );
      }

      if (dto.clientBaseVersion !== undefined && dto.clientBaseVersion !== null) {
        if (String(dto.clientBaseVersion) !== String(visit.version)) {
          throw new BadRequestException(
            `Version conflict: client mutation based on version ${dto.clientBaseVersion}, but visit is at version ${visit.version}.`,
          );
        }
      }

      const now = new Date();
      const nextVersion = visit.version + 1;

      await this.visitsRepo.update(
        visitId,
        {
          status: 'IN_PROGRESS',
          on_site_diagnosis: dto.onSiteDiagnosis || visit.onSiteDiagnosis,
          equipment_condition_observed: dto.equipmentConditionObserved || visit.equipmentConditionObserved,
          notes: dto.notes || visit.notes,
          version: nextVersion,
          client_operation_id: dto.clientOperationId || visit.clientOperationId,
        },
        trx,
      );

      await this.historyRepo.recordTransition(
        {
          history_id: generateUuidV7(),
          visit_id: visitId,
          from_status: visit.status,
          to_status: 'IN_PROGRESS',
          changed_by_user_id: userId,
          transition_reason: 'Engineer commenced diagnostic and maintenance procedures',
          client_operation_id: dto.clientOperationId || null,
        },
        trx,
      );

      // Phase 9 Case Lifecycle Interaction: Advance case to IN_PROGRESS if VISIT_STARTED or PENDING_PARTS
      if (
        caseRecord.operational_status === 'VISIT_STARTED' ||
        caseRecord.operational_status === 'PENDING_PARTS'
      ) {
        await trx
          .updateTable('service_cases')
          .set({
            operational_status: 'IN_PROGRESS',
            actual_diagnosis_summary: dto.onSiteDiagnosis || undefined,
            updated_at: now,
          })
          .where('service_case_id', '=', visit.serviceCaseId)
          .execute();

        await trx
          .insertInto('service_case_status_history')
          .values({
            status_history_id: generateUuidV7(),
            service_case_id: visit.serviceCaseId,
            from_status: caseRecord.operational_status,
            to_status: 'IN_PROGRESS',
            changed_by_user_id: userId,
            transition_reason: `Field visit ${visit.visitSequenceNumber} work in progress`,
          })
          .execute();
      } else {
        await trx
          .updateTable('service_cases')
          .set({
            actual_diagnosis_summary: dto.onSiteDiagnosis || undefined,
            updated_at: now,
          })
          .where('service_case_id', '=', visit.serviceCaseId)
          .execute();
      }

      return (await this.visitsRepo.findById(visitId, trx))!;
    });
  }

  /**
   * Executes Visit Check-Out with structured outcome and work summary.
   */
  async checkOut(
    visitId: string,
    userId: string,
    userRoles: string[],
    dto: CheckOutFieldVisitDto,
  ): Promise<FieldVisit> {
    return await this.db.transaction().execute(async (trx) => {
      const visit = await this.visitsRepo.findById(visitId, trx);
      if (!visit) {
        throw new NotFoundException(`Field visit ${visitId} not found`);
      }

      const { caseRecord } = await this.validateUserCaseAccess(
        userId,
        userRoles,
        visit.serviceCaseId,
      );

      if (caseRecord.operational_status === 'CLOSED') {
        throw new BadRequestException(
          `Cannot check out: Service case is in final status 'CLOSED'.`,
        );
      }

      // Check-out can be performed from IN_PROGRESS or CHECKED_IN
      let targetStatus: VisitStatus = 'COMPLETED';
      if (
        dto.visitOutcome === 'PENDING_PARTS' ||
        dto.visitOutcome === 'RETURN_VISIT_REQUIRED'
      ) {
        targetStatus = 'PENDING_RETURN';
      } else if (
        dto.visitOutcome === 'ABORTED_SCHOOL_CLOSED' ||
        dto.visitOutcome === 'UNABLE_TO_REPRODUCE'
      ) {
        targetStatus = 'ABORTED';
      }

      if (!this.isValidTransition(visit.status, targetStatus)) {
        throw new BadRequestException(
          `Cannot check out: Cannot transition visit from '${visit.status}' to '${targetStatus}'. Allowed: [${(VALID_VISIT_TRANSITIONS[visit.status] || []).join(', ')}]`,
        );
      }

      if (dto.clientBaseVersion !== undefined && dto.clientBaseVersion !== null) {
        if (String(dto.clientBaseVersion) !== String(visit.version)) {
          throw new BadRequestException(
            `Version conflict: client mutation based on version ${dto.clientBaseVersion}, but visit is at version ${visit.version}.`,
          );
        }
      }

      const now = new Date();
      const nextVersion = visit.version + 1;

      await this.visitsRepo.update(
        visitId,
        {
          status: targetStatus,
          visit_outcome: dto.visitOutcome,
          work_performed: dto.workPerformed || visit.workPerformed,
          on_site_diagnosis: dto.onSiteDiagnosis || visit.onSiteDiagnosis,
          equipment_condition_observed: dto.equipmentConditionObserved || visit.equipmentConditionObserved,
          pending_reason_text: dto.pendingReasonText || null,
          target_next_visit_date: dto.targetNextVisitDate || null,
          check_out_timestamp: now,
          check_out_at_device: dto.capturedAt ? new Date(dto.capturedAt) : null,
          check_out_at_server: now,
          check_out_latitude: dto.latitude ?? null,
          check_out_longitude: dto.longitude ?? null,
          check_out_accuracy_meters: dto.accuracyMeters ?? null,
          notes: dto.notes || visit.notes,
          version: nextVersion,
          client_operation_id: dto.clientOperationId || visit.clientOperationId,
        },
        trx,
      );

      await this.historyRepo.recordTransition(
        {
          history_id: generateUuidV7(),
          visit_id: visitId,
          from_status: visit.status,
          to_status: targetStatus,
          changed_by_user_id: userId,
          transition_reason: `Check-out with outcome: ${dto.visitOutcome}${dto.pendingReasonText ? ` (${dto.pendingReasonText})` : ''}`,
          client_operation_id: dto.clientOperationId || null,
        },
        trx,
      );

      // Phase 9 Service Case Lifecycle Interaction:
      // Distinct from closing the case!
      if (dto.visitOutcome === 'PENDING_PARTS' || dto.visitOutcome === 'RETURN_VISIT_REQUIRED') {
        await trx
          .updateTable('service_cases')
          .set({
            operational_status: 'PENDING_PARTS',
            actual_action_taken_summary: dto.workPerformed || undefined,
            updated_at: now,
          })
          .where('service_case_id', '=', visit.serviceCaseId)
          .execute();

        await trx
          .insertInto('service_case_status_history')
          .values({
            status_history_id: generateUuidV7(),
            service_case_id: visit.serviceCaseId,
            from_status: 'IN_PROGRESS',
            to_status: 'PENDING_PARTS',
            changed_by_user_id: userId,
            transition_reason: `Visit ${visit.visitSequenceNumber} completed with pending parts: ${dto.pendingReasonText || 'Parts required'}`,
          })
          .execute();
      } else if (dto.visitOutcome === 'PENDING_OEM_ESCALATION') {
        await trx
          .updateTable('service_cases')
          .set({
            operational_status: 'ESCALATED_OEM',
            actual_action_taken_summary: dto.workPerformed || undefined,
            updated_at: now,
          })
          .where('service_case_id', '=', visit.serviceCaseId)
          .execute();

        await trx
          .insertInto('service_case_status_history')
          .values({
            status_history_id: generateUuidV7(),
            service_case_id: visit.serviceCaseId,
            from_status: 'IN_PROGRESS',
            to_status: 'ESCALATED_OEM',
            changed_by_user_id: userId,
            transition_reason: `Visit ${visit.visitSequenceNumber} escalated to OEM: ${dto.pendingReasonText || 'OEM intervention required'}`,
          })
          .execute();
      } else if (dto.visitOutcome === 'RESOLVED_ON_SITE') {
        if (caseRecord.operational_status === 'IN_PROGRESS') {
          await trx
            .updateTable('service_cases')
            .set({
              operational_status: 'RESOLVED',
              actual_action_taken_summary: dto.workPerformed || undefined,
              actual_diagnosis_summary: dto.onSiteDiagnosis || undefined,
              updated_at: now,
            })
            .where('service_case_id', '=', visit.serviceCaseId)
            .execute();

          await trx
            .insertInto('service_case_status_history')
            .values({
              status_history_id: generateUuidV7(),
              service_case_id: visit.serviceCaseId,
              from_status: 'IN_PROGRESS',
              to_status: 'RESOLVED',
              changed_by_user_id: userId,
              transition_reason: `Field visit ${visit.visitSequenceNumber} resolved on site (awaiting administrative verification/closure)`,
            })
            .execute();
        } else {
          await trx
            .updateTable('service_cases')
            .set({
              actual_action_taken_summary: dto.workPerformed || undefined,
              actual_diagnosis_summary: dto.onSiteDiagnosis || undefined,
              updated_at: now,
            })
            .where('service_case_id', '=', visit.serviceCaseId)
            .execute();
        }
      }

      await trx
        .insertInto('audit_events')
        .values({
          audit_event_id: generateUuidV7(),
          actor_user_id: userId,
          actor_ip_address: null,
          actor_device_id: null,
          event_category: 'FIELD_VISIT',
          target_entity_type: 'field_visits',
          target_entity_id: visitId,
          action_type: 'CHECK_OUT',
          pre_mutation_state: { status: visit.status, version: visit.version },
          post_mutation_state: {
            status: targetStatus,
            outcome: dto.visitOutcome,
            version: nextVersion,
          },
        })
        .execute();

      return (await this.visitsRepo.findById(visitId, trx))!;
    });
  }

  /**
   * Queries visits with pagination and filtering.
   */
  async queryVisits(
    filters: QueryFieldVisitsDto,
  ): Promise<{
    items: FieldVisit[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  }> {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const result = await this.visitsRepo.queryVisits(filters);
    const totalPages = Math.ceil(result.total / limit);

    return {
      items: result.data,
      total: result.total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  /**
   * Retrieves all visits for a service case with territory authorization.
   */
  async getVisitsForCase(
    serviceCaseId: string,
    userId: string,
    userRoles: string[],
  ): Promise<FieldVisit[]> {
    await this.validateUserCaseAccess(userId, userRoles, serviceCaseId);
    return await this.visitsRepo.findByCaseId(serviceCaseId);
  }

  /**
   * Retrieves visit by ID.
   */
  async getVisitById(
    visitId: string,
    userId: string,
    userRoles: string[],
  ): Promise<{ visit: FieldVisit; history: any[] }> {
    const visit = await this.visitsRepo.findById(visitId);
    if (!visit) {
      throw new NotFoundException(`Field visit ${visitId} not found`);
    }

    await this.validateUserCaseAccess(userId, userRoles, visit.serviceCaseId);
    const history = await this.historyRepo.findByVisitId(visitId);

    return { visit, history };
  }
}

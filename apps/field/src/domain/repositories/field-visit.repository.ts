/**
 * ZENTRA Field — Field Visit Local Repository
 * apps/field/src/domain/repositories/field-visit.repository.ts
 *
 * Implements offline-first data access and atomic local mutations for Field Visits:
 * - Deterministic sequence generation per case (1, 2, 3...)
 * - GPS proximity check-in with accuracy gating (<= 50m) and provisional geofence verification
 * - Transition flow: PLANNED -> CHECKED_IN -> IN_PROGRESS -> COMPLETED (or PENDING_RETURN/ABORTED)
 * - Structured outcome recording and service case status updates
 * - Atomic local operation queue logging for Phase 12 sync engine
 */

import { Database, Q } from '@nozbe/watermelondb';
import { FieldVisitModel } from '../../database/models/FieldVisitModel';
import { ServiceCaseModel } from '../../database/models/ServiceCaseModel';
import { OperationQueue } from '../queue/operation-queue';
import { IdentityMap, isValidUuid } from '../identity/identity-map';
import type { LocationService, ValidatedLocationAcquisition } from '../../hardware/location/location-service';
import type { FieldVisit, VisitOutcome, VisitStatus } from '@zentra/types';

export interface LocalVisitCheckInResult {
  visit: FieldVisitModel;
  acquisition: ValidatedLocationAcquisition;
  distanceMeters: number | null;
  isWithinGeofence: boolean;
  clientOperationId: string;
}

export class FieldVisitRepository {
  private readonly queue: OperationQueue;
  private readonly inFlightCreationLocks = new Set<string>();

  constructor(private readonly database: Database) {
    this.queue = new OperationQueue(database);
  }

  /**
   * Fetches all visits for a specific service case, sorted by sequence number.
   * Resolves both local and server case identifiers to ensure full offline recall.
   */
  async getVisitsForCase(serviceCaseId: string): Promise<FieldVisitModel[]> {
    let localId = serviceCaseId;
    let serverId = serviceCaseId;
    try {
      const caseRecord = await this.database
        .get<ServiceCaseModel>('service_cases')
        .find(serviceCaseId);
      if (caseRecord) {
        localId = caseRecord.id;
        if (caseRecord.serverId) serverId = caseRecord.serverId;
      }
    } catch {
      const byServer = await this.database
        .get<ServiceCaseModel>('service_cases')
        .query(Q.where('server_id', serviceCaseId))
        .fetch();
      if (byServer.length > 0) {
        localId = byServer[0]!.id;
        if (byServer[0]!.serverId) serverId = byServer[0]!.serverId;
      }
    }

    const conditions = [Q.where('service_case_id', serviceCaseId)];
    if (localId !== serviceCaseId) {
      conditions.push(Q.where('service_case_id', localId));
    }
    if (serverId !== serviceCaseId) {
      conditions.push(Q.where('service_case_id', serverId));
    }

    return await this.database
      .get<FieldVisitModel>('field_visits')
      .query(
        conditions.length > 1 ? Q.or(...conditions) : conditions[0]!,
        Q.sortBy('visit_sequence_number', Q.asc),
      )
      .fetch();
  }

  /**
   * Alias for getVisitsForCase
   */
  async findByCaseId(serviceCaseId: string): Promise<FieldVisitModel[]> {
    return this.getVisitsForCase(serviceCaseId);
  }

  /**
   * Finds single local visit by local database ID.
   */
  async findById(id: string): Promise<FieldVisitModel | null> {
    try {
      return await this.database.get<FieldVisitModel>('field_visits').find(id);
    } catch {
      return null;
    }
  }

  /**
   * Finds single local visit by server ID.
   */
  async findByServerId(serverId: string): Promise<FieldVisitModel | null> {
    const records = await this.database
      .get<FieldVisitModel>('field_visits')
      .query(Q.where('server_id', serverId))
      .fetch();
    return records[0] || null;
  }

  /**
   * Creates a new Field Visit locally while offline.
   * Atomically computes the next sequence number and queues an INSERT operation.
   * Resolves the parent service case server UUID for the sync mutation payload.
   */
  async createVisitLocally(params: {
    serviceCaseId: string;
    engineerId: string;
    visitDate?: string;
    notes?: string;
    targetNextVisitDate?: string;
    allowConcurrentActive?: boolean;
  }): Promise<FieldVisitModel> {
    if (this.inFlightCreationLocks.has(params.serviceCaseId)) {
      throw new Error(`Visit creation already in progress for service case ${params.serviceCaseId}`);
    }

    this.inFlightCreationLocks.add(params.serviceCaseId);

    try {
      // 1. Authoritative Parent Service Case Resolution & Existence Check
      let parentCase: ServiceCaseModel | null = null;
      try {
        parentCase = await this.database
          .get<ServiceCaseModel>('service_cases')
          .find(params.serviceCaseId);
      } catch {
        const byServer = await this.database
          .get<ServiceCaseModel>('service_cases')
          .query(Q.where('server_id', params.serviceCaseId))
          .fetch();
        if (byServer.length > 0) {
          parentCase = byServer[0]!;
        }
      }

      if (!parentCase) {
        throw new Error(
          `Cannot create visit: Parent service case '${params.serviceCaseId}' does not exist in local database.`,
        );
      }

      // 2. Authoritative Server UUID Format Validation
      const serverCaseId = parentCase.serverId;
      if (!serverCaseId || !isValidUuid(serverCaseId)) {
        throw new Error(
          `Cannot create visit: Parent service case '${params.serviceCaseId}' has missing or invalid serverId ('${serverCaseId || ''}'). An authoritative server UUID is required before enqueuing a visit mutation.`,
        );
      }

      const clientOpId = IdentityMap.generateOperationId();

      return await this.database.write(async () => {
        // 1. Guard against concurrent / duplicate visits: check for existing active, incomplete visit
        const existingVisits = await this.getVisitsForCase(params.serviceCaseId);

        const activeVisit = existingVisits.find((v) =>
          ['PLANNED', 'EN_ROUTE', 'CHECKED_IN', 'IN_PROGRESS'].includes(v.status),
        );
        if (activeVisit && !params.allowConcurrentActive) {
          throw new Error(
            `Cannot create visit: Service case ${params.serviceCaseId} already has an active visit (Visit #${activeVisit.visitSequenceNumber}, status: ${activeVisit.status}). Complete or abort the active visit before starting a new one.`,
          );
        }

        // 2. Calculate deterministic next sequence number
        const maxSeq = existingVisits.reduce(
          (max, v) => (v.visitSequenceNumber > max ? v.visitSequenceNumber : max),
          0,
        );
        const nextSequence = maxSeq + 1;

        const visitDate = params.visitDate || new Date().toISOString().split('T')[0]!;

        // 3. Create local field visit entity
        const newVisit = await this.database
          .get<FieldVisitModel>('field_visits')
          .create((rec) => {
            rec.serverId = clientOpId;
            rec.serviceCaseId = params.serviceCaseId;
            rec.engineerId = params.engineerId;
            rec.visitSequenceNumber = nextSequence;
            rec.visitDate = visitDate;
            rec.status = 'PLANNED';
            rec.notes = params.notes || null;
            rec.targetNextVisitDate = params.targetNextVisitDate || null;
            rec.serverVersion = '1';
            rec.syncState = 'LOCAL_ONLY';
          });

        // 4. Queue atomic operation for sync
        await this.queue.enqueue({
          clientOperationId: clientOpId,
          entityType: 'field_visits',
          localEntityId: newVisit.id,
          serverEntityId: newVisit.serverId,
          operationType: 'INSERT',
          baseVersion: '1',
          payload: {
            serviceCaseId: serverCaseId,
            engineerId: params.engineerId,
            visitSequenceNumber: nextSequence,
            visitDate,
            notes: params.notes,
            targetNextVisitDate: params.targetNextVisitDate,
          },
        });

        return newVisit;
      });
    } finally {
      this.inFlightCreationLocks.delete(params.serviceCaseId);
    }
  }

  /**
   * Executes GPS proximity check-in locally.
   * Captures GPS via LocationService, validates <= 50m accuracy,
   * verifies provisional geofence, transitions visit to CHECKED_IN,
   * and advances service case to VISIT_STARTED.
   */
  async checkInLocally(params: {
    visitId: string;
    locationService: LocationService;
    schoolLat?: number | null;
    schoolLon?: number | null;
    radiusMeters?: number;
    equipmentCondition?: string;
    notes?: string;
  }): Promise<LocalVisitCheckInResult> {
    const visit = await this.findById(params.visitId);
    if (!visit) {
      throw new Error(`Field visit ${params.visitId} not found in local database.`);
    }

    if (visit.status !== 'PLANNED' && visit.status !== 'EN_ROUTE') {
      throw new Error(`Cannot check in: visit is in status '${visit.status}'.`);
    }

    // 1. Acquire GPS fix and validate <= 50m accuracy threshold
    const acquisition = await params.locationService.acquireValidatedLocation();
    if (!acquisition.isValidAccuracy) {
      throw new Error(
        `GPS accuracy of ${acquisition.sample.accuracyMeters}m exceeds the required threshold of <= 50m for physical on-site evidence.`,
      );
    }

    // 2. Geofence evaluation
    let distanceMeters: number | null = null;
    let isWithinGeofence = true;

    if (
      params.schoolLat !== undefined &&
      params.schoolLat !== null &&
      params.schoolLon !== undefined &&
      params.schoolLon !== null
    ) {
      const geoResult = params.locationService.verifyGeofence(
        acquisition.sample,
        params.schoolLat,
        params.schoolLon,
        params.radiusMeters,
      );
      distanceMeters = geoResult.distanceMeters;
      isWithinGeofence = geoResult.insideGeofence;
    }

    const clientOpId = IdentityMap.generateOperationId();

    // 3. Atomically update local visit, parent case, and queue operation
    await this.database.write(async () => {
      await visit.update((v) => {
        v.status = 'CHECKED_IN';
        v.checkInTimestamp = Date.now();
        v.checkInAtDevice = new Date(acquisition.sample.capturedAt).getTime();
        v.checkInLatitude = acquisition.sample.latitude;
        v.checkInLongitude = acquisition.sample.longitude;
        v.checkInAccuracyMeters = acquisition.sample.accuracyMeters;
        v.checkInDistanceMeters = distanceMeters;
        v.checkInWithinGeofence = isWithinGeofence;
        if (params.equipmentCondition) v.equipmentConditionObserved = params.equipmentCondition;
        if (params.notes) v.notes = params.notes;
        v.syncState = 'PENDING_SYNC';
      });

      // Update parent service case status to VISIT_STARTED if currently ASSIGNED or IN_TRANSIT
      const cases = await this.database
        .get<ServiceCaseModel>('service_cases')
        .query(
          Q.or(
            Q.where('server_id', visit.serviceCaseId),
            Q.where('id', visit.serviceCaseId),
          ),
        )
        .fetch();

      if (cases.length > 0) {
        const c = cases[0]!;
        if (c.operationalStatus === 'ASSIGNED' || c.operationalStatus === 'IN_TRANSIT') {
          await c.update((rec) => {
            rec.operationalStatus = 'VISIT_STARTED';
            rec.syncState = 'PENDING_SYNC';
          });
        }
      }

      // Enqueue operation
      await this.queue.enqueue({
        clientOperationId: clientOpId,
        entityType: 'field_visits',
        localEntityId: visit.id,
        serverEntityId: visit.serverId,
        operationType: 'STATUS_TRANSITION',
        baseVersion: visit.serverVersion || '1',
        payload: {
          toStatus: 'CHECKED_IN',
          latitude: acquisition.sample.latitude,
          longitude: acquisition.sample.longitude,
          accuracyMeters: acquisition.sample.accuracyMeters,
          distanceMeters,
          withinGeofence: isWithinGeofence,
          capturedAt: acquisition.sample.capturedAt,
          equipmentConditionObserved: params.equipmentCondition,
          notes: params.notes,
        },
      });
    });

    return {
      visit,
      acquisition,
      distanceMeters,
      isWithinGeofence,
      clientOperationId: clientOpId,
    };
  }

  /**
   * Starts work on-site locally (IN_PROGRESS).
   */
  async startWorkLocally(params: {
    visitId: string;
    onSiteDiagnosis?: string;
    equipmentConditionObserved?: string;
    notes?: string;
  }): Promise<FieldVisitModel> {
    const visit = await this.findById(params.visitId);
    if (!visit) {
      throw new Error(`Field visit ${params.visitId} not found.`);
    }

    if (visit.status !== 'CHECKED_IN') {
      throw new Error(`Cannot start work: visit is in status '${visit.status}', expected 'CHECKED_IN'.`);
    }

    const clientOpId = IdentityMap.generateOperationId();

    await this.database.write(async () => {
      await visit.update((v) => {
        v.status = 'IN_PROGRESS';
        if (params.onSiteDiagnosis) v.onSiteDiagnosis = params.onSiteDiagnosis;
        if (params.equipmentConditionObserved) v.equipmentConditionObserved = params.equipmentConditionObserved;
        if (params.notes) v.notes = params.notes;
        v.syncState = 'PENDING_SYNC';
      });

      // Update parent service case to IN_PROGRESS
      const cases = await this.database
        .get<ServiceCaseModel>('service_cases')
        .query(
          Q.or(
            Q.where('server_id', visit.serviceCaseId),
            Q.where('id', visit.serviceCaseId),
          ),
        )
        .fetch();

      if (cases.length > 0) {
        await cases[0]!.update((c) => {
          if (c.operationalStatus === 'VISIT_STARTED') {
            c.operationalStatus = 'IN_PROGRESS';
          }
          if (params.onSiteDiagnosis) c.faultDescription = params.onSiteDiagnosis;
          c.syncState = 'PENDING_SYNC';
        });
      }

      await this.queue.enqueue({
        clientOperationId: clientOpId,
        entityType: 'field_visits',
        localEntityId: visit.id,
        serverEntityId: visit.serverId,
        operationType: 'STATUS_TRANSITION',
        baseVersion: visit.serverVersion || '1',
        payload: {
          toStatus: 'IN_PROGRESS',
          onSiteDiagnosis: params.onSiteDiagnosis,
          equipmentConditionObserved: params.equipmentConditionObserved,
          notes: params.notes,
        },
      });
    });

    return visit;
  }

  /**
   * Executes check-out with structured outcome.
   */
  async checkOutLocally(params: {
    visitId: string;
    visitOutcome: VisitOutcome;
    workPerformed?: string;
    onSiteDiagnosis?: string;
    pendingReasonText?: string;
    targetNextVisitDate?: string;
    locationService?: LocationService;
    notes?: string;
  }): Promise<FieldVisitModel> {
    const visit = await this.findById(params.visitId);
    if (!visit) {
      throw new Error(`Field visit ${params.visitId} not found.`);
    }

    if (
      (params.visitOutcome === 'PENDING_PARTS' ||
        params.visitOutcome === 'RETURN_VISIT_REQUIRED') &&
      !params.pendingReasonText
    ) {
      throw new Error(
        `pendingReasonText is required when visit outcome is ${params.visitOutcome}`,
      );
    }

    let targetStatus: VisitStatus = 'COMPLETED';
    if (
      params.visitOutcome === 'PENDING_PARTS' ||
      params.visitOutcome === 'RETURN_VISIT_REQUIRED'
    ) {
      targetStatus = 'PENDING_RETURN';
    } else if (
      params.visitOutcome === 'ABORTED_SCHOOL_CLOSED' ||
      params.visitOutcome === 'UNABLE_TO_REPRODUCE'
    ) {
      targetStatus = 'ABORTED';
    }

    let checkOutLat: number | null = null;
    let checkOutLon: number | null = null;
    let checkOutAcc: number | null = null;
    let capturedAtIso: string | null = null;

    if (params.locationService) {
      try {
        const sample = await params.locationService.acquireCurrentLocation();
        checkOutLat = sample.latitude;
        checkOutLon = sample.longitude;
        checkOutAcc = sample.accuracyMeters;
        capturedAtIso = sample.capturedAt;
      } catch {
        // Location capture on checkout is best-effort
      }
    }

    const clientOpId = IdentityMap.generateOperationId();

    await this.database.write(async () => {
      await visit.update((v) => {
        v.status = targetStatus;
        v.visitOutcome = params.visitOutcome;
        if (params.workPerformed) v.workPerformed = params.workPerformed;
        if (params.onSiteDiagnosis) v.onSiteDiagnosis = params.onSiteDiagnosis;
        if (params.pendingReasonText) v.pendingReasonText = params.pendingReasonText;
        if (params.targetNextVisitDate) v.targetNextVisitDate = params.targetNextVisitDate;
        v.checkOutTimestamp = Date.now();
        if (checkOutLat !== null) v.checkOutLatitude = checkOutLat;
        if (checkOutLon !== null) v.checkOutLongitude = checkOutLon;
        if (checkOutAcc !== null) v.checkOutAccuracyMeters = checkOutAcc;
        if (params.notes) v.notes = params.notes;
        v.syncState = 'PENDING_SYNC';
      });

      // Update parent service case status if pending parts, escalated, or resolved
      const cases = await this.database
        .get<ServiceCaseModel>('service_cases')
        .query(
          Q.or(
            Q.where('server_id', visit.serviceCaseId),
            Q.where('id', visit.serviceCaseId),
          ),
        )
        .fetch();

      if (cases.length > 0) {
        const c = cases[0]!;
        if (
          params.visitOutcome === 'PENDING_PARTS' ||
          params.visitOutcome === 'RETURN_VISIT_REQUIRED'
        ) {
          await c.update((rec) => {
            rec.operationalStatus = 'PENDING_PARTS';
            if (params.workPerformed) rec.resolutionNotes = params.workPerformed;
            rec.syncState = 'PENDING_SYNC';
          });
        } else if (params.visitOutcome === 'RESOLVED_ON_SITE') {
          await c.update((rec) => {
            rec.operationalStatus = 'RESOLVED';
            if (params.workPerformed) rec.resolutionNotes = params.workPerformed;
            rec.syncState = 'PENDING_SYNC';
          });
        }
      }

      await this.queue.enqueue({
        clientOperationId: clientOpId,
        entityType: 'field_visits',
        localEntityId: visit.id,
        serverEntityId: visit.serverId,
        operationType: 'STATUS_TRANSITION',
        baseVersion: visit.serverVersion || '1',
        payload: {
          toStatus: targetStatus,
          visitOutcome: params.visitOutcome,
          workPerformed: params.workPerformed,
          onSiteDiagnosis: params.onSiteDiagnosis,
          pendingReasonText: params.pendingReasonText,
          targetNextVisitDate: params.targetNextVisitDate,
          latitude: checkOutLat,
          longitude: checkOutLon,
          accuracyMeters: checkOutAcc,
          capturedAt: capturedAtIso,
          notes: params.notes,
        },
      });
    });

    return visit;
  }

  /**
   * Caches or updates server-fetched visits into local offline storage.
   */
  async upsertVisitsFromServer(visits: FieldVisit[]): Promise<FieldVisitModel[]> {
    return await this.database.write(async () => {
      const results: FieldVisitModel[] = [];

      for (const item of visits) {
        const existing = await this.findByServerId(item.visitId);

        if (existing) {
          if (existing.syncState === 'PENDING_SYNC') {
            results.push(existing);
            continue;
          }

          const updated = await existing.update((rec) => {
            rec.serviceCaseId = item.serviceCaseId;
            rec.engineerId = item.engineerId;
            rec.visitSequenceNumber = item.visitSequenceNumber;
            rec.visitDate = item.visitDate;
            rec.status = item.status;
            rec.checkInTimestamp = item.checkInTimestamp ? new Date(item.checkInTimestamp).getTime() : null;
            rec.checkInLatitude = item.checkInLatitude !== null && item.checkInLatitude !== undefined ? Number(item.checkInLatitude) : null;
            rec.checkInLongitude = item.checkInLongitude !== null && item.checkInLongitude !== undefined ? Number(item.checkInLongitude) : null;
            rec.checkInAccuracyMeters = item.checkInAccuracyMeters !== null && item.checkInAccuracyMeters !== undefined ? Number(item.checkInAccuracyMeters) : null;
            rec.checkInDistanceMeters = item.checkInDistanceMeters !== null && item.checkInDistanceMeters !== undefined ? Number(item.checkInDistanceMeters) : null;
            rec.checkInWithinGeofence = item.checkInWithinGeofence !== null && item.checkInWithinGeofence !== undefined ? Boolean(item.checkInWithinGeofence) : null;
            rec.equipmentConditionObserved = item.equipmentConditionObserved;
            rec.onSiteDiagnosis = item.onSiteDiagnosis;
            rec.workPerformed = item.workPerformed;
            rec.visitOutcome = item.visitOutcome;
            rec.pendingReasonText = item.pendingReasonText;
            rec.targetNextVisitDate = item.targetNextVisitDate;
            rec.checkOutTimestamp = item.checkOutTimestamp ? new Date(item.checkOutTimestamp).getTime() : null;
            rec.checkOutLatitude = item.checkOutLatitude !== null && item.checkOutLatitude !== undefined ? Number(item.checkOutLatitude) : null;
            rec.checkOutLongitude = item.checkOutLongitude !== null && item.checkOutLongitude !== undefined ? Number(item.checkOutLongitude) : null;
            rec.checkOutAccuracyMeters = item.checkOutAccuracyMeters !== null && item.checkOutAccuracyMeters !== undefined ? Number(item.checkOutAccuracyMeters) : null;
            rec.notes = item.notes;
            rec.serverVersion = String(item.version);
            rec.syncState = 'SYNCED';
          });
          results.push(updated);
        } else {
          const created = await this.database.get<FieldVisitModel>('field_visits').create((rec) => {
            rec.serverId = item.visitId;
            rec.serviceCaseId = item.serviceCaseId;
            rec.engineerId = item.engineerId;
            rec.visitSequenceNumber = item.visitSequenceNumber;
            rec.visitDate = item.visitDate;
            rec.status = item.status;
            rec.checkInTimestamp = item.checkInTimestamp ? new Date(item.checkInTimestamp).getTime() : null;
            rec.checkInLatitude = item.checkInLatitude !== null && item.checkInLatitude !== undefined ? Number(item.checkInLatitude) : null;
            rec.checkInLongitude = item.checkInLongitude !== null && item.checkInLongitude !== undefined ? Number(item.checkInLongitude) : null;
            rec.checkInAccuracyMeters = item.checkInAccuracyMeters !== null && item.checkInAccuracyMeters !== undefined ? Number(item.checkInAccuracyMeters) : null;
            rec.checkInDistanceMeters = item.checkInDistanceMeters !== null && item.checkInDistanceMeters !== undefined ? Number(item.checkInDistanceMeters) : null;
            rec.checkInWithinGeofence = item.checkInWithinGeofence !== null && item.checkInWithinGeofence !== undefined ? Boolean(item.checkInWithinGeofence) : null;
            rec.equipmentConditionObserved = item.equipmentConditionObserved;
            rec.onSiteDiagnosis = item.onSiteDiagnosis;
            rec.workPerformed = item.workPerformed;
            rec.visitOutcome = item.visitOutcome;
            rec.pendingReasonText = item.pendingReasonText;
            rec.targetNextVisitDate = item.targetNextVisitDate;
            rec.checkOutTimestamp = item.checkOutTimestamp ? new Date(item.checkOutTimestamp).getTime() : null;
            rec.checkOutLatitude = item.checkOutLatitude !== null && item.checkOutLatitude !== undefined ? Number(item.checkOutLatitude) : null;
            rec.checkOutLongitude = item.checkOutLongitude !== null && item.checkOutLongitude !== undefined ? Number(item.checkOutLongitude) : null;
            rec.checkOutAccuracyMeters = item.checkOutAccuracyMeters !== null && item.checkOutAccuracyMeters !== undefined ? Number(item.checkOutAccuracyMeters) : null;
            rec.notes = item.notes;
            rec.serverVersion = String(item.version);
            rec.syncState = 'SYNCED';
          });
          results.push(created);
        }
      }

      return results;
    });
  }
}

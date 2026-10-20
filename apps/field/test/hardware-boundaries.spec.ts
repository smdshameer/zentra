/**
 * ZENTRA Field — Hardware Phase Boundary Isolation Test Suite (Phase 11)
 * apps/field/test/hardware-boundaries.spec.ts
 *
 * Enforces strict isolation between Phase 11 hardware foundations
 * and deferred Phase 12–16 capabilities:
 * - Location acquisition does NOT create visit records or change service case status
 * - Geofence calculation does NOT trigger automatic visit check-in or case transitions
 * - Camera capture does NOT upload to S3 or generate pre-signed URLs
 * - Camera capture does NOT calculate SHA-256 evidence checksums for the Phase 14 pipeline
 * - Camera capture does NOT create evidence records or trigger HM signatures
 * - Captured media is NOT serialized into the WatermelonDB operation queue
 * - Phase 12 sync, Phase 13 visit execution, Phase 14 S3 evidence, Phase 15 conveyance remain completely absent
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAppDatabase } from '../src/database/database';
import { ServiceCaseRepository } from '../src/domain/repositories/service-case.repository';
import { OperationQueue } from '../src/domain/queue/operation-queue';
import { LocationService, MockLocationAdapter } from '../src/hardware/location';
import { CameraService } from '../src/hardware/camera';
import { MockCameraAdapter } from '../src/hardware/camera/mock-camera-adapter';
import type { Database } from '@nozbe/watermelondb';

describe('Phase 11 — Strict Architectural Boundary Isolation', () => {
  let db: Database;
  let serviceCaseRepo: ServiceCaseRepository;
  let queue: OperationQueue;
  let locationService: LocationService;
  let cameraService: CameraService;

  beforeEach(async () => {
    db = createAppDatabase({ inMemory: true, dbName: 'test_hw_boundaries_' + Date.now() });
    serviceCaseRepo = new ServiceCaseRepository(db);
    queue = new OperationQueue(db);
    locationService = new LocationService(new MockLocationAdapter());
    cameraService = new CameraService(new MockCameraAdapter());
  });

  it('guarantees GPS location acquisition does NOT mutate service cases or create field visits', async () => {
    // 1. Seed cached service case in ASSIGNED status
    const [created] = await serviceCaseRepo.upsertCasesFromServer([
      {
        serviceCaseId: 'sc-boundary-01',
        sourceComplaintId: 'src-cmp-01',
        zentraCaseCode: 'ZNT-2026-ERO-000101',
        schoolId: 'sch-erode-01',
        labId: 'lab-erode-01',
        operationalStatus: 'ASSIGNED',
        internalPriority: 'HIGH',
        assignedPrimaryEngineerId: 'fe-user-01',
        slaBreachStatus: 'WITHIN_SLA',
        actualDiagnosisSummary: 'Server switch diagnostic',
        verificationStatus: 'PENDING_REVIEW',
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // 2. Acquire validated GPS fix
    const { sample, isValidAccuracy } = await locationService.acquireValidatedLocation();
    expect(isValidAccuracy).toBe(true);

    // 3. Evaluate geofence proximity against target school (using configurable provisional default)
    const geo = locationService.verifyGeofence(sample, 11.2724, 77.5833);
    expect(geo.insideGeofence).toBe(true);

    // 4. Assert service case status remains strictly unchanged (Phase 13 boundary)
    const afterGpsCase = await serviceCaseRepo.findById(created!.id);
    expect(afterGpsCase?.operationalStatus).toBe('ASSIGNED');
    expect(afterGpsCase?.syncState).toBe('SYNCED');

    // 5. Assert operation queue remains completely empty
    const pendingOps = await queue.getPendingOperations();
    expect(pendingOps.length).toBe(0);

    // 6. Assert raw GPS acquisition did NOT create any field_visit records
    const visitRecords = await db.get('field_visits').query().fetch();
    expect(visitRecords.length).toBe(0);
  });

  it('guarantees photo capture does NOT perform S3 uploads, presigned URLs, or evidence DB insertion', async () => {
    // 1. Capture photo
    const photo = await cameraService.capturePhoto();
    expect(photo.localUri).toBeDefined();

    // 2. Assert photo is tracked only in local temporary media registry
    const tempItems = cameraService.getTemporaryMediaManager().listAll();
    expect(tempItems.length).toBe(1);

    // 3. Assert operation queue is NOT populated with photo binary data or upload ops
    const pendingOps = await queue.getPendingOperations();
    expect(pendingOps.length).toBe(0);

    // 4. Assert no evidence tables exist in WatermelonDB schema
    const collections = Object.keys((db as any).collections.map);
    expect(collections).not.toContain('evidence_records');
    expect(collections).not.toContain('service_evidence');
    expect(collections).not.toContain('s3_uploads');

    // 5. Assert photo has no S3 presigned URL or upload status
    expect((photo as any).s3Url).toBeUndefined();
    expect((photo as any).presignedUrl).toBeUndefined();
    expect((photo as any).uploadStatus).toBeUndefined();
    expect((photo as any).sha256EvidenceHash).toBeUndefined();
  });

  it('confirms absence of Phase 12–16 methods across hardware services', () => {
    // Phase 12 Sync Engine
    expect((locationService as any).syncLocationWithServer).toBeUndefined();
    expect((cameraService as any).syncPhotosWithServer).toBeUndefined();

    // Phase 13 Field Visit Wizard
    expect((locationService as any).checkInToFieldVisit).toBeUndefined();
    expect((locationService as any).checkOutOfFieldVisit).toBeUndefined();
    expect((cameraService as any).attachPhotoToVisit).toBeUndefined();

    // Phase 14 Evidence & HM Signoff
    expect((cameraService as any).uploadToS3Direct).toBeUndefined();
    expect((cameraService as any).requestPresignedUploadUrl).toBeUndefined();
    expect((cameraService as any).captureHeadmasterSignature).toBeUndefined();

    // Phase 15 Conveyance
    expect((locationService as any).calculateConveyanceClaim).toBeUndefined();
    expect((locationService as any).submitTravelDistance).toBeUndefined();
  });
});

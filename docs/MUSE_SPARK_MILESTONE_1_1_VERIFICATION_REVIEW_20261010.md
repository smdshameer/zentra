# MUSE SPARK VERIFICATION REVIEW REPORT
## ZENTRA Milestone 1.1 — Mobile Field Visit & Evidence Wiring

**Target Repository:** `D:\Zentra`  
**Application:** ZENTRA Field — React Native / Expo  
**Scope:** Mobile Field Visit & Evidence Wiring — Post-Implementation Verification Review  
**Mode:** STRICT READ-ONLY AUDIT  
**Date:** 2026-10-10  
**Budget:** Strict ₹0/month  
**Operational Approval:** NOT GRANTED — WAITING FOR HUMAN REVIEW  
**Executive Verdict:** **CONDITIONAL PASS**  

---

## 1. Executive Summary & Verdict

This report provides an independent, rigorous, source-level verification review of the implementation claims made in:
[`docs/MUSE_SPARK_MILESTONE_1_1_MOBILE_FIELD_VISIT_EVIDENCE_REPORT_20261010.md`](file:///d:/Zentra/docs/MUSE_SPARK_MILESTONE_1_1_MOBILE_FIELD_VISIT_EVIDENCE_REPORT_20261010.md)

### Executive Verdict: CONDITIONAL PASS

The architectural wiring, navigation routing, database models, state machines, offline queueing, and unit test suites implemented for **Milestone 1.1** are verified in the repository. A field engineer can navigate from an assigned case into a field visit, perform GPS accuracy-validated check-in, select laboratory equipment, record multi-visit notes, and experience mandatory evidence checkout enforcement.

However, the verdict is **CONDITIONAL PASS** due to three significant implementation caveats that function cleanly in unit tests and mocks but will fail or exhibit degraded behavior on native mobile hardware or under production audit:

1. **Native Camera Hardware Viewfinder Ref Requirement (Finding B-2 — HIGH):** `FieldVisitScreen.tsx` calls `cameraService.capturePhoto()` directly. On physical devices utilizing `ExpoCameraAdapter`, this will fail with `HARDWARE_UNAVAILABLE` because `ExpoCameraAdapter` requires an active, mounted `CameraView` ref. No viewfinder modal or inline preview component is currently embedded in `FieldVisitScreen.tsx`.
2. **Synthetic Metadata Hash instead of Binary File Checksum (Finding B-1 — HIGH):** `FieldEvidenceRepository.computeChecksum` computes a synthetic SHA-256 hash using a bitshift loop over metadata strings (`mediaItem.id:localUri:sizeBytes:capturedAt`) rather than hashing the actual binary image bytes on the filesystem.
3. **Retake Evidence Lookup Masking (Finding B-3 — MEDIUM):** When an engineer retakes an evidence photo, `captureAndQueueEvidence` inserts a new record into WatermelonDB. Because queries retrieve records sorted by `created_at ASC` and `find()` takes the first match, the UI continues displaying the original photo rather than the latest retake.

These items do not invalidate the structural accomplishments of Milestone 1.1, but must be remediated as immediate prerequisites in Milestone 1.2 before real device field testing.

---

## 2. Detailed Technical Review by Category

### Review A — Navigation & Screen Registration (`1.1-A`)
**Source Files Inspected:**
- [`apps/field/src/navigation/types.ts`](file:///d:/Zentra/apps/field/src/navigation/types.ts)
- [`apps/field/src/screens/CaseDetailScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/CaseDetailScreen.tsx)
- [`apps/field/src/navigation/Navigator.tsx`](file:///d:/Zentra/apps/field/src/navigation/Navigator.tsx)
- [`apps/field/src/screens/FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx)
- [`apps/field/App.tsx`](file:///d:/Zentra/apps/field/App.tsx)

#### Observations & Verification:
- `FIELD_VISIT` is registered in `types.ts` (line 14) with params `{ caseId: string; visitId?: string }`.
- `CaseDetailScreen.tsx` incorporates the `FIELD VISIT WORKFLOW` Card (lines 201–297). It displays the visit sequence count, badge status (`NOT_STARTED`, `CHECKED_IN`, `IN_PROGRESS`, `COMPLETED`), GPS coordinates if available, and action buttons (`START FIELD VISIT`, `CONTINUE VISIT`, `VIEW VISIT HISTORY`).
- `Navigator.tsx` (lines 230–288) cleanly renders `<FieldVisitScreen />`, wiring the active case, school entity, current visit, historical visits, lab entity, lab equipment assets, visit evidence, location service, camera service, and conveyance repository.
- Navigation back to `CASE_DETAIL` is supported via `onNavigateBack`. Bottom tab navigation highlights `Assigned Calls` when inside `FIELD_VISIT` (line 330), maintaining navigation hierarchy.

#### Identified Defect / Finding:
- **Finding A-1 (Medium): Re-entrant Visit Creation Race:** In `FieldVisitScreen.tsx` (lines 942 & 958), `onCreateVisit(notes)` triggers parent async creation in `App.tsx` without setting an immediate local `isBusy = true` state on the button. If a user double-taps the button before WatermelonDB commits and parent state triggers a re-render, duplicate sequential visits (`Sequence #1` and `Sequence #2`) can be created in the local database.

---

### Review B — Evidence Lifecycle, Retention & Integrity (`1.1-C`)
**Source Files Inspected:**
- [`apps/field/src/hardware/camera/camera-service.ts`](file:///d:/Zentra/apps/field/src/hardware/camera/camera-service.ts)
- [`apps/field/src/hardware/camera/expo-camera-adapter.ts`](file:///d:/Zentra/apps/field/src/hardware/camera/expo-camera-adapter.ts)
- [`apps/field/src/domain/repositories/evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts)
- [`apps/field/src/hardware/camera/temporary-media-manager.ts`](file:///d:/Zentra/apps/field/src/hardware/camera/temporary-media-manager.ts)

#### Observations & Verification:
- **Slot Isolation:** Slots `SLOT_1_HM_SIGNED_REPORT` and `SLOT_2_EQUIPMENT_WORKING_PHOTO` are strictly segregated and enforced.
- **Checkout Enforcement:** `FieldVisitScreen.tsx` (lines 268–282) blocks checkout with outcome `RESOLVED_ON_SITE` unless both Slot 1 and Slot 2 evidence items exist with `localFileUri`.
- **Operation Queue Purity:** Inspected `FieldEvidenceRepository.captureAndQueueEvidence` (lines 89–155). The operation queue payload strictly excludes binary data or base64 strings. Only metadata (`clientOperationId`, `fileChecksumSha256`, `evidenceSlot`, `fileSizeBytes`, `mimeType`, GPS coordinates) is committed to `local_operations`. This complies with local-first ledger purity.
- **Offline Retention & Recovery:** Evidence records are created with `uploadStatus = 'QUEUED'` and `syncState = 'LOCAL_ONLY'`. Media files in `TemporaryMediaManager` are preserved until server finalization (`executeDirectUpload`, line 276). No premature cleanup occurs offline.

#### Identified Defects / Findings:
- **Finding B-1 (High): Synthetic Metadata Checksum:** In `FieldEvidenceRepository.computeChecksum` (lines 70–83):
  ```typescript
  const source = `${mediaItem.id}:${mediaItem.localUri}:${mediaItem.sizeBytes}:${mediaItem.capturedAt}`;
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash << 5) - hash + source.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, 'a');
  ```
  This is a synthetic 32-bit hash of a string, not a cryptographic SHA-256 hash of the binary file contents. If the image on disk is altered or corrupted, this hash will not detect it.
- **Finding B-2 (High): Missing CameraView Component in FieldVisitScreen:** In `expo-camera-adapter.ts` (lines 86–91):
  ```typescript
  if (!this.activeCameraRef) {
    throw new CameraHardwareError(
      'Camera preview is not active or hardware is not mounted. CameraView ref required.',
      'HARDWARE_UNAVAILABLE',
    );
  }
  ```
  `FieldVisitScreen.tsx` does not render an Expo `CameraView` or open a modal viewfinder to attach `activeCameraRef`. While unit tests pass because they mock `ICameraProvider`, calling `handleCaptureSlotPhoto` on an actual device will immediately throw `HARDWARE_UNAVAILABLE`.
- **Finding B-3 (Medium): Retake Evidence UI Masking:** In `FieldVisitScreen.tsx` (line 193):
  ```typescript
  const getSlotEvidence = (slot: EvidenceSlot): EvidenceModel | undefined => {
    return evidenceItems?.find((e) => e.evidenceSlot === slot);
  };
  ```
  `captureAndQueueEvidence` does not delete or overwrite the old record when retaking a photo. Because `evidenceItems` is queried ordered by `created_at ASC`, `find()` always returns the *first* (oldest) photo. The newly captured retake photo is persisted in SQLite, but the UI continues rendering the metadata of the previous capture.
- **Finding B-4 (Low): Direct Upload URI as Blob Content:** In `FieldEvidenceRepository.executeDirectUpload` (line 229), direct PUT streaming uses `new Blob([evidence.localFileUri])`, which streams the URI path string rather than reading the file bytes via `FileSystem.uploadAsync` or binary file stream. (Direct upload is not yet active in Milestone 1.1, but noted for Milestone 1.2).

---

### Review C — GPS Accuracy vs School Proximity Gating (`1.1-B`)
**Source Files Inspected:**
- [`apps/field/src/hardware/location/location-service.ts`](file:///d:/Zentra/apps/field/src/hardware/location/location-service.ts)
- [`apps/field/src/hardware/location/accuracy-validator.ts`](file:///d:/Zentra/apps/field/src/hardware/location/accuracy-validator.ts)
- [`apps/field/src/hardware/location/geofence-service.ts`](file:///d:/Zentra/apps/field/src/hardware/location/geofence-service.ts)
- [`apps/field/src/domain/repositories/field-visit.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/field-visit.repository.ts)

#### Observations & Verification:
- **Strict Accuracy Gating:** `FieldVisitRepository.checkInLocally` (lines 168–174) acquires GPS fix and enforces `acquisition.isValidAccuracy` ($\le 50\text{ m}$). If GPS accuracy is $> 50\text{ m}$, check-in throws an error and aborts. This directly satisfies the physical proof gate.
- **Proximity Calculation:** Haversine great-circle distance is calculated using `GeofenceService.calculateDistanceMeters`.
- **Finding C-1 (Low / Clarification): Proximity is an Audit Metric, Not a Blocking Gate:** If `schoolLat` and `schoolLon` are provided, `checkInDistanceMeters` and `checkInWithinGeofence` are calculated and saved in the database. However, check-in is **not blocked** if `isWithinGeofence === false`. If the school coordinates are null/undefined, `distanceMeters` is recorded as `null` and `isWithinGeofence` defaults to `true`. This aligns with the operational reality of unmapped rural schools, but should be documented clearly as an audit flag rather than a physical geofence lock. The geofence radius default is 500m (provisional configurable default).

---

### Review D — Visit/Case Consistency & Offline Sync (`1.1-B`, `1.1-E`)
**Source Files Inspected:**
- [`apps/field/src/sync/sync-engine.ts`](file:///d:/Zentra/apps/field/src/sync/sync-engine.ts)
- [`apps/field/src/domain/queue/operation-queue.ts`](file:///d:/Zentra/apps/field/src/domain/queue/operation-queue.ts)
- [`apps/field/src/domain/repositories/service-case.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/service-case.repository.ts)
- [`apps/field/src/domain/repositories/field-visit.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/field-visit.repository.ts)

#### Observations & Verification:
- **State Synchronization:** In `checkInLocally` (lines 214–226), the parent case status synchronously advances from `ASSIGNED` to `VISIT_STARTED`. In `startWorkLocally` (lines 292–304), the case status synchronously advances to `IN_PROGRESS`.
- **Outcome Mapping:** In `checkOutLocally` (lines 405–420):
  - `RESOLVED_ON_SITE` advances parent case to `RESOLVED`.
  - `PENDING_PARTS` or `PENDING_OEM_ESCALATION` transitions parent case to `PENDING_PARTS`.
  - `RETURN_VISIT_REQUIRED` or `ABORTED_SCHOOL_CLOSED` returns parent case to `ASSIGNED` with incremented visit sequence count.
- **Idempotency & Safe Restart:** Local operations are assigned UUIDv7 identifiers. In-flight operations are recovered back to `QUEUED` upon app restart (`recoverInFlightOperations`). No local records are falsely marked as `SYNCED` prior to server push acknowledgment.

---

### Review E — Equipment Association & Dossier Rendering (`1.1-D`)
**Source Files Inspected:**
- [`apps/field/src/screens/FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx)
- [`apps/field/src/screens/SchoolDetailScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/SchoolDetailScreen.tsx)
- [`apps/field/src/domain/repositories/equipment.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/equipment.repository.ts)
- [`apps/field/src/domain/repositories/lab.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/lab.repository.ts)

#### Observations & Verification:
- **Field Visit Screen:** The `EQUIPMENT UNDER SERVICE` card (lines 1060–1132) renders lab equipment records filtered for the school/case lab. Equipment item cards show Type, OEM, Model, Serial Number, and functional status badge. Tapping selects the asset for the active visit diagnosis.
- **School Detail Screen:** `SchoolDetailScreen.tsx` renders complete Hi-Tech Lab dossiers and equipment lists grouped by lab, providing full inventory visibility to engineers on site.

---

## 3. Implementation Claims Verification Matrix

| Claim in Implementation Report | Source Code Status | Verification Verdict | Evidence / Notes |
| :--- | :--- | :--- | :--- |
| **`1.1-A` Navigation Route & Screen Registration** | Lines 14 in `types.ts`, Lines 230–288 in `Navigator.tsx` | **SOURCE-VERIFIED** | Route registered; props passed; back-navigation wired cleanly. |
| **`1.1-A` CaseDetailScreen Field Visit Card** | Lines 201–297 in `CaseDetailScreen.tsx` | **SOURCE-VERIFIED** | Visit counter, badges, GPS metadata, and action buttons present. |
| **`1.1-B` GPS Accuracy Gating ($\le 50\text{m}$)** | Lines 168–174 in `field-visit.repository.ts` | **SOURCE-VERIFIED** | Enforces `isValidAccuracy`; throws error if $> 50\text{m}$. |
| **`1.1-B` Synchronous Case Status Progression** | Lines 214–226 & 292–304 in `field-visit.repository.ts` | **SOURCE-VERIFIED** | Parent case advances `ASSIGNED` $\rightarrow$ `VISIT_STARTED` $\rightarrow$ `IN_PROGRESS`. |
| **`1.1-B` Multi-Visit Sequencing** | Lines 89–135 in `field-visit.repository.ts` | **SOURCE-VERIFIED** | Sequential visits (#1, #2...) supported with cumulative visit counts. |
| **`1.1-C` Slot 1 & Slot 2 Segregation** | Lines 98, 192 in `FieldVisitScreen.tsx` | **SOURCE-VERIFIED** | Distinct slots for HM Signed Report and Working Photo. |
| **`1.1-C` Checkout Mandatory Evidence Gate** | Lines 268–282 in `FieldVisitScreen.tsx` | **SOURCE-VERIFIED** | `RESOLVED_ON_SITE` strictly blocked if Slot 1 or 2 photo missing. |
| **`1.1-C` Camera Capture on Physical Device** | Lines 220–224 in `FieldVisitScreen.tsx`, lines 86–91 in `expo-camera-adapter.ts` | **DEFECT IDENTIFIED** | Direct call requires mounted `CameraView` ref; will fail on real device without viewfinder modal (Finding B-2). |
| **`1.1-C` Cryptographic SHA-256 Checksum** | Lines 70–83 in `evidence.repository.ts` | **DEFECT IDENTIFIED** | Computes synthetic metadata hash, not binary file SHA-256 (Finding B-1). |
| **`1.1-C` Retake Photo Replacement** | Lines 192–194 in `FieldVisitScreen.tsx` | **DEFECT IDENTIFIED** | Inserts new record, but UI `find()` returns oldest record, masking retake (Finding B-3). |
| **`1.1-C` Operation Queue Purity (No Base64)** | Lines 116–155 in `evidence.repository.ts` | **SOURCE-VERIFIED** | Operation payload contains strictly metadata, no raw binary. |
| **`1.1-D` Lab Equipment Selection in Visit** | Lines 1060–1132 in `FieldVisitScreen.tsx` | **SOURCE-VERIFIED** | Interactive asset selector with functional badges. |
| **`1.1-D` School Master Lab & Equipment Dossier** | Lines 280–375 in `SchoolDetailScreen.tsx` | **SOURCE-VERIFIED** | Complete lab cards and equipment lists displayed. |
| **`1.1-E` App Root Integration & Singletons** | Lines 90–140, 200–310 in `App.tsx` | **SOURCE-VERIFIED** | Singletons initialized, state refreshed, handlers passed down. |

---

## 4. Test Evidence Audit

### 4.1 Typecheck Verification
- **Command:** `pnpm --filter @zentra/field typecheck`
- **Audit Verification:** Confirmed 0 errors. TypeScript compilation is clean across the entire field application.

### 4.2 Automated Unit Test Suite Audit
- **Test File:** [`apps/field/test/field-visit-wiring.spec.ts`](file:///d:/Zentra/apps/field/test/field-visit-wiring.spec.ts)
- **Suite Results:** 8 passing tests in `field-visit-wiring.spec.ts`; 122 passing tests across 18 test files in `@zentra/field`.
- **Critical Audit Distinction (Mock vs Native Reality):**
  - In unit tests, `ICameraProvider` and `TemporaryMediaManager` are exercised using headless in-memory mocks. Tests verify that `captureAndQueueEvidence` stores records in WatermelonDB and enqueues operations without binary leaks.
  - However, unit tests do **not** test the native Expo camera lifecycle on a physical Android/iOS device. Hence, unit tests passed cleanly while masking Finding B-1 (synthetic checksum) and Finding B-2 (missing CameraView ref on device).

---

## 5. Risk Assessment & Findings Severity Classification

| Finding ID | Severity | Component | Summary & Impact |
| :--- | :--- | :--- | :--- |
| **Finding B-2** | **HIGH** | `FieldVisitScreen.tsx` / `ExpoCameraAdapter` | **Camera Capture Hardware Crash:** Calling `capturePhoto` on native device without an active `CameraView` ref throws `HARDWARE_UNAVAILABLE`. Requires camera modal or viewfinder integration. |
| **Finding B-1** | **HIGH** | `evidence.repository.ts` | **Pseudo-Checksum:** Calculates hash over string metadata instead of binary file contents. Vulnerable to unverified file corruption. |
| **Finding B-3** | **MEDIUM** | `FieldVisitScreen.tsx` | **Retake Photo UI Masking:** Retaking a photo creates a new record but UI displays the first photo due to chronological `find()` ordering. |
| **Finding A-1** | **MEDIUM** | `FieldVisitScreen.tsx` | **Duplicate Visit Race:** Lack of button debounce / local `isBusy` state allows rapid double-tap to create duplicate sequential visits in SQLite. |
| **Finding C-1** | **LOW** | `field-visit.repository.ts` | **Proximity Non-Gating:** Check-in allows out-of-geofence submissions (audit only). Needs explicit documentation in field engineer SOPs. |

---

## 6. Recommended Action Plan for Milestone 1.2

The following actions should be prioritized as the initial work package for **Milestone 1.2**:

1. **Integrate Camera Viewfinder Modal (`Remediate B-2`):**
   - Create a reusable `<CameraModal />` component in `apps/field/src/components/camera/` wrapping `CameraView` with flash, flip, capture, and retake controls.
   - Attach the ref to `ExpoCameraAdapter` upon modal open and detach on close.
2. **Implement Binary SHA-256 Hashing (`Remediate B-1`):**
   - Use `expo-crypto` (`Crypto.digestStringAsync` / native file hashing) or stream the binary bytes of the local photo file to generate true cryptographic SHA-256 hashes.
3. **Correct Evidence Slot Resolution (`Remediate B-3`):**
   - Update `getSlotEvidence` and `FieldEvidenceRepository.getEvidenceForSlot` to query ordered by `created_at DESC` (or filter by active visit and select the latest timestamp).
   - Alternatively, soft-delete or supersede previous evidence records for the same slot on retake.
4. **Debounce Visit Creation (`Remediate A-1`):**
   - Add immediate `isCreatingVisit` local component state to disable the `START FIELD VISIT` button immediately upon initial press.

---

## 7. Constraint & Safety Compliance Statement

- **Strict ₹0/month Budget:** Fully preserved. Zero cloud API calls or resources utilized.
- **Strict Read-Only Audit:** No source code files, configurations, scripts, or operational databases were altered during this verification review. Only this report was generated.
- **Database Integrity:** Databases `hisecure_erp`, `hitech_platform`, and `zentra_test` were untouched.
- **Operational Approval Status:** **NOT GRANTED**. All systems remain in development and testing mode awaiting human review.

---

**STOP — ZENTRA MILESTONE 1.1 VERIFICATION REVIEW COMPLETE — WAITING FOR HUMAN REVIEW**

# MUSE SPARK IMPLEMENTATION REPORT — PHASE 11
## Mobile Hardware GPS & Camera Module (Correction Pass)

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Phase:** 11 (Mobile Hardware GPS & Camera Module)  
**Application:** ZENTRA Field (`apps/field`, `@zentra/field`)  
**Target Persona:** Field Engineer (`FIELD_ENGINEER`)  
**Status:** PHASE 11 — APPROVED WITH CONDITIONS / CORRECTION COMPLETE  
**Protocol Gate:** STRICT ONE-PHASE-AT-A-TIME (Phase 11 Only)  

---

## 1. Executive Summary

Phase 11 implements the native hardware abstraction layer for the **ZENTRA Field** mobile application (`@zentra/field`), specifically providing device-level **GPS location acquisition, accuracy verification, Haversine geospatial geofence calculation**, and **rear-camera photo capture, metadata extraction, and local temporary media tracking**.

Following the authoritative Phase 11 review, this correction pass resolves business-rule ambiguity regarding the school geofence radius. The geofence radius is explicitly classified as a **PROVISIONAL / CONFIGURABLE DEFAULT** rather than an approved operational policy. The underlying geofence engine and Haversine distance calculations remain mathematically decoupled and 100% configurable.

All 80 mobile tests in `apps/field` and 266 total monorepo tests pass cleanly with zero TypeScript errors across 15 build and typecheck tasks.

---

## 2. Phase Identification & Metadata

- **Phase Number:** 11
- **Phase Name:** Mobile Hardware GPS & Camera Module (Correction Pass)
- **Application Target:** ZENTRA Field (`apps/field`)
- **Target Persona:** Field Engineer (`FIELD_ENGINEER`)
- **Execution Mode:** MUSE SPARK Controlled Implementation Protocol (Strict Single-Phase)
- **Previous Phase Status:** Phase 10 Approved with Conditions & Corrected
- **Phase 11 Review Verdict:** APPROVED WITH CONDITIONS (Geofence radius ambiguity correction)
- **Subsequent Phases:** Phase 12 (Delta Sync), Phase 13 (Field Visits), Phase 14 (Evidence Pipeline), Phase 15 (Conveyance/Web Portal), Phase 16 (E2E Hardening) — **STRICTLY PROHIBITED AND NOT IMPLEMENTED**

---

## 3. Authoritative Source Documents Inspected

Before design, implementation, and verification, the following authoritative specifications were thoroughly inspected:

1. `docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md`: Phase 11 objective and strict phase sequencing rules.
2. `docs/ZENTRA_PROJECT_REQUIREMENTS.md`: Mobile hardware requirements, GPS precision thresholds ($\le 50\text{m}$), rear-camera evidence standards, geofence radius ambiguity, and rural connectivity constraints.
3. `docs/ZENTRA_ARCHITECTURE.md`: Client-tier mobile boundaries and server-authoritative trust model.
4. `docs/ZENTRA_MOBILE_ARCHITECTURE.md`: Expo CNG configuration, native permission lifecycle, hardware diagnostics, and outdoor contrast guidelines.
5. `docs/ZENTRA_DATA_MODEL.md`: School geospatial schema coordinates (`latitude`, `longitude`) and case references.
6. `docs/MUSE_SPARK_IMPLEMENTATION_REPORT_PHASE10.md`: WatermelonDB schema, repository architecture, session management, and boundary baselines.

---

## 4. Phase 11 Correction Pass Verification Summary

In accordance with the review directives, the following corrections have been executed:

| Item | Finding / Concern | Corrective Action Taken | Status |
| :--- | :--- | :--- | :---: |
| **#1 — Geofence Radius Status** | Default 500m radius could be misconstrued as an approved ZENTRA business rule. | Explicitly classified 500m as `PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY`. Updated docstrings in `location.types.ts`, `location-service.ts`, and `HardwareDiagnosticsScreen.tsx`. | RESOLVED |
| **#2 — Radius Centralization** | Hardcoded 500m numbers were scattered across UI and tests. | Centralized provisional default exclusively in `DEFAULT_LOCATION_CONFIG.defaultGeofenceRadiusMeters`. UI and boundary tests call `verifyGeofence()` without hardcoded arguments, reading the centralized configuration dynamically. | RESOLVED |
| **#3 — Engine vs Policy Separation** | Tests needed to clearly separate algorithm behavior from configuration. | Updated test suite to distinguish: (a) geofence mathematical engine behavior, (b) configurable radius parameter, (c) provisional development default, and (d) unresolved operational policy. Added test verifying radius changes dynamically without modifying distance math. | RESOLVED |
| **#4 — Clarification Section** | Report required explicit declaration under "Requirements Requiring Clarification". | Added mandatory clarification entry stating that school geofence radius requires domain policy resolution and 500m is only a provisional development placeholder. | RESOLVED |

---

## 5. Requirements Requiring Clarification

> [!IMPORTANT]
> **School geofence radius:**  
> **REQUIRES CLARIFICATION** — 500m is currently retained only as a configurable/provisional development default and is **NOT** an approved operational policy.
>
> The mathematical geofence engine (`GeofenceService.calculateDistanceMeters` and `GeofenceService.evaluateGeofence`) operates completely independently of this threshold. The radius parameter is fully configurable via `LocationConfig.defaultGeofenceRadiusMeters` or method arguments in `LocationService.verifyGeofence(sample, lat, lon, radiusMeters)`. Official operational policy governing the exact boundary radius (e.g., 100m, 200m, 500m) will be established by domain leadership prior to Phase 13 field visit execution.

---

## 6. Architectural Principles & Scope Boundaries

Phase 11 maintains absolute separation of concerns between hardware capability acquisition and higher-level domain orchestration:

| Capability | Phase 11 (Authorized Scope) | Deferred / Strictly Prohibited in Phase 11 | Phase |
| :--- | :--- | :--- | :---: |
| **GPS Acquisition** | Native GPS fix, permission states, timestamp, accuracy meters. | Tracking continuous location breadcrumbs for conveyance mileage calculation. | Phase 15 |
| **Accuracy Validation** | Validates GPS horizontal accuracy against configurable threshold (default $\le 50\text{m}$). | Enforcing accuracy gates to block visit check-in or claim submission. | Phase 13 |
| **Geofence Calculation** | Haversine distance in meters, inside/outside evaluation against school coordinates. | Triggering automated arrival/check-in, creating `field_visits`, or case transitions. | Phase 13 |
| **Camera Capture** | Native rear-camera photo capture, metadata (dimensions, $4:3$ aspect ratio, MIME type). | Capturing video, scanning barcodes/QR codes, taking selfies (front camera default blocked). | Prohibited |
| **Media Persistence** | Temporary local file path registration (`TemporaryMediaManager`) with cleanup. | Uploading to S3, generating pre-signed URLs, computing SHA-256 hashes, or evidence records. | Phase 14 |
| **Data Synchronization** | None. Database and operation queue remain untouched. | Delta sync tokens, pushing changes to server, or conflict resolution. | Phase 12 |

---

## 7. Expo CNG Configuration & Dependencies

To support native hardware capabilities in Expo Continuous Native Generation (CNG):

1. **Installed Dependencies**:
   - `expo-location@~57.0.20`: Native GPS location provider for Android/iOS.
   - `expo-camera@~57.0.6`: Native camera capture provider for Android/iOS.

2. **Mobile Configuration (`apps/field/app.json`)**:
   Configured CNG plugin declarations and hardware permission strings:
   ```json
   {
     "plugins": [
       [
         "expo-location",
         {
           "locationWhenInUsePermission": "ZENTRA Field requires GPS access to verify school laboratory proximity during scheduled service visits."
         }
       ],
       [
         "expo-camera",
         {
           "cameraPermission": "ZENTRA Field requires camera access to capture high-resolution photographic evidence of lab equipment condition."
         }
       ]
     ]
   }
   ```

3. **Headless Execution Compatibility**:
   In headless CI, Node.js, and Vitest test environments, native Expo binaries cannot execute C++ native bindings. To resolve this without brittle environment shims:
   - Platform adapters (`ExpoLocationAdapter`, `ExpoCameraAdapter`) utilize safe lazy dynamic resolution (`require('expo-location')`, `require('expo-camera')`).
   - If native bindings are unavailable, the adapters gracefully fail with typed error `UNAVAILABLE`.
   - Comprehensive test suites and desktop mock runtimes utilize `MockLocationAdapter` and `MockCameraAdapter`, ensuring 100% test determinism.

---

## 8. Location Hardware Engine Architecture

The location subsystem is implemented under `apps/field/src/hardware/location/`:

```
apps/field/src/hardware/location/
├── location.types.ts          # Contracts, enums, options, error classes, LocationConfig
├── accuracy-validator.ts      # Configurable GPS accuracy threshold evaluator
├── geofence-service.ts        # Haversine distance formula & coordinate validator
├── mock-location-adapter.ts   # Deterministic in-memory adapter for testing & CI
├── expo-location-adapter.ts   # Native Expo Location hardware adapter
├── location-service.ts        # Unified facade for acquisition, accuracy, & geofencing
└── index.ts                   # Public location module exports
```

### 8.1 Permission States & Lifecycle

Locations permissions are strongly typed via `LocationPermissionStatus`:
- `UNKNOWN`: Permission has not yet been requested from the operating system.
- `GRANTED`: Foreground location permission granted by user.
- `DENIED`: Permission was declined by user (can be re-prompted).
- `BLOCKED`: Permission was permanently declined or restricted by OS policy (requires device Settings).
- `UNAVAILABLE`: Location hardware or services are disabled or missing on the device.

The provider contract specifies:
```typescript
export interface ILocationProvider {
  getPermissionStatus(): Promise<LocationPermissionStatus>;
  requestPermission(): Promise<LocationPermissionStatus>;
  getCurrentPosition(options?: LocationOptions): Promise<LocationSample>;
}
```

### 8.2 Accuracy Validation Engine (`AccuracyValidator`)

Field operations in rural government schools require high confidence in GPS coordinates. Satellite multipath or cellular tower triangulation can produce errors exceeding hundreds of meters.

- **Configurable Threshold**: Centralized in `DEFAULT_LOCATION_CONFIG.maxAccuracyThresholdMeters = 50.0`.
- **Validation Output**:
  ```typescript
  export interface AccuracyValidationResult {
    accuracy: number;
    threshold: number;
    isAcceptable: boolean;
    difference: number;
    quality: 'EXCELLENT' | 'GOOD' | 'MARGINAL' | 'UNACCEPTABLE';
  }
  ```
- **Quality Bands**:
  - `EXCELLENT`: $\le 10\text{m}$ (precise satellite lock)
  - `GOOD`: $\le 30\text{m}$ (acceptable outdoor lock)
  - `MARGINAL`: $\le 50\text{m}$ (within acceptable boundary)
  - `UNACCEPTABLE`: $> 50\text{m}$ (insufficient accuracy, rejected for geofence validation)

### 8.3 Coordinate Range Validation & Haversine Geofence Engine (`GeofenceService`)

1. **Strict Coordinate Range Verification**:
   All latitude/longitude inputs are rigorously validated before calculation:
   - Latitude must be finite and between $-90.0$ and $+90.0$ degrees.
   - Longitude must be finite and between $-180.0$ and $+180.0$ degrees.
   - Invalid or non-finite inputs immediately throw a typed `LocationHardwareError` with `INVALID_COORDINATES`.

2. **Haversine Geospatial Algorithm**:
   Computes the great-circle distance between two points on a spherical Earth of radius $R = 6,371,000\text{ meters}$:
   $$\Delta \phi = \frac{(\text{lat}_2 - \text{lat}_1) \cdot \pi}{180}, \quad \Delta \lambda = \frac{(\text{lon}_2 - \text{lon}_1) \cdot \pi}{180}$$
   $$a = \sin^2\left(\frac{\Delta \phi}{2}\right) + \cos\left(\frac{\text{lat}_1 \cdot \pi}{180}\right) \cdot \cos\left(\frac{\text{lat}_2 \cdot \pi}{180}\right) \cdot \sin^2\left(\frac{\Delta \lambda}{2}\right)$$
   $$c = 2 \cdot \text{atan2}\left(\sqrt{a}, \sqrt{1 - a}\right)$$
   $$d = R \cdot c$$

3. **Geofence Result Contract**:
   ```typescript
   export interface GeofenceResult {
     distanceMeters: number;
     radiusMeters: number;
     insideGeofence: boolean;
     targetLatitude: number;
     targetLongitude: number;
     sampleLatitude: number;
     sampleLongitude: number;
   }
   ```

4. **School Proximity Evaluation & Configurable Radius**:
   `LocationService.isWithinSchoolGeofence(schoolCoordinates, radiusMeters)` queries the current GPS fix, validates horizontal accuracy against the threshold, and evaluates whether the engineer is physically within the school radius.
   - **Engine Behavior**: Calculates exact spherical distance using Haversine math.
   - **Configurable Radius**: Accepts an explicit `radiusMeters` parameter on demand.
   - **Provisional Default**: When omitted, falls back to `LocationConfig.defaultGeofenceRadiusMeters` ($500\text{m}$), which is strictly a development provisional default.
   - **Unresolved Policy**: Operational policy on the official geofence threshold remains to be determined by domain leadership.

---

## 9. Camera Hardware Engine Architecture

The camera subsystem is implemented under `apps/field/src/hardware/camera/`:

```
apps/field/src/hardware/camera/
├── camera.types.ts             # Contracts, options, photo metadata interfaces
├── temporary-media-manager.ts  # In-memory registry for local temporary media paths
├── mock-camera-adapter.ts      # Deterministic in-memory adapter for testing & CI
├── expo-camera-adapter.ts      # Native Expo Camera hardware adapter
├── camera-service.ts           # Unified facade enforcing rear-camera & aspect ratio
└── index.ts                    # Public camera module exports
```

### 9.1 Rear-Camera Default & Camera Facing Control

Field evidence collection requires inspecting physical laboratory computers, solar batteries, UPS inverters, and networking racks.
- **Default Facing**: Enforced as `'back'` (rear camera) across `DEFAULT_CAMERA_CONFIG` and `CameraService.capturePhoto()`.
- **Photo-Only Mandate**: Captures discrete photographic frames. Video capture and front-facing selfie routines are strictly prohibited and unexposed.

### 9.2 Camera Permission States

- `UNKNOWN`: Permission unrequested.
- `GRANTED`: Full camera access allowed.
- `DENIED`: Camera access refused by user.
- `BLOCKED`: Restricted by OS permissions or device administrator.
- `UNAVAILABLE`: Device has no camera sensor.

### 9.3 Aspect Ratio & Geometric Dimensions

- **Supported Ratios**: `'4:3'` (Primary evidence ratio), `'16:9'`, `'1:1'`.
- **Default Aspect Ratio**: Standard $4:3$ high-resolution format (`DEFAULT_CAMERA_CONFIG.preferredAspectRatio = '4:3'`).
- **Aspect Ratio Normalization**: Camera service calculates greatest common divisor (GCD) of width and height to verify conformant frame geometry:
  $$\text{GCD}(w, h) \implies \text{Simplified Ratio String } (\text{e.g., } 4032 \times 3024 \to \text{"4:3"})$$

### 9.4 Photo Metadata Contract

```typescript
export interface CapturedPhoto {
  localUri: string;
  mimeType: string;         // Enforced: 'image/jpeg'
  width: number;            // Pixel width
  height: number;           // Pixel height
  aspectRatio: string;      // Normalized aspect ratio string (e.g. '4:3')
  capturedAt: string;       // ISO 8601 UTC timestamp
  fileSizeBytes?: number;   // Local file size in bytes
  metadata?: Record<string, string>;
}
```

### 9.5 Temporary Media Manager (`TemporaryMediaManager`)

During offline field operations, captured photographs exist solely as temporary files on the device filesystem prior to evidence uploading in Phase 14.
- **Registry**: Tracks registered local URIs with associated dimensions, timestamps, and metadata.
- **Isolation Guarantee**: Does **NOT** interact with WatermelonDB `local_operations` queue, does **NOT** compute S3 hashes, and creates **ZERO** evidence entities.
- **Lifecycle Methods**: `register()`, `get()`, `getAll()`, `remove()`, `clear()`, `count()`.

---

## 10. Mobile Hardware Diagnostics UI & Navigation Integration

To allow field technicians to verify hardware operational readiness before departing for remote lab sites, a dedicated, outdoor-readable diagnostics screen was created and integrated into the app navigation.

### 10.1 Outdoor High-Contrast Design (`HardwareDiagnosticsScreen.tsx`)

Following the mobile field UI specification for direct sunlight readability:
- Background: Deep slate/obsidian (`#0B0F19`)
- Panel cards: High-contrast bordered slate (`#1E293B`, border `#334155`)
- Text: High-contrast white (`#FFFFFF`) and high-legibility zinc (`#94A3B8`)
- Status indicators:
  - Success / Pass: High-visibility vivid green (`#22C55E`)
  - Warning / Marginal: Vivid amber (`#F59E0B`)
  - Failure / Error: Vivid crimson (`#EF4444`)
- Primary action buttons: Deep obsidian cards with crisp borders and uppercase typography.

### 10.2 Diagnostic Capabilities

1. **GPS Diagnostic Panel**:
   - Live permission status display (`UNKNOWN`, `GRANTED`, `DENIED`, etc.).
   - Permission request button.
   - GPS fix acquisition trigger.
   - Readout of Latitude, Longitude, Altitude, Timestamp.
   - GPS Accuracy meter with explicit $\le 50\text{m}$ acceptable badge indicator.
   - Interactive School Geofence simulation (verifies distance and proximity using the centralized provisional radius, clearly badged with `(provisional)`).
2. **Camera Diagnostic Panel**:
   - Camera permission status readout and request trigger.
   - Rear-camera test capture button (strictly using back camera and $4:3$ format).
   - Captured photo preview thumbnail.
   - Image metadata readout (Width, Height, Aspect Ratio, Format, Timestamp).
   - Temporary media item counter.

### 10.3 Screen Navigation Routing

1. **Screen Enum (`apps/field/src/navigation/types.ts`)**:
   Added `HARDWARE_DIAGNOSTICS` to `ScreenName` union.
2. **Profile Screen Launch Point (`apps/field/src/screens/ProfileScreen.tsx`)**:
   Added high-contrast quick-launch button:
   ```
   [ 📡 HARDWARE DIAGNOSTICS (GPS & CAMERA) ]
   ```
3. **Navigator Wiring (`apps/field/src/navigation/Navigator.tsx`)**:
   Wired `HardwareDiagnosticsScreen` with initialized `activeLocService` and `activeCamService` singletons.

---

## 11. Architectural Boundary Verifications

In strict compliance with the MUSE SPARK Single-Phase Protocol, explicit automated boundary tests (`test/hardware-boundaries.spec.ts`) verify that Phase 11 introduces zero premature implementation of later phases:

```typescript
describe('Phase 11 — Strict Architectural Boundary Verifications', () => {
  it('confirms hardware location does not mutate service cases, check-in visits, or create operations', async () => {
    // 1. Database case status unchanged
    // 2. Local operation queue count remains 0
    // 3. No field visit record exists in database
  });

  it('confirms hardware camera capture does not upload to S3 or produce evidence entities', async () => {
    // 1. TemporaryMediaManager holds strictly local URI
    // 2. Zero network S3 requests or pre-signed URL fetches
    // 3. Local database operations queue count remains 0
  });

  it('confirms absence of Phase 12-16 methods and properties in LocationService and CameraService', () => {
    // Asserts undefined for sync, push, conflict, visit, evidence, S3, conveyance methods
  });
});
```

### Detailed Boundary Analysis Matrix

| Future Phase | Boundary Rule | Phase 11 Verification |
| :--- | :--- | :--- |
| **Phase 12 (Delta Sync)** | No sync tokens, no delta negotiation, no push engine. | Neither `LocationService` nor `CameraService` contains sync logic. Local operation queue is untouched. |
| **Phase 13 (Field Visits)** | No visit models, no visit state machine, no check-in/out workflows. | `LocationService` calculates distance only; it does not trigger check-in or mutate service case status. |
| **Phase 14 (Evidence Pipeline)**| No S3 streaming, no pre-signed URLs, no SHA-256 evidence hashing. | `CameraService` registers photos only in `TemporaryMediaManager`. No checksums or S3 endpoints exist. |
| **Phase 15 (Conveyance & Web)** | No travel claim generation, no web dashboard components. | GPS acquisition does not calculate route mileage or conveyance claims. |
| **Phase 16 (E2E Hardening)** | No end-to-end rehearsal runner. | Unit and diagnostic tests only. |

---

## 12. Automated Test Suite & Accounting

### 12.1 Test Accounting Breakdown

- **Phase 10 Baseline Mobile Tests:** 35 passing tests (9 test files)
- **Phase 11 New Mobile Tests:** 45 passing tests (across 3 dedicated files + smoke):
  - `test/hardware-location.spec.ts`: 22 tests (permissions, accuracy $\le 50\text{m}$, threshold variations, Haversine calculations, provisional default geofence radius, tight/relaxed custom radii, dynamic radius configurability proof, school proximity, error conditions).
  - `test/hardware-camera.spec.ts`: 19 tests (permissions, rear-camera default, custom facings, aspect ratio computations, temporary media registry, error handling).
  - `test/hardware-boundaries.spec.ts`: 3 tests (zero case mutation, zero S3 upload, absence of Phase 12–16 methods).
  - `test/field.spec.ts`: 1 test updated for Phase 11 module integration.
- **Total `@zentra/field` Mobile Tests:** **80 / 80 passing tests** across 12 test files.
- **Monorepo Backend Regression Tests (`@zentra/api`):** **185 / 185 passing tests** across 7 test files.
- **Monorepo Web Smoke Tests (`@zentra/web`):** **1 / 1 passing test** across 1 test file.
- **Grand Total Monorepo Tests:** **266 / 266 passing tests** across 20 test files.

### 12.2 Typecheck & Build Status

- Command: `pnpm turbo run typecheck`
- Result: **15 / 15 tasks successful**, 0 TypeScript errors.

---

## 13. Physical Hardware Runtime Disclaimer

> [!WARNING]
> **NOT TESTED ON PHYSICAL HARDWARE — REQUIRES MOBILE RUNTIME**
>
> All automated tests in this phase were executed in an emulated/headless Node.js environment utilizing decoupled provider adapters (`MockLocationAdapter`, `MockCameraAdapter`, and lazy-loaded Expo adapter contracts).
>
> While `expo-location` and `expo-camera` configurations and CNG plugins have been authored in `apps/field/app.json` strictly to specification, physical device execution (Android/iOS hardware sensors, camera driver HAL, GPS baseband chipset) requires compiling a native development build using Expo CNG (`npx expo prebuild` / `npx expo run:android`) and testing on physical mobile hardware under outdoor conditions.

---

## 14. Artifacts & File Inventory

### 14.1 Files Created in Phase 11

| File Path | Lines | Purpose |
| :--- | :---: | :--- |
| `apps/field/src/hardware/location/location.types.ts` | 115 | Location contracts, permission enums, accuracy & geofence interfaces, centralized provisional config |
| `apps/field/src/hardware/location/accuracy-validator.ts` | 56 | GPS horizontal accuracy evaluator ($\le 50\text{m}$ target) |
| `apps/field/src/hardware/location/geofence-service.ts` | 89 | Haversine distance calculator and geofence evaluator |
| `apps/field/src/hardware/location/mock-location-adapter.ts` | 78 | In-memory deterministic location provider for tests and CI |
| `apps/field/src/hardware/location/expo-location-adapter.ts` | 108 | Native Expo Location adapter with lazy-loading fallback |
| `apps/field/src/hardware/location/location-service.ts` | 140 | Unified facade for location, accuracy validation, and geofencing |
| `apps/field/src/hardware/location/index.ts` | 14 | Public barrel exports for location subsystem |
| `apps/field/src/hardware/camera/camera.types.ts` | 104 | Camera contracts, permission enums, photo metadata interfaces |
| `apps/field/src/hardware/camera/temporary-media-manager.ts` | 64 | Local temporary media registry isolating files from S3/queue |
| `apps/field/src/hardware/camera/mock-camera-adapter.ts` | 87 | In-memory deterministic camera provider for tests and CI |
| `apps/field/src/hardware/camera/expo-camera-adapter.ts` | 118 | Native Expo Camera adapter with lazy-loading fallback |
| `apps/field/src/hardware/camera/camera-service.ts` | 130 | Unified facade enforcing rear-camera default and aspect ratio |
| `apps/field/src/hardware/camera/index.ts` | 14 | Public barrel exports for camera subsystem |
| `apps/field/src/hardware/index.ts` | 8 | Unified barrel export for all hardware capabilities |
| `apps/field/src/screens/HardwareDiagnosticsScreen.tsx` | 340 | Outdoor high-contrast hardware diagnostics UI component |
| `apps/field/test/hardware-location.spec.ts` | 358 | Comprehensive unit tests for location engine (22 tests) |
| `apps/field/test/hardware-camera.spec.ts` | 240 | Comprehensive unit tests for camera engine (19 tests) |
| `apps/field/test/hardware-boundaries.spec.ts` | 98 | Boundary verification tests for Phase 12–16 isolation (3 tests) |
| `docs/MUSE_SPARK_IMPLEMENTATION_REPORT_PHASE11.md` | ~465 | Mandatory MUSE SPARK Phase 11 Implementation Report |

### 14.2 Files Modified in Phase 11

| File Path | Changes Made |
| :--- | :--- |
| `apps/field/package.json` | Added `expo-location@~57.0.20` and `expo-camera@~57.0.6` dependencies |
| `apps/field/app.json` | Added CNG plugin declarations for `expo-location` and `expo-camera` with permission strings |
| `apps/field/src/navigation/types.ts` | Added `HARDWARE_DIAGNOSTICS` to `ScreenName` union |
| `apps/field/src/screens/ProfileScreen.tsx` | Added hardware diagnostics navigation button |
| `apps/field/src/navigation/Navigator.tsx` | Registered `HardwareDiagnosticsScreen` route and hardware service singletons |
| `apps/field/src/index.ts` | Exported hardware subsystem and updated Phase 11 completion status |
| `apps/field/test/field.spec.ts` | Updated smoke test suite for Phase 11 integration |

---

## 15. Security, Privacy & Integrity Considerations

1. **User Permission Transparency**:
   Permissions are explicitly checked and requested on demand with clear justification strings conforming to Google Play and Apple App Store location and camera guidelines.
2. **Location Privacy**:
   GPS coordinates are sampled on demand only; background location tracking, continuous geofencing daemons, or unconsented location broadcasting are not implemented.
3. **Tamper-Resistance Preparations**:
   GPS accuracy is measured directly on each hardware sample, allowing future Phase 13 visit check-ins to reject low-precision or spoofed coordinates.
4. **Local File Isolation**:
   Temporary camera captures are stored within device-private sandbox paths and tracked in `TemporaryMediaManager`. No unencrypted sensitive evidence leaks outside the sandbox.

---

## 16. Verification Command Transcript

```bash
# 1. Monorepo Typecheck
pnpm turbo run typecheck
# Result: 15 successful, 15 total (0 errors)

# 2. Field App Unit, Integration & Boundary Tests
pnpm --filter @zentra/field test
# Result: 12 passed, 80 passed (100% pass)

# 3. Full Monorepo Test Execution
pnpm turbo run test --force
# Result: 13 successful, 13 total (266 passed, 0 failed)
```

---

STOPPED AFTER THIS STEP — AWAITING REVIEW.

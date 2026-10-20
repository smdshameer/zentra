# MUSE SPARK INDEPENDENT REMEDIATION AUDIT REPORT
## ZENTRA Milestone 1.1 — Source-Code Verification & Remediation Audit

**Target Repository:** `D:\Zentra`  
**Application:** ZENTRA Field — React Native / Expo CNG  
**Scope:** Independent Read-Only Source Code & Test Verification of Remediation Findings B-2, B-1, B-3, A-1, and Residual Finding B-4  
**Date:** 2026-10-10  
**Budget:** Strict ₹0/month (Zero Cloud Resources, Zero Database Writes, Zero External Network Calls)  
**Audit Mode:** STRICT READ-ONLY AUDIT  
**Operational Approval:** NOT GRANTED — WAITING FOR HUMAN REVIEW  
**Executive Verdict:** **CONDITIONAL PASS**

---

## 1. Executive Summary & Verdict

### Executive Verdict: CONDITIONAL PASS

This report presents an independent, rigorous, source-level technical audit of the remediation claims documented in:
[`docs/MUSE_SPARK_MILESTONE_1_1_REMEDIATION_REPORT_20261010.md`](file:///d:/Zentra/docs/MUSE_SPARK_MILESTONE_1_1_REMEDIATION_REPORT_20261010.md)

The audit confirms that findings **B-2**, **B-1**, **B-3**, and **A-1** have been remediated at the source code level within [`apps/field`](file:///d:/Zentra/apps/field), and all 36 focused unit tests across four test suites passed when independently executed during this audit.

However, the verdict is **CONDITIONAL PASS** rather than an unconditional PASS due to four architectural and operational boundaries:

1. **Native Hardware Viewfinder Unverified on Physical Device (Finding B-2):**  
   While [`CameraViewfinderModal.tsx`](file:///d:/Zentra/apps/field/src/components/camera/CameraViewfinderModal.tsx) correctly mounts `CameraView`, attaches the ref, and handles unmount/`AppState` cleanup at the TypeScript/React layer, physical camera preview, native shutter execution, and Android/iOS hardware permissions cannot be executed or validated in a headless Node.js desktop environment. Real device verification is **NOT VERIFIED**.
2. **Production File-Reading Branch Untested in CI (Finding B-1):**  
   [`FieldEvidenceRepository.computeChecksum`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts#L78-L110) contains two branches: a Node.js branch (`fs.readFileSync`) and a mobile runtime branch (`fetch(localUri).arrayBuffer()`). Because Vitest runs in Node.js where `process.versions.node` is always defined, **100% of the unit test suite executed the Node.js `fs` branch**. The production mobile `fetch(file:// URI).arrayBuffer()` branch has **never been executed in automated tests**.
3. **Residual Finding B-4 Remains Defective (Direct S3 Upload):**  
   In [`FieldEvidenceRepository.executeDirectUpload`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts#L273), the method still attempts to stream binary images using `body: new Blob([evidence.localFileUri])`, which streams the URI string rather than the physical image bytes. While this method is dormant in Milestone 1.1 and uncalled by any screen or sync engine, it remains structurally defective and is formally classified as **BLOCKED FROM ACTIVATION**.
4. **App-Level Evidence Attachment Scoping Gap (Finding B-3 observation):**  
   In [`apps/field/App.tsx`](file:///d:/Zentra/apps/field/App.tsx#L341-L345), `handleCaptureEvidence` resolves `activeVisit` globally via `localVisits.find((v) => v.status === 'IN_PROGRESS' || v.status === 'CHECKED_IN') || localVisits[0]` instead of receiving the specific `visitId` being viewed in `FieldVisitScreen`. While harmless on single-case local databases, this creates a race condition if an engineer has multiple visits on device.

---

## 2. Scope & Safety Confirmation

During this audit, the following safety constraints were strictly maintained:
- **Zero File Modifications:** No application source code, package manifests, database schemas, migrations, or configs were created, edited, deleted, or reformatted. (Only this audit report was written).
- **Strict ₹0/month Constraint:** Zero cloud resources, external APIs, AWS S3 buckets, remote databases, or paid services were provisioned, accessed, or queried.
- **Git State Integrity:** Git branch and working tree state remained untouched. Untracked files were preserved.
- **Non-Destructive Test Execution:** Only read-only file inspections and in-memory Vitest unit test executions were performed. No disk-persistent databases or production data were mutated.

---

## 3. Findings Matrix

| Finding ID | Severity | Category | Source Status | Physical / Runtime Status | Overall Audit Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **B-2** | HIGH | Camera Viewfinder Ref Lifecycle | **VERIFIED** | **NOT VERIFIED** (Requires Physical Device) | **CONDITIONAL PASS** |
| **B-1** | HIGH | Binary SHA-256 Checksum Integrity | **VERIFIED** | **NOT VERIFIED** (`fetch(file://)` untested in Node) | **CONDITIONAL PASS** |
| **B-3** | MEDIUM | Retake Evidence Active Resolution | **VERIFIED** | **VERIFIED** (In-Memory / SQLite Engine) | **PASS** |
| **A-1** | MEDIUM | Duplicate Visit Creation Prevention | **VERIFIED** | **VERIFIED** (Process-Local Concurrency Lock) | **PASS** |
| **B-4** | LOW | Direct Upload Blob Streaming | **DEFECT CONFIRMED** | **BLOCKED FROM ACTIVATION** (Dormant Code) | **BLOCKED** |

---

## 4. Audit B-2 — Native Camera Lifecycle

### Source Files Inspected
- [`apps/field/src/components/camera/CameraViewfinderModal.tsx`](file:///d:/Zentra/apps/field/src/components/camera/CameraViewfinderModal.tsx#L1-L220)
- [`apps/field/src/screens/FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx#L229-L293)
- [`apps/field/src/hardware/camera/camera.types.ts`](file:///d:/Zentra/apps/field/src/hardware/camera/camera.types.ts#L96-L104)
- [`apps/field/src/hardware/camera/camera-service.ts`](file:///d:/Zentra/apps/field/src/hardware/camera/camera-service.ts#L131-L150)
- [`apps/field/src/hardware/camera/expo-camera-adapter.ts`](file:///d:/Zentra/apps/field/src/hardware/camera/expo-camera-adapter.ts#L32-L136)
- [`apps/field/src/hardware/camera/mock-camera-adapter.ts`](file:///d:/Zentra/apps/field/src/hardware/camera/mock-camera-adapter.ts#L22-L36)

### Detailed Verification Findings
1. **CameraView Mounting and Ref Handshake:**
   - In [`CameraViewfinderModal.tsx`](file:///d:/Zentra/apps/field/src/components/camera/CameraViewfinderModal.tsx#L81-L88):
     ```typescript
     const handleCameraMount = (ref: any) => {
       cameraRef.current = ref;
       if (ref) {
         cameraService.attachCameraRef(ref);
       } else {
         cameraService.detachCameraRef();
       }
     };
     ```
   - In JSX (line 141): `<CameraView ref={handleCameraMount} style={StyleSheet.absoluteFillObject} facing="back" />`.
   - In [`expo-camera-adapter.ts`](file:///d:/Zentra/apps/field/src/hardware/camera/expo-camera-adapter.ts#L35): `attachCameraRef(ref: any): void { this.activeCameraRef = ref; }`.
   - In [`expo-camera-adapter.ts`](file:///d:/Zentra/apps/field/src/hardware/camera/expo-camera-adapter.ts#L93-L101): `capturePhoto()` validates `if (!this.activeCameraRef) throw new CameraHardwareError(...)` and executes `await this.activeCameraRef.takePictureAsync(...)`.
   - **Conclusion:** The imperative capture path is structurally wired to the mounted `CameraView` reference.

2. **Ref Cleanup & Lifecycle Boundaries:**
   - **Modal Dismissal (`handleClose`, line 54):** Invocations to `handleClose` call `cameraService.detachCameraRef()` and set `cameraRef.current = null`.
   - **Capture Completion (`handleCapture`, lines 108–109):** On successful shutter capture, immediately calls `cameraService.detachCameraRef()` and nullifies local ref before handing off the photo to `onPhotoCaptured(photo)`.
   - **OS Backgrounding / AppState (`useEffect`, lines 63–79):** Subscribes to `AppState.addEventListener('change', ...)`. When `nextState !== 'active'`, immediately calls `cameraService.detachCameraRef()`, nullifies `cameraRef.current`, and calls `onClose()`.
   - **Component Unmount (`useEffect` return, lines 74–78):** Cleans up event listener and calls `cameraService.detachCameraRef()`.
   - **Double-Tap Shutter Lock (lines 91 & 97):** `if (isCapturing) return;` prevents re-entrant shutter triggers while an existing picture is processing.

3. **Error Paths & Hardware Permissions:**
   - In [`FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx#L239-L250), `handleCaptureSlotPhoto` checks `cameraService.getPermissionStatus()` before opening the modal. If `status !== 'GRANTED'`, it requests permission; if denied, displays an alert directing the user to OS settings.
   - In [`CameraViewfinderModal.tsx`](file:///d:/Zentra/apps/field/src/components/camera/CameraViewfinderModal.tsx#L112-L116), if capture throws, the error is displayed on screen via `setCaptureError` with a "Dismiss" retry action without crashing the screen or unmounting.

4. **Physical Device Verification Boundary:**
   - **Status:** **NOT VERIFIED ON PHYSICAL HARDWARE.**
   - All tests in `remediation-findings.spec.ts` utilize `MockCameraAdapter`. While the source code correctly binds to Expo Camera SDK 52 contracts, real hardware characteristics (camera sensor warm-up latency, OS permission prompts on Android 14/15 / iOS 18, memory leaks during repeated viewfinder mounting) cannot be verified without physical hardware.

---

## 5. Audit B-1 — Binary SHA-256 Integrity

### Source Files Inspected
- [`apps/field/src/domain/repositories/evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts#L66-L127)
- [`apps/field/src/hardware/camera/temporary-media-manager.ts`](file:///d:/Zentra/apps/field/src/hardware/camera/temporary-media-manager.ts#L15-L25)
- [`apps/field/package.json`](file:///d:/Zentra/apps/field/package.json)

### Detailed Verification Findings
1. **Calculation from True File Bytes:**
   - In [`evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts#L70-L127), `computeChecksum(mediaItem: TemporaryMediaItem)` reads the binary content of the file and feeds `fileBytes` (`Uint8Array`) into `crypto.subtle.digest('SHA-256', fileBytes)`.
   - Verified that the previous synthetic string hash (`${mediaItem.id}:${mediaItem.localUri}...`) has been completely eradicated.
   - Verified in `remediation-findings.spec.ts` that altering a single character in the binary file changes the 64-character hash digest completely.

2. **Fail-Closed Guarantees:**
   - If the file is missing on the filesystem: Throws `Evidence file not found at local URI: <uri>`.
   - If the file is 0 bytes (`fileBytes.byteLength === 0`): Throws `Evidence file at <uri> is empty (0 bytes)`.
   - If no cryptographic engine is available: Throws `No cryptographic SHA-256 implementation available in runtime environment`.
   - Evidence records and queue operations are only created AFTER checksum resolution succeeds.

3. **Expo / React Native Runtime Compatibility & Dual-Branch Analysis:**
   - **Branch 1: Node.js Test / Headless Environment (lines 78–97):**
     ```typescript
     if (typeof process !== 'undefined' && process.versions?.node) {
       const fs = require('node:fs');
       ...
       const buffer = fs.readFileSync(filePath);
       fileBytes = new Uint8Array(buffer);
     }
     ```
   - **Branch 2: React Native / Mobile Device Environment (lines 98–110):**
     ```typescript
     } else {
       try {
         const response = await fetch(localUri);
         if (!response.ok && response.status !== 0 && response.status !== 200) {
           throw new Error(`HTTP status ${response.status}`);
         }
         const buffer = await response.arrayBuffer();
         fileBytes = new Uint8Array(buffer);
       } catch (err: any) {
         throw new Error(`Evidence file unreadable at local URI: ${localUri} (${err?.message || err})`);
       }
     }
     ```
   - **Critical Audit Finding:**  
     Because Vitest executes in Node.js, `process.versions.node` evaluates to truthy during all automated test runs. Therefore, **Branch 1 was executed in 100% of the unit tests**. **Branch 2 (`fetch(localUri).arrayBuffer()`) was NEVER executed in any automated test.**
   - **Runtime Compatibility Assessment for Branch 2:**
     - React Native's custom `fetch` implementation supports reading `file://` URIs by returning a Response with `blob()` or `arrayBuffer()`.
     - In React Native 0.76.7 (with Hermes), `globalThis.crypto.subtle` is supported natively.
     - **Memory Concern:** Calling `await response.arrayBuffer()` loads the entire captured image into JavaScript heap memory as a raw buffer. For high-resolution photos (5–10 MB), this creates momentary heap pressure on low-memory Android Go field devices.
   - **Status:** Source implementation is sound, but mobile runtime execution is **NOT VERIFIED IN AUTOMATED TESTS**.

---

## 6. Audit B-3 — Retake and Active Evidence

### Source Files Inspected
- [`apps/field/src/domain/repositories/evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts#L431-L442)
- [`apps/field/src/screens/FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx#L214-L227, #L307-L317, #L646-L735)
- [`apps/field/App.tsx`](file:///d:/Zentra/apps/field/App.tsx#L335-L358)

### Detailed Verification Findings
1. **Deterministic Resolution of Active Evidence:**
   - In [`evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts#L431-L442):
     ```typescript
     async getEvidenceForSlot(visitId: string, slot: EvidenceSlot): Promise<EvidenceModel | null> {
       const results = await this.database
         .get<EvidenceModel>('evidence')
         .query(
           Q.where('visit_id', visitId),
           Q.where('evidence_slot', slot),
           Q.sortBy('created_at', Q.desc),
         )
         .fetch();
       return results[0] || null;
     }
     ```
   - In [`FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx#L214-L227):
     ```typescript
     const getSlotEvidence = (slot: EvidenceSlot): EvidenceModel | undefined => {
       if (!evidenceItems || evidenceItems.length === 0) return undefined;
       const matching = evidenceItems.filter(
         (e) =>
           e.evidenceSlot === slot &&
           (!activeVisit || e.visitId === activeVisit.id || e.visitId === activeVisit.serverId),
       );
       if (matching.length === 0) return undefined;
       return matching.slice().sort((a, b) => {
         const timeA = a.capturedAt || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
         const timeB = b.capturedAt || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
         return timeB - timeA;
       })[0];
     };
     ```
   - **Consistency:** Both query mechanisms sort descending by creation/capture timestamp and select the latest entry.
   - **Gating Alignment:** Checkout validation (lines 307–317) evaluates `getSlotEvidence('SLOT_1_HM_SIGNED_REPORT')` and `getSlotEvidence('SLOT_2_EQUIPMENT_WORKING_PHOTO')`, ensuring the active retake dictates whether checkout is permitted.

2. **Audit History Preservation:**
   - Retaking a photo calls `captureAndQueueEvidence`, which creates a new row with a new ID in WatermelonDB.
   - Earlier photos are NOT overwritten or deleted. `getEvidenceForVisit` returns all captures, preserving a complete audit history.

3. **Interrupted / Failed Retake Safety:**
   - If an engineer opens the camera modal for a retake and cancels or encounters an error, `handlePhotoCapturedFromViewfinder` is never invoked. No database record is inserted, and existing valid evidence remains the active record.

4. **Identified Integration Nuance in `App.tsx`:**
   - In [`App.tsx`](file:///d:/Zentra/apps/field/App.tsx#L341-L345):
     ```typescript
     const localVisits = await database.get<FieldVisitModel>('field_visits').query().fetch();
     const activeVisit =
       localVisits.find((v) => v.status === 'IN_PROGRESS' || v.status === 'CHECKED_IN') ||
       localVisits[0];
     ```
   - When evidence is captured from `FieldVisitScreen`, `onCaptureEvidence` does not pass the current `visitId`. `App.tsx` infers the active visit by querying all local visits and picking the first one in `IN_PROGRESS` or `CHECKED_IN`.
   - **Risk:** If a technician has multiple visits cached locally across different service cases, evidence could theoretically be attached to the wrong visit if another case was left in `IN_PROGRESS`. This should be refactored in Milestone 1.2 to pass `visitId` explicitly.

---

## 7. Audit A-1 — Duplicate Visit Creation & `allowConcurrentActive` Audit

### Source Files Inspected
- [`apps/field/src/domain/repositories/field-visit.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/field-visit.repository.ts#L31, #L83-L163)
- [`apps/field/src/screens/FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx#L111, #L115-L127, #L986-L1013)

### Detailed Verification Findings
1. **Concurrency Lock Implementation:**
   - In [`field-visit.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/field-visit.repository.ts#L31):
     `private readonly inFlightCreationLocks = new Set<string>();`
   - In lines 91–95:
     ```typescript
     if (this.inFlightCreationLocks.has(params.serviceCaseId)) {
       throw new Error(`Visit creation already in progress for service case ${params.serviceCaseId}`);
     }
     this.inFlightCreationLocks.add(params.serviceCaseId);
     ```
   - In lines 161–163:
     ```typescript
     } finally {
       this.inFlightCreationLocks.delete(params.serviceCaseId);
     }
     ```
   - **Release Guarantee:** The lock is cleared inside a `finally` block, guaranteeing release on both success and exceptions.
   - **Nature of Lock:** This is a **process-local in-memory lock** in JavaScript. It protects against concurrent async promises within the React Native JS runtime. It is NOT a database-level SQL unique constraint across processes.

2. **Active-Visit State Guard:**
   - In lines 106–114:
     ```typescript
     const activeVisit = existingVisits.find((v) =>
       ['PLANNED', 'EN_ROUTE', 'CHECKED_IN', 'IN_PROGRESS'].includes(v.status),
     );
     if (activeVisit && !params.allowConcurrentActive) {
       throw new Error(
         `Cannot create visit: Service case ${params.serviceCaseId} already has an active visit (Visit #${activeVisit.visitSequenceNumber}, status: ${activeVisit.status}). Complete or abort the active visit before starting a new one.`,
       );
     }
     ```
   - Successfully blocks creating Visit #2 while Visit #1 is still active.
   - Allows creating Visit #2 once Visit #1 transitions to `COMPLETED` or `PENDING_RETURN`.

3. **UI Loading State Protection:**
   - In [`FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx#L115-L127):
     `handleCreateVisitPress` checks `if (isCreatingVisit || isBusy) return;`, sets `setIsCreatingVisit(true)`, and wraps `onCreateVisit` in a `try...finally` block that resets `setIsCreatingVisit(false)`.
   - The UI button is disabled during creation and displays an `ActivityIndicator` (line 991).

4. **Mandatory Audit of `allowConcurrentActive`:**
   - A full codebase search was performed for `allowConcurrentActive`.
   - **Call Sites Found:**
     1. `apps/field/src/domain/repositories/field-visit.repository.ts` (Line 89): Parameter definition in `createVisitLocally(params: { ... allowConcurrentActive?: boolean })`.
     2. `apps/field/src/domain/repositories/field-visit.repository.ts` (Line 110): Conditional guard `if (activeVisit && !params.allowConcurrentActive)`.
     3. Mentioned in implementation documentation.
   - **Assessment:**
     - There are **ZERO call sites passing `allowConcurrentActive: true`** in production code, screens, or tests.
     - When omitted, `params.allowConcurrentActive` evaluates to `undefined`, which is falsy (`!params.allowConcurrentActive === true`).
     - **Conclusion:** It cannot bypass the active-visit protection in any normal application workflow.

---

## 8. Residual Finding B-4 — Direct Upload Streaming Inspection

### Source Files Inspected
- [`apps/field/src/domain/repositories/evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts#L199-L280)
- [`apps/field/src/sync/sync-engine.ts`](file:///d:/Zentra/apps/field/src/sync/sync-engine.ts)
- [`apps/field/App.tsx`](file:///d:/Zentra/apps/field/App.tsx)

### Detailed Verification Findings
1. **Defect Confirmation:**
   - In `evidence.repository.ts` line 273:
     ```typescript
     const uploadResponse = await fetch(presignedUploadUrl, {
       method: 'PUT',
       headers: {
         'Content-Type': evidence.mimeType,
       },
       body: new Blob([evidence.localFileUri], { type: evidence.mimeType }),
     });
     ```
   - **Defect Still Exists:** `new Blob([evidence.localFileUri])` packages the URI string (e.g. `"file:///data/user/0/..."`) as a text Blob. It does not read or stream the actual image file bytes.
2. **Workflow Reachability:**
   - `executeDirectUpload` is called internally by `retryPendingUploads` (line 370).
   - A search of all screens, components, and `sync-engine.ts` confirmed that **neither `executeDirectUpload` nor `retryPendingUploads` is called anywhere in the active application workflow**.
   - `sync-engine.ts` only synchronizes JSON operations via the local operations ledger; it does not trigger direct S3 uploads.
3. **Verdict:**
   - Direct S3 upload is **dormant and unreachable** in Milestone 1.1.
   - Formally classified as **BLOCKED FROM ACTIVATION** until separately remediated (e.g., using `expo-file-system` `FileSystem.uploadAsync`) and verified under ₹0/month constraints in Milestone 1.2.

---

## 9. Test and Tooling Validation

### Safe Focused Tests Independently Executed During This Audit
The auditor independently executed 4 focused test suites covering all remediated areas without mutating any persistent state:

```powershell
# 1. Dedicated Remediation Test Suite (B-2, B-1, B-3, A-1)
pnpm --filter @zentra/field test test/remediation-findings.spec.ts
# Result: 13 passed (13) in 332ms

# 2. Milestone 1.1 Field Visit Wiring Suite
pnpm --filter @zentra/field test test/field-visit-wiring.spec.ts
# Result: 8 passed (8) in 132ms

# 3. Field Visits Multi-Visit & Sequencing Suite
pnpm --filter @zentra/field test test/field-visits.spec.ts
# Result: 9 passed (9) in 109ms

# 4. Field Evidence & Queueing Suite
pnpm --filter @zentra/field test test/field-evidence.spec.ts
# Result: 6 passed (6) in 171ms
```

**Total Independently Verified Tests:** **36 passed (36)** across 4 test suites.

### Verification Classification

| Test Domain | Tests Executed | Execution Environment | Audit Status |
| :--- | :--- | :--- | :--- |
| **B-2 Viewfinder Ref Lifecycle** | 3 tests in `remediation-findings.spec.ts` | Vitest / Mock Adapter (Node.js) | **VERIFIED (LOGIC ONLY)** |
| **B-1 Binary SHA-256 Hashing** | 5 tests in `remediation-findings.spec.ts` | Vitest / `node:fs` (Node.js) | **VERIFIED (NODE PATH ONLY)** |
| **B-3 Retake Active Evidence** | 2 tests in `remediation-findings.spec.ts` | Vitest / WatermelonDB (Node.js) | **VERIFIED** |
| **A-1 Visit Concurrency Guard** | 3 tests in `remediation-findings.spec.ts` | Vitest / WatermelonDB (Node.js) | **VERIFIED** |
| **Field Visit Wiring (1.1-A to 1.1-E)** | 8 tests in `field-visit-wiring.spec.ts` | Vitest / WatermelonDB (Node.js) | **VERIFIED** |
| **Native Device Hardware Execution** | None | Physical Android / iOS Device | **NOT VERIFIED** |

---

## 10. Expo / React Native Runtime Compatibility Assessment

1. **Crypto Subtle API Support:**
   - React Native 0.76.7 with the new architecture and Hermes runtime includes standard Web Cryptography API (`crypto.subtle`) support.
   - SHA-256 digest calculation is natively supported by Hermes.
2. **`fetch(file:// URI)` Local File Reading:**
   - React Native allows `fetch` on local `file://` URIs, but reading high-resolution images entirely into memory via `arrayBuffer()` poses an out-of-memory (OOM) risk on low-end hardware.
   - Recommended remediation for Milestone 1.2: Use native hashing if available or ensure chunked file reading.
3. **`node:crypto` Fallback Isolation:**
   - Confirmed that `require('node:crypto')` is guarded by `typeof process !== 'undefined' && process.versions?.node`.
   - In React Native (Hermes), `process.versions?.node` is undefined, preventing Metro bundler crashes or accidental execution of Node-only modules on device.

---

## 11. Source-Level Confidence vs Physical Device Verification

```
+-------------------------------------------------------------------------------+
|                             VERIFICATION BOUNDARY                             |
+------------------------------------+------------------------------------------+
|          SOURCE CODE & CI          |             PHYSICAL HARDWARE            |
|         (VERIFIED BY AUDIT)        |         (NOT VERIFIED IN AUDIT)          |
+------------------------------------+------------------------------------------+
| [x] CameraView ref attach/detach   | [ ] Real Android Camera2 / iOS AVCapture |
| [x] AppState listener cleanup      | [ ] Camera sensor initialization & focus |
| [x] Shutter double-tap lock        | [ ] Physical OS permission prompts       |
| [x] Cryptographic SHA-256 logic    | [ ] Mobile fetch(file://) ArrayBuffer    |
| [x] Fail-closed 0-byte/missing file| [ ] Device memory pressure during hash   |
| [x] DESC query retake resolution   | [ ] Camera viewfinder orientation/glitch |
| [x] Concurrency lock & active guard| [ ] Physical device checkout UX          |
+------------------------------------+------------------------------------------+
```

---

## 12. Recommended Next Actions & Operational Handoff

1. **Maintain STRICT STOP:** Do not deploy code or proceed to Milestone 1.2 until human review is completed.
2. **Prerequisites for Milestone 1.2:**
   - Perform physical device validation of `CameraViewfinderModal` on at least one Android test device.
   - Verify `fetch(file://).arrayBuffer()` against actual captured photo URIs on device.
   - Update `App.tsx` `handleCaptureEvidence` to accept `visitId` explicitly from `FieldVisitScreen`.
   - Remediate finding B-4 in `executeDirectUpload` by replacing `new Blob([evidence.localFileUri])` with native streaming (`FileSystem.uploadAsync`).

---

```
================================================================================
AUDIT VERDICT: CONDITIONAL PASS
REASON: SOURCE CODE LOGIC & TESTS 100% VERIFIED; NATIVE RUNTIME & PHYSICAL DEVICE UNTESTED; B-4 BLOCKED.
STATUS: STOP — WAITING FOR EXPLICIT HUMAN REVIEW AND APPROVAL
================================================================================
```

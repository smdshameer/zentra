# MUSE SPARK TARGETED AUDIT & REMEDIATION PLAN
## Investigation & Remediation Architecture: Visit ID Scoping & Direct Upload Binary Integrity

**Target Repository:** `D:\Zentra`  
**Application:** ZENTRA Field — React Native / Expo CNG  
**Scope:** In-Depth Inspection of Issue A (Visit ID Scoping in `App.tsx`) and Issue B (Direct Upload Binary Payload Defect in `executeDirectUpload`)  
**Mode:** READ-ONLY AUDIT & PLANNING ONLY (Implementation Approval: NOT GRANTED)  
**Date:** 2026-10-10  
**Budget:** Strict ₹0/month (Zero Cloud Resources, Zero Network Operations)  
**Deliverable File:** `docs/MUSE_SPARK_TARGETED_REMEDIATION_PLAN_20261010.md`  

---

## 1. Executive Summary & Current Status

Following the Milestone 1.1 independent remediation audit ([`docs/MUSE_SPARK_MILESTONE_1_1_INDEPENDENT_REMEDIATION_AUDIT_20261010.md`](file:///d:/Zentra/docs/MUSE_SPARK_MILESTONE_1_1_INDEPENDENT_REMEDIATION_AUDIT_20261010.md)), which awarded a **CONDITIONAL PASS**, this document conducts an exhaustive, source-level investigation of the two remaining architectural concerns:

1. **Issue A — Visit ID Scoping Gap:**  
   In [`apps/field/App.tsx`](file:///d:/Zentra/apps/field/App.tsx#L341-L345), `handleCaptureEvidence` infers the active visit globally using an unconstrained query over all cached visits (`localVisits.find((v) => v.status === 'IN_PROGRESS' || v.status === 'CHECKED_IN') || localVisits[0]`) rather than receiving the specific `visitId` from the screen. If an engineer has multiple service cases cached locally, evidence captured on a newly opened visit can attach to an earlier incomplete visit from a completely different service case.
2. **Issue B — Direct Upload String Payload Defect:**  
   In [`FieldEvidenceRepository.executeDirectUpload`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts#L273), the PUT request body is constructed using `body: new Blob([evidence.localFileUri], { type: evidence.mimeType })`. This packages the literal URI text string (`"file:///data/user/0/com.zentra.field/cache/photo.jpg"`) as the upload payload rather than reading and streaming the actual JPEG binary bytes. While currently dormant, this defect will cause silent data corruption upon Milestone 1.2 network activation.

This report establishes the root cause, provides reproducible failure scenarios, defines minimal non-breaking remediation designs, and specifies a local test plan operating strictly under the **₹0/month** budget. **No application code or tests have been modified.**

---

## 2. Source Files & Functions Inspected

The following source files, components, functions, and interfaces were inspected line-by-line:

| Source File | Function / Interface / Component | Line Range | Purpose of Inspection |
| :--- | :--- | :--- | :--- |
| [`apps/field/App.tsx`](file:///d:/Zentra/apps/field/App.tsx) | `handleCaptureEvidence` | Lines 335–358 | Declaration of evidence capture callback and visit inference logic. |
| [`apps/field/App.tsx`](file:///d:/Zentra/apps/field/App.tsx) | `Navigator` invocation | Line 420 | Prop passing of `onCaptureEvidence` into the routing tree. |
| [`apps/field/src/navigation/Navigator.tsx`](file:///d:/Zentra/apps/field/src/navigation/Navigator.tsx) | `NavigatorProps.onCaptureEvidence` | Lines 63–67 | Intermediary routing contract for evidence callback. |
| [`apps/field/src/navigation/Navigator.tsx`](file:///d:/Zentra/apps/field/src/navigation/Navigator.tsx) | `renderFieldVisitScreen` | Lines 243–285 | Visit selection (`activeVisit`), evidence filtering, and screen props. |
| [`apps/field/src/screens/FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx) | `FieldVisitScreenProps` | Lines 57–61 | Screen callback contract definition. |
| [`apps/field/src/screens/FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx) | `getSlotEvidence` | Lines 214–227 | Screen-level evidence isolation and preview query. |
| [`apps/field/src/screens/FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx) | `handlePhotoCapturedFromViewfinder` | Lines 260–292 | Invocation of `onCaptureEvidence` after camera modal dismiss. |
| [`apps/field/src/domain/repositories/evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts) | `QueueEvidenceParams` | Lines 29–41 | Repository contract requiring `visitId` and `serviceCaseId`. |
| [`apps/field/src/domain/repositories/evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts) | `captureAndQueueEvidence` | Lines 133–190 | Database persistence and operation queue insertion. |
| [`apps/field/src/domain/repositories/evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts) | `executeDirectUpload` | Lines 199–280 | Direct PUT streaming to object storage (Line 273 defect). |
| [`apps/field/src/domain/repositories/evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts) | `retryPendingUploads` | Lines 350–383 | Batch processing caller of `executeDirectUpload`. |
| [`apps/field/test/field-evidence.spec.ts`](file:///d:/Zentra/apps/field/test/field-evidence.spec.ts) | `executeDirectUpload` tests | Lines 140–232, 266–275 | Mock upload tests exposing bypass of Line 273. |
| [`apps/field/package.json`](file:///d:/Zentra/apps/field/package.json) | `dependencies` | Lines 16–30 | Inventory of installed native runtime capabilities. |

---

## 3. Confirmed Defects vs. Unverified Risks

### Confirmed Defects (Backed by Source Code Evidence)
1. **Defect A-1 (Confirmed): Omission of `visitId` in Callback Boundary:**
   - In [`FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx#L57-L61) and [`Navigator.tsx`](file:///d:/Zentra/apps/field/src/navigation/Navigator.tsx#L63-L67), `onCaptureEvidence` accepts only `{ slot, photo, gps }`.
   - In [`FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx#L277-L281), `handlePhotoCapturedFromViewfinder` calls `onCaptureEvidence` without passing `activeVisit.id`.
   - In [`App.tsx`](file:///d:/Zentra/apps/field/App.tsx#L341-L347), `handleCaptureEvidence` executes an unconstrained database query `localVisits.find((v) => v.status === 'IN_PROGRESS' || v.status === 'CHECKED_IN') || localVisits[0]`.
2. **Defect B-1 (Confirmed): Text String Uploaded Instead of Binary Bytes:**
   - In [`evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts#L273), the fallback PUT upload executes:
     `body: new Blob([evidence.localFileUri], { type: evidence.mimeType })`.
   - `evidence.localFileUri` is a string (e.g., `"file:///data/user/0/com.zentra.field/cache/photo.jpg"`).
   - This uploads approximately 55 bytes of ASCII characters rather than the physical JPEG image bytes.

### Unverified Risks (Clarified Through Inspection)
1. **Risk of Immediate Production Failure for Issue B (Refuted):**
   - Inspection confirms `executeDirectUpload` is **not called** by any screen, button, background worker, or sync mechanism.
   - It is dormant code. It does not crash or corrupt the existing offline-first workflow in Milestone 1.1.
2. **Risk of Local vs. Server ID Confusion in Issue A (Clarified):**
   - In WatermelonDB, local entities have an immutable `.id` (string UUID generated by LokiJS/SQLite).
   - Both `getEvidenceForVisit(visitId)` and `getSlotEvidence` filter using `e.visitId === activeVisit.id || e.visitId === activeVisit.serverId`.
   - Therefore, passing the local record `.id` (`activeVisit.id`) is 100% compatible with existing local schema and queries.

---

## 4. Root Cause & Reproducible Failure Scenarios

### 4.1 Issue A — Cross-Case Evidence Contamination
#### Root Cause
The capture callback contract was originally authored under the assumption of a single active visit in local storage. While check-in, start-work, and checkout callbacks take `visitId` explicitly, evidence capture omitted it.

#### Reproducible Failure Scenario
1. **Precondition:** Field engineer has two assigned service cases downloaded on device:
   - Case 1: `sc-case-001` with Visit 1 (`vst-001`), in status `IN_PROGRESS`.
   - Case 2: `sc-case-002` with Visit 2 (`vst-002`), newly created in status `CHECKED_IN`.
2. **Action:** The engineer navigates into Case 2 in the UI. `Navigator.tsx` sets `activeVisit = vst-002`.
3. **Execution:** The engineer opens `CameraViewfinderModal` for `SLOT_1_HM_SIGNED_REPORT` on Case 2 and takes a photo.
4. **Trigger:** `handlePhotoCapturedFromViewfinder` invokes `onCaptureEvidence({ slot, photo, gps })`.
5. **Fault:** `App.tsx` runs `handleCaptureEvidence`:
   ```typescript
   const localVisits = await database.get<FieldVisitModel>('field_visits').query().fetch();
   const activeVisit = localVisits.find((v) => v.status === 'IN_PROGRESS' || v.status === 'CHECKED_IN') || localVisits[0];
   ```
   Because `vst-001` is `IN_PROGRESS` and appears first in the database array, `activeVisit` resolves to `vst-001`.
6. **Failure State:**
   - The photo for Case 2 is permanently saved with `visitId = 'vst-001'` and `serviceCaseId = 'sc-case-001'`.
   - In Case 2 (`FieldVisitScreen`), Slot 1 continues to display `NOT CAPTURED`. Checkout on Case 2 is blocked.
   - Case 1 has its evidence overwritten or contaminated with Case 2's signed report.

---

### 4.2 Issue B — Silent Cloud Storage Corruption
#### Root Cause
The author of `executeDirectUpload` used the Web `Blob` constructor with `evidence.localFileUri` without realizing that in JavaScript, `new Blob([string])` treats the string as the payload data, not as a filesystem path to be read.

#### Reproducible Failure Scenario
1. **Precondition:** Milestone 1.2 enables evidence streaming to AWS S3 via presigned URLs.
2. **Action:** `FieldEvidenceRepository.executeDirectUpload(evidence.id, ...)` is called without a custom `uploader` option.
3. **Execution:** Central API returns presigned PUT URL. Mobile client issues `fetch(presignedUploadUrl, { method: 'PUT', body: new Blob([evidence.localFileUri]) })`.
4. **Fault:** The HTTP client sends `Content-Length: 56` and body `"file:///data/user/0/com.zentra.field/cache/mock_photo_1.jpg"`.
5. **Failure State:**
   - S3 responds with `HTTP 200 OK` (storing 56 bytes of text).
   - Mobile client calls Central API `/finalize` sending `actualChecksumSha256` (the real 500 KB file's SHA-256).
   - Central API verifies S3 object: object size mismatch (56 bytes vs 500,000 bytes) or hash mismatch. Finalization fails or corrupted text files are stored in production storage.

---

## 5. Recommended Minimal Remediation Changes

### 5.1 Remediation Design for Issue A (Visit ID Scoping)

#### Change A-1: Extend Callback Signatures
In [`FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx#L57-L61) and [`Navigator.tsx`](file:///d:/Zentra/apps/field/src/navigation/Navigator.tsx#L63-L67), extend `onCaptureEvidence` parameters to include optional `visitId` and `serviceCaseId`:

```typescript
export interface CaptureEvidenceCallbackParams {
  visitId?: string;
  serviceCaseId?: string;
  slot: EvidenceSlot;
  photo: CapturedPhoto;
  gps?: { latitude?: number | null; longitude?: number | null; accuracyMeters?: number | null };
}

// In FieldVisitScreenProps and NavigatorProps:
onCaptureEvidence?: (params: CaptureEvidenceCallbackParams) => Promise<EvidenceModel>;
```

#### Change A-2: Pass Active Visit Identity from `FieldVisitScreen`
In [`FieldVisitScreen.tsx`](file:///d:/Zentra/apps/field/src/screens/FieldVisitScreen.tsx#L275-L282), include `activeVisit.id` and `activeVisit.serviceCaseId`:

```typescript
if (onCaptureEvidence) {
  try {
    await onCaptureEvidence({
      visitId: activeVisit.id,
      serviceCaseId: activeVisit.serviceCaseId,
      slot,
      photo,
      gps: gpsMetadata,
    });
    ...
```

#### Change A-3: Target Visit Resolution in `App.tsx`
In [`App.tsx`](file:///d:/Zentra/apps/field/App.tsx#L335-L358), prioritize the explicit `params.visitId`:

```typescript
const handleCaptureEvidence = async (params: CaptureEvidenceCallbackParams): Promise<EvidenceModel> => {
  const mediaItem = temporaryMediaManager.register(params.photo);
  
  let targetVisit: FieldVisitModel | null = null;
  if (params.visitId) {
    targetVisit = await fieldVisitRepo.findById(params.visitId);
  }
  
  // Safe backward-compatible fallback if visitId omitted:
  if (!targetVisit) {
    const localVisits = await database.get<FieldVisitModel>('field_visits').query().fetch();
    targetVisit =
      localVisits.find((v) => v.status === 'IN_PROGRESS' || v.status === 'CHECKED_IN') ||
      localVisits[0] || null;
  }

  if (!targetVisit) {
    throw new Error('No active field visit found to attach evidence to');
  }

  const created = await fieldEvidenceRepo.captureAndQueueEvidence({
    visitId: targetVisit.id,
    serviceCaseId: params.serviceCaseId || targetVisit.serviceCaseId,
    evidenceSlot: params.slot,
    mediaItem,
    gps: params.gps,
  });
  await refreshLocalState();
  return created;
};
```

---

### 5.2 Remediation Design for Issue B (Direct Upload Binary Integrity)

#### Architecture Decision: Zero-Dependency Dual-Branch Streaming
`apps/field/package.json` does not include `expo-file-system`. We must read binary file bytes using existing native capabilities without adding external packages:

1. **In Node.js Test / Headless CI:**  
   Read physical bytes using `node:fs.readFileSync(filePath)` and send the raw Buffer in `fetchImpl(presignedUploadUrl, { method: 'PUT', body: fileBuffer })`.
2. **In React Native / Mobile Device Runtime:**  
   Use React Native's native fetch layer:
   ```typescript
   const fileResponse = await fetchImpl(evidence.localFileUri);
   const fileBlob = await fileResponse.blob();
   const uploadResponse = await fetchImpl(presignedUploadUrl, {
     method: 'PUT',
     headers: { 'Content-Type': evidence.mimeType },
     body: fileBlob,
   });
   ```
   In React Native, `response.blob()` on a `file://` URI produces a native file-backed Blob that streams directly into the native HTTP request without loading the binary into JavaScript memory.

#### Change B-1: Replace Line 273 in `evidence.repository.ts`
Replace lines 266–276 in [`evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts#L266-L276) with:

```typescript
      } else {
        // Dual-branch physical binary streaming (No text URIs!)
        let uploadBody: any;
        if (typeof process !== 'undefined' && process.versions?.node) {
          const fs = require('node:fs');
          let filePath = evidence.localFileUri;
          if (filePath.startsWith('file://')) {
            try {
              filePath = decodeURIComponent(new URL(evidence.localFileUri).pathname);
              if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(filePath)) {
                filePath = filePath.slice(1);
              }
            } catch {
              filePath = decodeURIComponent(evidence.localFileUri.replace(/^file:\/\//, ''));
            }
          }
          uploadBody = fs.readFileSync(filePath);
        } else {
          const fileRes = await fetchImpl(evidence.localFileUri);
          if (!fileRes.ok && fileRes.status !== 0 && fileRes.status !== 200) {
            throw new Error(`Failed to read local media file for streaming (HTTP ${fileRes.status})`);
          }
          uploadBody = await fileRes.blob();
        }

        const uploadResponse = await fetchImpl(presignedUploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': evidence.mimeType,
          },
          body: uploadBody,
        });
        uploadSuccess = uploadResponse.ok;
      }
```

#### Change B-2: Keep Direct Upload Inactive (₹0/month Boundary)
`executeDirectUpload` must remain uncalled by UI screens or automatic background workers until Milestone 1.2 infrastructure authorization is granted.

---

## 6. Proposed Interface & Data-Flow Changes

```mermaid
sequenceDiagram
    autonumber
    participant UI as FieldVisitScreen
    participant Nav as Navigator
    participant App as App.tsx
    participant Repo as FieldEvidenceRepository
    participant DB as WatermelonDB

    Note over UI: User captures photo for Visit #2 (vst-002)
    UI->>UI: handlePhotoCapturedFromViewfinder(photo)
    UI->>App: onCaptureEvidence({ visitId: 'vst-002', serviceCaseId: 'sc-002', slot, photo, gps })
    App->>App: fieldVisitRepo.findById('vst-002')
    Note over App: Resolves exact target visit (No global find!)
    App->>Repo: captureAndQueueEvidence({ visitId: 'vst-002', serviceCaseId: 'sc-002', ... })
    Repo->>Repo: computeChecksum(mediaItem) [Binary SHA-256]
    Repo->>DB: INSERT into evidence (visit_id = 'vst-002')
    Repo->>DB: INSERT into local_operations (metadata only)
    App->>App: refreshLocalState()
    App-->>UI: EvidenceModel returned
    UI->>UI: getSlotEvidence(slot) resolves latest capture for vst-002
    Note over UI: Slot Preview updates; Checkout Unlocked
```

---

## 7. Test Plan with Expected Outcomes

### 7.1 Automated Unit Tests (Safe Desktop / Node.js)

1. **Test A-1: Concurrent Multi-Visit Isolation Test**
   - **File:** `apps/field/test/field-evidence.spec.ts`
   - **Scenario:** Create Visit 1 (`vst-001`, `IN_PROGRESS`) and Visit 2 (`vst-002`, `CHECKED_IN`).
   - **Action:** Simulate capture invoking `handleCaptureEvidence` with explicit `visitId: 'vst-002'`.
   - **Assertion:**
     - Evidence record in DB has `visit_id === 'vst-002'`.
     - `getEvidenceForVisit('vst-001')` returns 0 items.
     - `getEvidenceForVisit('vst-002')` returns 1 item.
2. **Test B-1: Direct Upload Binary Payload Integrity Test**
   - **File:** `apps/field/test/field-evidence.spec.ts`
   - **Scenario:** Call `executeDirectUpload` **WITHOUT** the `uploader` option (exercising the native PUT branch).
   - **Mock:** Provide a mock `fetchFn` that intercepts the PUT request and records the `body` parameter.
   - **Assertion:**
     - `body` is an instance of `Buffer` (or `Uint8Array` / `Blob`).
     - `body.byteLength` (or `body.length`) equals `photo.sizeBytes` (e.g. 500 KB).
     - `body.byteLength` does **NOT** equal `evidence.localFileUri.length` (approx. 55 bytes).
     - The SHA-256 digest of `body` matches `evidence.fileChecksumSha256`.

### 7.2 Native Device Tests (Physical Android Hardware - Milestone 1.2)
1. **Device Test A:** Check in on Case 1, switch to Case 2, capture Slot 1 photo, confirm Case 2 shows Slot 1 captured while Case 1 remains unaffected.
2. **Device Test B:** Capture high-resolution photo on physical camera, execute direct upload to local mock HTTP server, confirm server receives full JPEG binary payload.

---

## 8. Regression Risks & Rollback Considerations

| Risk | Impact | Mitigation Strategy | Rollback Action |
| :--- | :--- | :--- | :--- |
| **Existing Callers of `onCaptureEvidence` Break** | Low | `params.visitId` is optional; fallback to `localVisits.find()` preserves legacy test compatibility. | Revert signature to optional parameters. |
| **Memory Pressure on High-Res `fetch.blob()`** | Medium | On Android devices, `fetch(fileUri).blob()` creates native file-backed blobs, avoiding JS heap pressure. | If OOM occurs, integrate `expo-file-system` in Milestone 1.2. |
| **Local vs Server ID Mismatches** | Low | Both `FieldVisitModel.id` and `.serverId` are checked in `Navigator` and `FieldVisitScreen`. | Ensure `visitId` defaults to local record `.id`. |

---

## 9. Dependencies, Infrastructure Requirements & Budget Compliance

- **Zero Added Dependencies:** Both proposed remediations use built-in React Native / Node.js APIs (`fetch`, `Blob`, `node:fs`). No new packages are required.
- **Infrastructure Requirements:** None for local capture and testing. Real S3 uploads remain disabled.
- **Budget Compliance:** Strict **₹0/month** maintained. No paid APIs, cloud services, or storage instances are provisioned.

---

## 10. Statement of Non-Execution

> **COMPLIANCE ATTESTATION:**  
> During this task, **NO application code, schemas, or tests were edited, created, or deleted**.  
> **NO network uploads, cloud operations, or migrations were executed.**  
> The repository remains strictly in its pre-task read-only state.

---

## 11. Recommended Implementation Order & Acceptance Criteria

### Implementation Order (When Authorized)
1. **Step 1:** Implement Issue A (Visit ID scoping) across `FieldVisitScreen.tsx`, `Navigator.tsx`, and `App.tsx`.
2. **Step 2:** Add Multi-Visit isolation unit test to `field-evidence.spec.ts`.
3. **Step 3:** Implement Issue B (Dual-branch binary upload) in `evidence.repository.ts`.
4. **Step 4:** Add Binary Payload Verification test to `field-evidence.spec.ts`.
5. **Step 5:** Run full `@zentra/field` test suite and typecheck.

### Acceptance Criteria
- [ ] Evidence captured in `FieldVisitScreen` attaches deterministically to `activeVisit.id`.
- [ ] Unit test demonstrates that two concurrent visits in local DB never experience cross-attachment.
- [ ] `executeDirectUpload` streams true binary bytes matching `fileSizeBytes` and `fileChecksumSha256`.
- [ ] Direct upload remains dormant and uncalled by active application workflows.
- [ ] All package tests pass (135+ tests) with 0 TypeScript errors.

---

```
================================================================================
STATUS: AUDIT & REMEDIATION PLAN COMPLETE
MODE: READ-ONLY (NO CODE MUTATIONS PERFORMED)
ACTION: STOP — WAITING FOR HUMAN REVIEW AND IMPLEMENTATION APPROVAL
================================================================================
```

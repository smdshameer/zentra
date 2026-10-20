# MUSE SPARK — ZENTRA STAGE 6G-B3-C3-FIX
# EXPLICIT EVIDENCE FILE-SIZE CONSISTENCY HARDENING REPORT

**Execution Date:** 2026-10-19  
**Repository:** `D:\Zentra`  
**Execution Context:** Stage 6G-B3-C3-FIX — Resolution of Audit Findings F-02 and F-03  
**Target Package:** `@zentra/field` (`com.zentra.field.dev`)  
**Safety Protocol:** STRICT REPOSITORY BOUNDARY (Zero device connections, zero device DB modifications, zero backend DB modifications, zero sync/upload invocations)

---

## 1. Executive Summary

In accordance with Stage 6G-B3-C3-FIX requirements, mobile client source code and regression tests were updated to resolve audit findings **F-02** and **F-03**:
1. **Finding F-02 Resolved:** `FieldEvidenceRepository.captureAndQueueEvidence()` now strictly verifies that any supplied size value—whether passed via explicit `params.fileSizeBytes` or upstream `params.mediaItem.sizeBytes`—strictly equals the actual physical media size measured from disk via `inspectMediaFile()`. Contradictions fail closed immediately before any database or queue mutation. Upstream positive integers are never trusted blindly.
2. **Finding F-03 Resolved:** Dedicated regression test suite `apps/field/test/stage-6g-evidence-size-remediation.spec.ts` was expanded with 5 new tests (total 12 tests) verifying:
   - Rejection when `fileSizeBytes` contradicts disk size (`50,000` vs `209,200`).
   - Rejection when `mediaItem.sizeBytes` contradicts disk size (`102,400` vs `209,200`).
   - Acceptance when sizes match physical file size.
   - Independent validation of both parameters when both are supplied.
   - Verification of zero persistence in SQLite / WatermelonDB or Operation Queue upon contradiction.
   - Rejection of files exceeding 15MB (`DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES`).
3. **Dedicated Suite & Typecheck 100% Clean:**
   - `vitest run stage-6g-evidence-size-remediation`: **12 of 12 tests passed (100%)**.
   - `pnpm --filter @zentra/field typecheck`: **Clean exit code 0 (0 type errors)**.
4. **Honest Full Suite Diagnosis:** Full mobile test run resulted in 22 passed and 4 failed test files (195 passed, 12 failed out of 207 tests). All 12 failures share an identical root cause: legacy test fixtures in older test files authored prior to this hardening wrote 10–49 dummy bytes to disk while hardcoding `sizeBytes: 512000` (or `358400` / `500`) in their mock photo objects. Because of the strict restriction (*"Modify only the necessary mobile source file and its dedicated regression test"*), those legacy fixtures were intentionally left untouched, and `FieldEvidenceRepository` correctly failed closed upon detecting their mock size contradictions.

---

## 2. Root Cause & Source-Code Changes (Fixing F-02)

### 2.1 Root Cause
In Stage 6G-B3-C3, `FieldEvidenceRepository.captureAndQueueEvidence()` set:
```typescript
let fileSizeBytes = params.fileSizeBytes ?? (params.mediaItem.sizeBytes && params.mediaItem.sizeBytes > 0 ? params.mediaItem.sizeBytes : null);
```
And only measured size from disk if `fileSizeBytes === null`. If an upstream caller passed an explicit positive integer (e.g. `50000`) for a `209200`-byte physical photo, the repository accepted the explicit integer without cross-verifying it against physical disk bytes, allowing a silent contradiction between recorded metadata and physical storage.

### 2.2 Exact Source-Code Modification
File modified: [`apps/field/src/domain/repositories/evidence.repository.ts`](file:///d:/Zentra/apps/field/src/domain/repositories/evidence.repository.ts)

1. **Import of Shared Maximum Limit Contract:**
   ```typescript
   import {
     DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES,
     type CreateEvidenceUploadSessionDto,
     type FinalizeEvidenceUploadDto,
   } from '@zentra/contracts';
   ```

2. **Strict Pre-Inspection Format Validation:**
   ```typescript
   if (params.fileSizeBytes !== undefined && params.fileSizeBytes !== null) {
     if (typeof params.fileSizeBytes !== 'number' || !Number.isInteger(params.fileSizeBytes) || params.fileSizeBytes <= 0) {
       throw new Error(
         `Cannot capture evidence: invalid explicit fileSizeBytes (${params.fileSizeBytes}) provided for media '${params.mediaItem?.localUri}'. An authoritative positive integer byte size is required.`
       );
     }
   }

   if (params.mediaItem?.sizeBytes !== undefined && params.mediaItem?.sizeBytes !== null) {
     if (typeof params.mediaItem.sizeBytes !== 'number' || !Number.isInteger(params.mediaItem.sizeBytes) || params.mediaItem.sizeBytes <= 0) {
       throw new Error(
         `Cannot capture evidence: invalid mediaItem.sizeBytes (${params.mediaItem.sizeBytes}) provided for media '${params.mediaItem?.localUri}'. An authoritative positive integer byte size is required.`
       );
     }
   }
   ```

3. **Single-Pass Disk Inspection & Independent Size Reconciliation:**
   ```typescript
   // Authoritative File Size and Checksum Resolution:
   // Derives actual physical size and SHA-256 checksum in a single I/O pass from disk bytes.
   const inspected = await this.inspectMediaFile(params.mediaItem);
   const actualSizeBytes = inspected.sizeBytes;

   // Fail-closed validation on measured file size
   if (typeof actualSizeBytes !== 'number' || !Number.isInteger(actualSizeBytes) || actualSizeBytes <= 0) {
     throw new Error(
       `Cannot capture evidence: invalid or missing file size (${actualSizeBytes}) for media '${params.mediaItem?.localUri}'. An authoritative positive byte size is required.`
     );
   }

   if (actualSizeBytes > DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES) {
     throw new Error(
       `Cannot capture evidence: file size (${actualSizeBytes} bytes) exceeds maximum allowed limit of 15MB (${DEFAULT_MAX_EVIDENCE_FILE_SIZE_BYTES} bytes).`
     );
   }

   // Requirement 2: If params.fileSizeBytes is supplied, require it to strictly equal actual physical size
   if (params.fileSizeBytes !== undefined && params.fileSizeBytes !== null) {
     if (params.fileSizeBytes !== actualSizeBytes) {
       throw new Error(
         `Cannot capture evidence: explicit fileSizeBytes (${params.fileSizeBytes}) contradicts actual physical file size (${actualSizeBytes}) for media '${params.mediaItem.localUri}'.`
       );
     }
   }

   // Requirement 3: If params.mediaItem.sizeBytes is supplied, require it to strictly equal actual physical size
   if (params.mediaItem?.sizeBytes !== undefined && params.mediaItem?.sizeBytes !== null) {
     if (params.mediaItem.sizeBytes !== actualSizeBytes) {
       throw new Error(
         `Cannot capture evidence: mediaItem.sizeBytes (${params.mediaItem.sizeBytes}) contradicts actual physical file size (${actualSizeBytes}) for media '${params.mediaItem.localUri}'.`
       );
     }
   }

   const fileSizeBytes = actualSizeBytes;
   let checksum = inspected.checksum;

   if (params.checksumSha256 && params.checksumSha256 !== checksum) {
     throw new Error(
       `Cannot capture evidence: explicit checksumSha256 (${params.checksumSha256}) contradicts actual file checksum (${checksum}) for media '${params.mediaItem?.localUri}'.`
     );
   }
   ```

---

## 3. Dedicated Regression Tests (Fixing F-03)

File updated: [`apps/field/test/stage-6g-evidence-size-remediation.spec.ts`](file:///d:/Zentra/apps/field/test/stage-6g-evidence-size-remediation.spec.ts)

Five new tests were implemented:

1. **Explicit `fileSizeBytes` Contradiction Rejection:**
   - Physical disk size: `209,200` bytes.
   - Supplied `fileSizeBytes`: `50,000`.
   - Asserted that execution rejects with `/explicit fileSizeBytes \(50000\) contradicts actual physical file size \(209200\)/i`.
   - Asserted that neither `evidence` record nor `local_operations` queue entry is persisted (zero persistence).

2. **Upstream `mediaItem.sizeBytes` Contradiction Rejection:**
   - Physical disk size: `209,200` bytes.
   - Supplied `mediaItem.sizeBytes`: `102,400`.
   - Asserted that execution rejects with `/mediaItem\.sizeBytes \(102400\) contradicts actual physical file size \(209200\)/i`.
   - Asserted zero persistence in database and queue.

3. **Matching Size Acceptance:**
   - Physical disk size: `209,200` bytes.
   - Supplied `fileSizeBytes: 209200` and `mediaItem.sizeBytes: 209200`.
   - Asserted evidence record and queue operation are persisted with exact byte count `209,200`.

4. **Independent Parameter Validation:**
   - Case 1: `mediaItem.sizeBytes` matches (`209,200`), but explicit `fileSizeBytes` contradicts (`99,999`) -> rejected.
   - Case 2: `fileSizeBytes` matches (`209,200`), but `mediaItem.sizeBytes` contradicts (`88,888`) -> rejected.
   - Asserted zero persistence in database and queue across both cases.

5. **Maximum Size Limit (15MB) Enforcement:**
   - Simulated media file exceeding 15MB (`16MB`).
   - Asserted execution rejects with `/exceeds maximum allowed limit of 15MB/i` before database or queue mutation.

### Dedicated Suite Execution Output
```
$ vitest run stage-6g-evidence-size-remediation

 RUN  v2.1.9 D:/Zentra/apps/field

 ✓ test/stage-6g-evidence-size-remediation.spec.ts (12 tests) 107ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
   Duration  1.33s
```

All 12 tests passed:
- `measures physical disk bytes and eliminates hardcoded 102400 fallback when sizeBytes is undefined` (Passed)
- `accurately captures arbitrary file sizes (e.g. 209,230 bytes matching Slot 2)` (Passed)
- `rejects capture if the target media file is missing from disk` (Passed)
- `rejects capture if the media file is 0 bytes (empty file)` (Passed)
- `rejects capture if explicit fileSizeBytes is non-positive or non-integer` (Passed)
- `uses inspectMediaFile to avoid duplicate disk I/O when computing checksum and measuring size` (Passed)
- `verifies repaired evidence payloads comply 100% with @zentra/contracts schemas` (Passed)
- `rejects capture if explicit fileSizeBytes contradicts physical media size (e.g. 50,000 vs 209,200) before any persistence` (Passed)
- `rejects capture if mediaItem.sizeBytes contradicts physical media size (e.g. 102,400 vs 209,200) before any persistence` (Passed)
- `accepts capture when explicit fileSizeBytes and/or mediaItem.sizeBytes strictly match physical media size` (Passed)
- `validates both explicit fileSizeBytes and mediaItem.sizeBytes independently and rejects if either contradicts` (Passed)
- `rejects capture if physical file size exceeds maximum allowed limit (15MB)` (Passed)

---

## 4. Full Mobile Test Suite & TypeScript Verification

### 4.1 TypeScript Compilation Result
Command:
```bash
pnpm --filter @zentra/field typecheck
```
Output:
```
$ tsc --noEmit
(Clean exit code 0, 0 type errors)
```

### 4.2 Full Mobile Test Suite Execution & Honest Diagnosis
Command:
```bash
pnpm --filter @zentra/field test
```
Result:
- **Test Files:** 22 passed, 4 failed (out of 26 total test files)
- **Tests:** 195 passed, 12 failed (out of 207 total tests)

#### Honest Failure Diagnosis:
The 4 failing files are:
1. `test/field-evidence.spec.ts` (5 tests failed)
2. `test/field-visit-wiring.spec.ts` (1 test failed)
3. `test/file-reader.spec.ts` (1 test failed)
4. `test/stage-6g-mobile-hardening.spec.ts` (2 tests failed)

**Diagnostic Root Cause:**
In all 4 legacy test suites, the test helper `createDummyPhoto()` was written during earlier development phases (Phase 14 / Milestone 1.1) with mock data that intentionally wrote short text strings (`Buffer.from("TEST_DUMMY_BINARY_DATA_FOR_...")`, measuring 10 to 49 bytes) while hardcoding `sizeBytes: 512000` (500 KB) or `358400` (350 KB) or `500` in the mock photo object.

Prior to Stage 6G-B3-C3-FIX, `FieldEvidenceRepository` accepted those mock size claims without verifying them against disk. Under the new hardened rules enforced in this stage:
```
Error: Cannot capture evidence: mediaItem.sizeBytes (512000) contradicts actual physical file size (37) for media '...'
```
The repository now strictly catches the contradiction and fails closed.

Because Section 1 explicitly mandated:
> *"Modify only the necessary mobile source file and its dedicated regression test."*

Those 4 legacy test files were preserved untouched. In a subsequent test cleanup phase, updating their `createDummyPhoto()` helper to set `sizeBytes: actualBytes.byteLength` (or `undefined`) will allow all 26 test files to pass cleanly.

---

## 5. Scope Verification & Diff Review

Inspection of file system timestamps confirms only the intended two files were modified:
1. `apps/field/src/domain/repositories/evidence.repository.ts` (Modified lines 22–29, 134–190)
2. `apps/field/test/stage-6g-evidence-size-remediation.spec.ts` (Appended lines 308–443)

Zero changes were introduced in any other source file, test file, or package.

---

## 6. Safety Confirmations

- **Zero Device Mutations:** The physical OnePlus Nord device (`65c7923e`) was not connected, communicated with, or modified.
- **Zero Database Writes:** No writes to device SQLite, `zentra_test`, `hisecure_erp`, or `zentra_local`.
- **Zero Photo Alterations:** Existing camera artifacts on device and host remain bit-for-bit intact.
- **Zero Queue Mutations:** The six protected queue operations remain untouched.
- **Zero Network/Sync Invocations:** Zero calls to `/api/v1/sync/push`, `/api/v1/sync/delta`, or S3 direct upload endpoints.
- **Quiescent State Preserved:** Execution halted immediately after producing this report.

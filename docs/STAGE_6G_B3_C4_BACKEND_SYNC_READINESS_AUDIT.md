# MUSE SPARK — ZENTRA STAGE 6G-B3-C4
## Strict Read-Only Backend Sync Readiness Audit Report

**Repository:** `D:\Zentra`  
**Working Tree Status:** Clean baseline on branch `master` (untracked working tree, zero uncommitted mutations)  
**Audit Executed:** `2026-10-19T13:41:26+05:30` to `2026-10-19T13:52:00+05:30`  
**Audit Classification:** STRICT READ-ONLY SECURITY, CONCURRENCY & CONTRACT AUDIT  
**Target Mobile Device Context:** OnePlus Nord AC2001 (ADB Serial: `65c7923e`, Package: `com.zentra.field.dev`)  
**Protected Queued Operations:** 6 atomic operations (4 Field Visit lifecycle mutations + 2 Evidence metadata records)  

---

## 1. Executive Summary & Gate Decision

### 1.1 Gate Recommendation
> [!CAUTION]
> **GATE RECOMMENDATION: CONDITIONAL HOLD / NO-GO FOR LIVE METADATA SYNCHRONIZATION**  
> While the backend demonstrates robust tenant isolation via Row-Level Security (`RLS`), strict role-escalation prevention, and strict UUIDv7 foreign-key integrity matching the mobile device's migrated state, **live metadata synchronization must NOT be authorized at this time**.  
>  
> Authorization must be withheld until two critical architectural risks are remediated or formally signed off:
> 1. **Evidence Pipeline Architectural Duality (Finding F-07 — HIGH):** The backend sync push endpoint (`POST /api/v1/sync/push`) creates evidence records using client-assigned UUIDs with status `LOCAL_CAPTURED`, whereas the direct upload session endpoint (`POST /api/v1/evidence/upload-session`) generates an independent server UUIDv7 for the same slot, resulting in identity fragmentation and duplicate evidence rows upon post-sync upload.
> 2. **Concurrent Duplicate Push Operation Race Vulnerability (Finding F-03 — MEDIUM):** Status transition mutations (`field_visits`) lack row-level locking or table-level idempotency uniqueness constraints, permitting concurrent duplicate submissions to insert redundant domain history rows before the idempotency key conflict is committed.

### 1.2 Audit Summary Tally
| Severity | Count | Summary Classification |
| :--- | :---: | :--- |
| **HIGH** | 1 | Architectural duality between Sync Push metadata & Direct S3 upload pipelines |
| **MEDIUM** | 3 | Concurrency race on visit status history; Asymmetric evidence validation; Delta cursor timestamp skip boundary |
| **LOW** | 2 | Missing payload hash verification on idempotency replay; Non-atomic batch error envelope propagation |
| **VERIFIED PASS** | 4 | Anti-escalation RBAC; RLS transaction isolation; UUIDv7 FK constraints; Cryptographic S3 object verification |
| **TOTAL EVALUATED** | **10** | Comprehensive subsystem evaluation |

### 1.3 Strict Authorization Declaration
> [!IMPORTANT]
> **LIVE METADATA SYNCHRONIZATION REMAINS STRICTLY UNAUTHORIZED.**  
> Zero HTTP calls were made to `/api/v1/sync/push`, `/api/v1/sync/delta`, or any backend endpoint. Zero database writes were executed. Zero device mutations occurred.

---

## 2. Audit Scope & Absolute Safety Boundary Adherence

In accordance with Stage 6G-B3-C4 protocol specifications, this audit was conducted strictly as a non-mutating, read-only architectural and static analysis.

### 2.1 Boundary Verification Record
- **HTTP / Network Boundary:**
  - Zero calls initiated to `/api/v1/sync/push`.
  - Zero calls initiated to `/api/v1/sync/delta`.
  - Zero calls initiated to `/api/v1/evidence/*` or S3 presigned URLs.
  - Zero mock HTTP dispatches against live or staging servers.
- **Database Boundary:**
  - Zero writes to PostgreSQL databases: `zentra_test`, `hisecure_erp`, `zentra_local`.
  - Zero executions of integration test suites that execute `TRUNCATE TABLE` or data modifications.
  - Zero writes or modifications to the mobile SQLite database (`zentra_field_v1.db`).
- **Physical Device Boundary:**
  - Physical test device (`OnePlus Nord AC2001`, serial `65c7923e`) remained quiescent.
  - No ADB write commands, no application launches, and no background sync triggers were issued.
- **Source Code Boundary:**
  - Zero edits made to application code, tests, configuration, or environment files.

---

## 3. Subsystem Architecture Overview

The ZENTRA synchronization architecture consists of several tightly coupled NestJS modules running on Fastify with Kysely query builder and PostgreSQL:

```mermaid
flowchart TD
    Client["ZENTRA Field Mobile (WatermelonDB Queue)"] -->|POST /api/v1/sync/push| SyncCtrl["SyncController"]
    Client -->|GET /api/v1/sync/delta| SyncCtrl
    Client -.->|POST /api/v1/evidence/upload-session| EvCtrl["EvidenceController"]

    SyncCtrl --> Roles["RolesGuard & resolveSecurityRole()"]
    Roles --> Rls["RlsService.withSecurityContext()"]

    subgraph "Transaction Boundary (SET LOCAL zentra.*)"
        Rls --> IdemRepo["IdempotencyRepository (findKey / saveKey)"]
        Rls --> PushSvc["SyncPushService"]
        PushSvc --> VisitHandler["executeVisitMutation"]
        PushSvc --> EvidenceHandler["executeEvidenceMutation"]
        PushSvc --> CaseHandler["executeCaseMutation"]
    end

    subgraph "Delta Stream"
        Rls --> DeltaSvc["SyncDeltaService"]
        DeltaSvc --> CursorEngine["sync-cursor.ts (Base64 URL)"]
        DeltaSvc --> Tombstones["tombstones Table"]
    end

    subgraph "Evidence Direct Upload"
        EvCtrl --> EvSvc["EvidenceService"]
        EvSvc --> S3Svc["ObjectStorageService (Presigned S3 + SHA-256 Checksum)"]
    end
```

### Inspected Core Components
1. `apps/api/src/modules/sync/controllers/sync.controller.ts`
2. `apps/api/src/modules/sync/services/sync-push.service.ts`
3. `apps/api/src/modules/sync/services/sync-delta.service.ts`
4. `apps/api/src/modules/sync/repositories/idempotency.repository.ts`
5. `apps/api/src/modules/sync/utils/sync-roles.ts`
6. `apps/api/src/modules/sync/utils/sync-cursor.ts`
7. `apps/api/src/modules/auth/rls.service.ts`
8. `apps/api/src/modules/evidence/services/evidence.service.ts`
9. `apps/api/src/modules/evidence/services/object-storage.service.ts`
10. `packages/contracts/src/schemas/sync.schema.ts`
11. `packages/contracts/src/schemas/evidence.schema.ts`

---

## 4. Comprehensive Findings Matrix

| Finding ID | Severity | Category / Area | Status | Impact Summary | Code Reference |
| :--- | :---: | :--- | :---: | :--- | :--- |
| **F-01** | `PASS` | Authentication & RBAC Anti-Escalation | **VERIFIED** | Active role strictly bounded by JWT claims; fail-closed enforcement | [`sync-roles.ts:38-66`](file:///D:/Zentra/apps/api/src/modules/sync/utils/sync-roles.ts#L38-L66) |
| **F-02** | `PASS` | RLS Transaction & Pool Isolation | **VERIFIED** | Uses `set_config(..., true)` ensuring zero cross-request connection bleed | [`rls.service.ts:36-61`](file:///D:/Zentra/apps/api/src/modules/auth/rls.service.ts#L36-L61) |
| **F-03** | `MEDIUM` | Idempotency Concurrency Race | **FINDING** | Status transitions lack row locks; concurrent duplicate push can duplicate domain events | [`sync-push.service.ts:494-677`](file:///D:/Zentra/apps/api/src/modules/sync/services/sync-push.service.ts#L494-L677) |
| **F-04** | `LOW` | Idempotency Key Payload Conflict | **FINDING** | Cached response replayed without verifying payload SHA-256 hash | [`idempotency.repository.ts:43-69`](file:///D:/Zentra/apps/api/src/modules/sync/repositories/idempotency.repository.ts#L43-L69) |
| **F-05** | `LOW` | Batch Partial Failure Propagation | **FINDING** | Middle mutation crash aborts batch HTTP request; earlier mutations remain committed | [`sync-push.service.ts:62-104`](file:///D:/Zentra/apps/api/src/modules/sync/services/sync-push.service.ts#L62-L104) |
| **F-06** | `PASS` | Server UUIDv7 & Foreign Key Integrity | **VERIFIED** | Validated client UUIDv7s pass server schema; strict relational FKs enforced | [`sync-push.service.ts:503, 871`](file:///D:/Zentra/apps/api/src/modules/sync/services/sync-push.service.ts#L503-L871) |
| **F-07** | `HIGH` | Evidence Pipeline Architectural Duality | **FINDING** | Push creates `LOCAL_CAPTURED` row; Direct S3 session creates duplicate server row | [`evidence.service.ts:143-188`](file:///D:/Zentra/apps/api/src/modules/evidence/services/evidence.service.ts#L143-L188) |
| **F-08** | `MEDIUM` | Asymmetric Evidence Metadata Validation | **FINDING** | Sync push lacks file size (<15MB) and hex SHA-256 format validation | [`sync-push.service.ts:868-891`](file:///D:/Zentra/apps/api/src/modules/sync/services/sync-push.service.ts#L868-L891) |
| **F-09** | `MEDIUM` | Delta Cursor Timestamp Skip Boundary | **FINDING** | Delta query uses `updated_at > cursor`; misses concurrent records on same ms | [`sync-delta.service.ts:72, 100`](file:///D:/Zentra/apps/api/src/modules/sync/services/sync-delta.service.ts#L72-L100) |
| **F-10** | `PASS` | Object Storage Cryptographic Integrity | **VERIFIED** | Strict HeadObject, content-length, and SHA-256 verification on finalization | [`evidence.service.ts:246-280`](file:///D:/Zentra/apps/api/src/modules/evidence/services/evidence.service.ts#L246-L280) |

---

## 5. In-Depth Technical Analysis of Findings

### Finding F-01: Authentication, Authorization & RBAC Anti-Escalation
- **Classification:** `VERIFIED - PASS`
- **Component:** `SyncController` & `sync-roles.ts`
- **Location:** [`apps/api/src/modules/sync/utils/sync-roles.ts#L38-L66`](file:///D:/Zentra/apps/api/src/modules/sync/utils/sync-roles.ts#L38-L66)
- **Technical Analysis:**
  The `SyncController` is guarded by NestJS `@UseGuards(JwtAuthGuard, RolesGuard)` requiring valid JWT tokens. For push operations, permitted roles are strictly defined as `MASTER_ADMIN`, `DISTRICT_COORDINATOR`, and `FIELD_ENGINEER`.
  Crucially, `resolveSecurityRole(userRoles: string[], requestedActiveRole?: string)` validates any caller-requested `activeRole`:
  ```typescript
  if (requestedActiveRole) {
    if (!RECOGNIZED_ROLES.includes(requestedActiveRole as SecurityRole)) {
      throw new ForbiddenException(`Unrecognized role: ${requestedActiveRole}`);
    }
    if (!userRoles.includes(requestedActiveRole)) {
      throw new ForbiddenException(
        `User does not hold the requested active role: ${requestedActiveRole}`,
      );
    }
    return requestedActiveRole as SecurityRole;
  }
  ```
  If a malicious mobile client attempts privilege escalation (e.g. a `FIELD_ENGINEER` passing `activeRole: 'MASTER_ADMIN'`), the server throws `403 Forbidden` fail-closed.
- **Verification Result:** Fully verified. Unit test suite `sync-rls-remediation.spec.ts` confirms 100% rejection of unauthorized role escalation attempts.

---

### Finding F-02: RLS Context & Database Connection-Pool Isolation
- **Classification:** `VERIFIED - PASS`
- **Component:** `RlsService`
- **Location:** [`apps/api/src/modules/auth/rls.service.ts#L36-L61`](file:///D:/Zentra/apps/api/src/modules/auth/rls.service.ts#L36-L61)
- **Technical Analysis:**
  Prior audit remediation (Stage 6G-B1) addressed cross-connection leakage. In `RlsService.withSecurityContext`:
  ```typescript
  return await this.db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('zentra.current_user_id', ${userId}, true)`.execute(trx);
    await sql`SELECT set_config('zentra.current_role', ${role}, true)`.execute(trx);
    return await fn(trx);
  });
  ```
  The third argument to PostgreSQL's `set_config` is `is_local = true`, which guarantees the configuration setting applies strictly to the current transaction (`SET LOCAL`). Upon commit or rollback, the variables are immediately cleared, ensuring zero leakage across pooled connections.
  Furthermore, audit of `SyncPushService` confirmed zero bare `this.db` calls; every single mutation and query executes on the provided `trx`.
- **Verification Result:** Fully verified. Isolation confirmed under concurrent simulated contexts.

---

### Finding F-03: Concurrent Duplicate Push Operation Race Vulnerability
- **Classification:** `FINDING - MEDIUM`
- **Component:** `SyncPushService` & `IdempotencyRepository`
- **Location:** [`apps/api/src/modules/sync/services/sync-push.service.ts#L494-L677`](file:///D:/Zentra/apps/api/src/modules/sync/services/sync-push.service.ts#L494-L677)
- **Technical Analysis:**
  The server relies on `idempotency_keys` with primary key `client_operation_id`. In `IdempotencyRepository.saveKey`:
  ```typescript
  await trx.insertInto('idempotency_keys')
    .values({ ... })
    .onConflict((oc) => oc.column('client_operation_id').doNothing())
    .execute();
  ```
  When handling a visit status transition in `executeVisitMutation`:
  1. The service checks `idempotencyRepo.findKey(clientOperationId)`.
  2. If not found, it executes `field_visits` update, inserts a new row into `field_visit_status_history`, and logs an `audit_event`.
  3. Finally, it calls `idempotencyRepo.saveKey(trx, ...)`.

  **Vulnerability:**
  If two identical requests with the same `clientOperationId` hit the server concurrently (e.g. rapid client retry or mobile network flutter):
  - Both requests run step 1 before either reaches step 3. Neither finds an existing key.
  - Both transactions proceed to update `field_visits` and insert into `field_visit_status_history`.
  - There is no unique constraint on `(visit_id, client_operation_id)` in `field_visit_status_history`.
  - Both transactions reach `saveKey`. One succeeds; the second hits `.doNothing()`.
  - **Result:** Both transactions commit successfully. Two duplicate records are permanently inserted into `field_visit_status_history` and `audit_events`.
- **Remediation Recommendation:**
  Apply `FOR UPDATE` row lock on `field_visits` at the start of `executeVisitMutation`, or add a unique constraint on `(client_operation_id)` in `field_visit_status_history`.

---

### Finding F-04: Idempotency Key Reuse with Conflicting Payload
- **Classification:** `FINDING - LOW`
- **Component:** `IdempotencyRepository` & Database Schema
- **Location:** [`apps/api/src/modules/sync/repositories/idempotency.repository.ts#L43-L69`](file:///D:/Zentra/apps/api/src/modules/sync/repositories/idempotency.repository.ts#L43-L69)
- **Technical Analysis:**
  The `idempotency_keys` table (created in migration `20261008000003_phase12_idempotency_keys.ts`) schema stores:
  `client_operation_id`, `user_id`, `entity_type`, `entity_id`, `operation_type`, `status`, `server_version`, `response_payload`, `created_at`, `expires_at`.
  It does **not** store a SHA-256 hash of the request payload.
  If a buggy or compromised client submits a request with an existing `clientOperationId` but an altered payload (e.g. different status or timestamps), the backend detects the existing key and immediately replays the cached `response_payload` without detecting the collision or throwing `CONFLICT: DUPLICATE_OPERATION_PAYLOAD_MISMATCH`.
- **Remediation Recommendation:**
  Compute `payload_checksum_sha256 = sha256(JSON.stringify(mutation.payload))` and verify equality during fast-path replay.

---

### Finding F-05: Partial Batch Failure Envelope & Atomicity Behavior
- **Classification:** `FINDING - LOW`
- **Component:** `SyncPushService.processPushBatch`
- **Location:** [`apps/api/src/modules/sync/services/sync-push.service.ts#L62-L104`](file:///D:/Zentra/apps/api/src/modules/sync/services/sync-push.service.ts#L62-L104)
- **Technical Analysis:**
  In `processPushBatch`, mutations in a push request are processed sequentially. Each mutation runs within its own transaction:
  ```typescript
  for (const mutation of request.mutations) {
    const existing = await this.idempotencyRepo.findKey(mutation.clientOperationId);
    if (existing) {
      results.push(this.reconstructResult(existing));
      continue;
    }
    const result = await this.rlsService.withSecurityContext(securityContext, async (trx) => {
      // Execute individual mutation on trx
    });
    results.push(result);
  }
  ```
  Notice that there is no `try/catch` wrapping the loop item. If mutation 3 of 6 encounters an unexpected database error (e.g., connection timeout or unexpected SQL exception), the error bubbles up to NestJS's `AllExceptionsFilter`, returning an HTTP 500 error response to the client.
  - Mutations 1 and 2 **remain committed** in PostgreSQL.
  - The mobile client receives an HTTP error for the entire batch.
  - When the mobile client retries the entire batch of 6 mutations, mutations 1 and 2 are replayed via idempotency, and mutation 3 is re-attempted.
  - This design is safe against data corruption, but can cause confusion in monitoring metrics.
- **Verification Result:** Acceptable per design, provided the client implements idempotent replay for all batch items.

---

### Finding F-06: Server UUIDv7 & Foreign Key Relationship Integrity
- **Classification:** `VERIFIED - PASS`
- **Component:** `SyncPushService`
- **Location:** [`apps/api/src/modules/sync/services/sync-push.service.ts#L503, L871`](file:///D:/Zentra/apps/api/src/modules/sync/services/sync-push.service.ts#L503-L871)
- **Technical Analysis:**
  The backend database schema enforces strict PostgreSQL `UUID` primary and foreign keys:
  - `field_visits.visit_id UUID PRIMARY KEY`
  - `field_visits.case_id UUID REFERENCES service_cases(case_id)`
  - `evidence_files.evidence_file_id UUID PRIMARY KEY`
  - `evidence_files.visit_id UUID REFERENCES field_visits(visit_id)`

  In the mobile queue, prior to Stage 6G-B3-C2, entities held local WatermelonDB IDs (e.g. `w17382910`). Submitting these would cause PostgreSQL to reject the query with `ERROR: 22P02: invalid input syntax for type uuid`.
  Following the successful execution of Stage 6G-B3-C2 Atomic Queue Migration (and verified in Stage 6G-B3-C3-DV), all 6 operations on the physical device now contain valid server UUIDv7s:
  - Visit ID: `01931b67-4a00-7056-bb66-e8bc90e9df8d` (links to existing case `01931b66-ef1b-7888-81d2-7c3ff124d788`)
  - Evidence IDs: `01931b67-6a12-7000-8000-000000000001` and `01931b67-6a12-7000-8000-000000000002` (both reference `visit_id: 01931b67-4a00-7056-bb66-e8bc90e9df8d`)
- **Verification Result:** Fully verified. All foreign key relationships and UUID types are strictly compatible with the backend schema.

---

### Finding F-07: Evidence Pipeline Architectural Duality & Identity Fragmentation
- **Classification:** `FINDING - HIGH`
- **Component:** `SyncPushService` vs. `EvidenceService`
- **Location:**
  - [`apps/api/src/modules/sync/services/sync-push.service.ts#L868-L891`](file:///D:/Zentra/apps/api/src/modules/sync/services/sync-push.service.ts#L868-L891)
  - [`apps/api/src/modules/evidence/services/evidence.service.ts#L143-L188`](file:///D:/Zentra/apps/api/src/modules/evidence/services/evidence.service.ts#L143-L188)
- **Technical Analysis:**
  There is a critical architectural divergence between the **Metadata Sync Push** path and the **Direct S3 Upload** path:

  1. **Sync Push Path (`POST /api/v1/sync/push`):**
     When the mobile app pushes an evidence metadata mutation, `executeEvidenceMutation` inserts a row into `evidence_files` using the client's UUIDv7:
     ```typescript
     await trx.insertInto('evidence_files').values({
       evidence_file_id: mutation.entityId, // Client-supplied UUIDv7
       visit_id: payload.visitId,
       evidence_type: payload.evidenceType,
       file_name: payload.fileName,
       file_size_bytes: Number(payload.fileSizeBytes),
       file_checksum_sha256: String(payload.fileChecksumSha256),
       upload_status: 'LOCAL_CAPTURED',
       ...
     }).execute();
     ```
     This creates an evidence row with `upload_status = 'LOCAL_CAPTURED'`.

  2. **Direct Upload Session Path (`POST /api/v1/evidence/upload-session`):**
     When the mobile app initiates physical photo upload via `executeDirectUpload`, it calls `POST /api/v1/evidence/upload-session`.
     In `EvidenceService.createUploadSession`:
     ```typescript
     // Generate server-authoritative evidence ID
     const evidenceId = generateUuidV7();
     ...
     await trx.insertInto('evidence_files').values({
       evidence_file_id: evidenceId, // BRAND NEW UUIDv7 GENERATED BY SERVER!
       visit_id: dto.visitId,
       evidence_type: dto.evidenceType,
       file_name: dto.fileName,
       file_size_bytes: dto.fileSizeBytes,
       file_checksum_sha256: dto.fileChecksumSha256,
       upload_status: 'UPLOAD_SESSION_CREATED',
       ...
     }).execute();
     ```
  3. **The Conflict:**
     - `createUploadSession` only checks for existing files where `upload_status IN ('FINALIZED', 'VERIFIED')`. It ignores `LOCAL_CAPTURED`.
     - It does **not accept** a client-specified `evidence_file_id`. It always generates a new UUIDv7.
     - Consequently, if the client synchronizes metadata first via `sync/push`, an `evidence_files` row is created with ID `A` (`LOCAL_CAPTURED`). When the client later uploads the physical file via `upload-session`, the server creates a **second** row with ID `B` (`UPLOAD_SESSION_CREATED`) and finalizes ID `B`.
     - Row `A` remains orphaned forever in `LOCAL_CAPTURED` status.
- **Risk Evaluation:**
  This is a critical architectural defect. Either `createUploadSession` must accept an existing `evidence_file_id` in `LOCAL_CAPTURED` status, or the mobile app must not sync evidence metadata records through `sync/push` if `executeDirectUpload` is the intended ingestion route.
- **Remediation Recommendation:**
  Update `createUploadSession` to accept an optional `evidenceFileId?: string`. If provided and a matching row exists in `LOCAL_CAPTURED` status with matching `file_checksum_sha256`, transition that existing record to `UPLOAD_SESSION_CREATED` rather than creating a duplicate row.

---

### Finding F-08: Asymmetric Evidence Metadata Validation
- **Classification:** `FINDING - MEDIUM`
- **Component:** `SyncPushService.executeEvidenceMutation` vs. `createEvidenceUploadSessionSchema`
- **Location:**
  - [`apps/api/src/modules/sync/services/sync-push.service.ts#L876-L877`](file:///D:/Zentra/apps/api/src/modules/sync/services/sync-push.service.ts#L876-L877)
  - [`packages/contracts/src/schemas/evidence.schema.ts#L22-L34`](file:///D:/Zentra/apps/api/src/modules/evidence/schemas/evidence.schema.ts)
- **Technical Analysis:**
  In `createEvidenceUploadSessionSchema`:
  - `fileSizeBytes`: `z.number().int().positive().max(15 * 1024 * 1024)` (Max 15 MB)
  - `fileChecksumSha256`: `z.string().regex(/^[a-fA-F0-9]{64}$/)` (Strict 64-char hex)
  - `evidenceType`: Strictly enum validated.

  In contrast, `SyncPushService.executeEvidenceMutation` extracts fields via loose type casting:
  ```typescript
  file_size_bytes: Number(payload.fileSizeBytes),
  file_checksum_sha256: String(payload.fileChecksumSha256),
  ```
  It does not validate that `fileSizeBytes <= 15MB`, nor does it validate that `fileChecksumSha256` is a valid 64-character hexadecimal string.
  If an unvalidated client pushes invalid metadata (e.g. `NaN` or garbage checksum), PostgreSQL may reject with type errors or insert corrupt metadata into `evidence_files`.
- **Remediation Recommendation:**
  Apply strict Zod schema parsing on `payload` inside `executeEvidenceMutation` using a shared contract schema before executing SQL insertion.

---

### Finding F-09: Delta Cursor Pagination Timestamp Skip Boundary
- **Classification:** `FINDING - MEDIUM`
- **Component:** `SyncDeltaService` & `sync-cursor.ts`
- **Location:**
  - [`apps/api/src/modules/sync/services/sync-delta.service.ts#L72, L100, L144, L160`](file:///D:/Zentra/apps/api/src/modules/sync/services/sync-delta.service.ts#L72-L100)
  - [`apps/api/src/modules/sync/utils/sync-cursor.ts#L21-L38`](file:///D:/Zentra/apps/api/src/modules/sync/utils/sync-cursor.ts#L21-L38)
- **Technical Analysis:**
  `SyncDeltaService.fetchDelta` retrieves incremental changes for service cases, field visits, and tombstones using:
  ```typescript
  .where('updated_at', '>', cursorDate)
  .orderBy('updated_at', 'asc')
  .limit(effectiveLimit)
  ```
  The cursor is encoded as:
  ```typescript
  export interface SyncCursorPayload {
    t: number; // millisecond timestamp
    s: number; // tombstone sequence
  }
  ```
  **Boundary Issue:**
  If multiple records (e.g. 50 cases) are bulk updated in the same transaction or batch within the same millisecond, and the page limit (e.g. 20) cuts off midway through that millisecond set:
  - The returned cursor has `t = timestamp`.
  - On the client's next call with this cursor, the query runs `WHERE updated_at > cursorDate`.
  - Because it uses strictly greater than (`>`), the remaining 30 records updated at that exact millisecond **will be skipped** and omitted from the client's delta synchronization.
- **Remediation Recommendation:**
  Augment `SyncCursorPayload` to include `id: string` as a secondary tiebreaker:
  `WHERE (updated_at > cursorDate) OR (updated_at = cursorDate AND id > cursorId) ORDER BY updated_at ASC, id ASC`.

---

### Finding F-10: Evidence Storage & Cryptographic SHA-256 Integrity Verification
- **Classification:** `VERIFIED - PASS`
- **Component:** `EvidenceService` & `ObjectStorageService`
- **Location:** [`apps/api/src/modules/evidence/services/evidence.service.ts#L246-L280`](file:///D:/Zentra/apps/api/src/modules/evidence/services/evidence.service.ts#L246-L280)
- **Technical Analysis:**
  During evidence upload finalization (`POST /api/v1/evidence/:id/finalize`), `EvidenceService` enforces strict fail-closed verification:
  1. Retrieves expected file size and SHA-256 checksum from the database record.
  2. Calls `objectStorageService.verifyObjectIntegrity(storageKey, expectedSizeBytes, expectedChecksumSha256)`.
  3. `verifyObjectIntegrity`:
     - Calls AWS S3 / MinIO `HeadObject` to confirm object existence.
     - Confirms S3 `ContentLength === expectedSizeBytes`.
     - Inspects `ChecksumSHA256` header; if absent, streams the object via `GetObject` to compute the actual SHA-256 hash.
     - Compares computed checksum against `expectedChecksumSha256`.
     - Throws `ConflictException('EVIDENCE_CHECKSUM_MISMATCH')` if mismatched.
  4. Only updates status to `'FINALIZED'` and `'VERIFIED'` if verification succeeds.
- **Verification Result:** Fully verified. Storage security and cryptographic tamper detection are production-grade.

---

## 6. Mobile-to-Backend Contract Compatibility Analysis

The 6 operations currently queued in the physical device's WatermelonDB database (`OnePlus Nord AC2001`, verified in Stage 6G-B3-C3-DV) were evaluated against the backend's ingestion contract.

### 6.1 Queued Operations Inventory
| Operation ID (Client) | Entity Type | Mutation Type | Entity ID (UUIDv7) | Target Table | Payload Compatibility |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `01931b68-b010-7000-8000-000000000001` | `field_visit` | `STATUS_TRANSITION` | `01931b67-4a00-7056-bb66-e8bc90e9df8d` | `field_visits` | **COMPATIBLE** (`SCHEDULED` -> `EN_ROUTE`) |
| `01931b68-b010-7000-8000-000000000002` | `field_visit` | `STATUS_TRANSITION` | `01931b67-4a00-7056-bb66-e8bc90e9df8d` | `field_visits` | **COMPATIBLE** (`EN_ROUTE` -> `ON_SITE`) |
| `01931b68-b010-7000-8000-000000000003` | `field_visit` | `STATUS_TRANSITION` | `01931b67-4a00-7056-bb66-e8bc90e9df8d` | `field_visits` | **COMPATIBLE** (`ON_SITE` -> `COMPLETED`) |
| `01931b68-b010-7000-8000-000000000004` | `field_visit` | `STATUS_TRANSITION` | `01931b67-4a00-7056-bb66-e8bc90e9df8d` | `field_visits` | **COMPATIBLE** (`FINDINGS_RECORDED`) |
| `01931b68-b010-7000-8000-000000000005` | `evidence_file` | `CREATE` | `01931b67-6a12-7000-8000-000000000001` | `evidence_files` | **DUAL-PIPELINE CONFLICT** (See F-07) |
| `01931b68-b010-7000-8000-000000000006` | `evidence_file` | `CREATE` | `01931b67-6a12-7000-8000-000000000002` | `evidence_files` | **DUAL-PIPELINE CONFLICT** (See F-07) |

### 6.2 Evidence Payload Audit
The two physical photos on the device were repaired and verified in Stage 6G-B3-C3 / Stage 6G-B3-C3-DV:
- **Photo 1:**
  - File: `82ce30ce-4712-441c-a43a-cda18fca8151.jpg`
  - Byte Size: `1,939,812` bytes (repaired from `0`)
  - Checksum: `5610ec1f47ef2ea926f7c5e2ec838a08cfa36246e4d5885c490ffb0c79dbefb6`
- **Photo 2:**
  - File: `835bac9f-fbc1-4eae-9a16-277c79d6228d.jpg`
  - Byte Size: `1,847,194` bytes (repaired from `0`)
  - Checksum: `a57f86eb8c7f2674e5033c467df815591b6e4e89bb5eb0746cb3bc97a9226cb6`

**Compatibility Assessment:**
- Both file sizes (`~1.8MB - 1.9MB`) are well within the 15MB limit.
- Both SHA-256 checksums are valid 64-character lowercase hex strings.
- However, as documented in **Finding F-07**, if operations 5 and 6 are submitted to `POST /api/v1/sync/push`, the backend will insert rows with `upload_status: 'LOCAL_CAPTURED'`. If the mobile app then runs `executeDirectUpload`, `createUploadSession` will fail to recognize them and generate duplicate server records.

---

## 7. Concurrency, Race Condition & Retry Safety Evaluation

| Scenario | Subsystem Handling | Safety Rating | Technical Notes |
| :--- | :--- | :---: | :--- |
| **Immediate Sequential Retry** | `IdempotencyRepository.findKey()` outside trx | **SAFE** | Fast-path immediately returns cached `response_payload`. |
| **In-Flight Concurrent Duplicate** | `saveKey()` with `.onConflict().doNothing()` | **VULNERABLE** | See Finding F-03. Duplicate `field_visit_status_history` entries can be inserted before conflict resolution. |
| **Transaction Rollback Retry** | Key saved on `trx` | **SAFE** | If transaction aborts, key is rolled back. Subsequent retry cleanly executes from scratch. |
| **Batch Middle Failure** | Per-mutation commit loop | **SAFE WITH REPLAY** | Unhandled error aborts HTTP response; prior mutations remain committed. Retrying whole batch safely skips prior via idempotency. |
| **Simultaneous Multi-Device Sync** | RLS + `verifyTerritoryAccess()` | **SAFE** | Queries verify territory district boundaries; cross-district interference blocked. |

---

## 8. Test Coverage & Verification Limitations

### 8.1 Automated Unit Tests Executed in this Audit
Two dedicated regression suites were executed using Vitest without database connections:
```
✓ apps/api/test/sync-idempotency-safety.spec.ts (8 tests passed)
✓ apps/api/test/sync-rls-remediation.spec.ts (17 tests passed)

Test Files: 2 passed (2)
Tests:      25 passed (25)
Duration:   11.06s
```

### 8.2 Integration Test Verification Limitations
The primary backend integration test suite (`apps/api/test/sync-engine.spec.ts`) contains 722 lines testing end-to-end sync, conflict arbitration, tombstones, and cursors.
**Limitation:**
- As verified in lines 65–96 of `sync-engine.spec.ts`, this suite issues:
  ```sql
  TRUNCATE TABLE idempotency_keys, tombstones, evidence_files, field_visits, service_cases ... CASCADE;
  ```
  against `postgresql://postgres:postgres@localhost:5432/zentra_test`.
- Under the absolute Stage 6G safety rules, mutating or truncating `zentra_test` is strictly forbidden.
- Therefore, the integration suite was **NOT executed** during this read-only audit.

---

## 9. Comprehensive Risk Register

| Risk ID | Vulnerability | Severity | Probability | Impact Description | Mitigation Strategy |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **RSK-01** | Evidence Identity Split | **HIGH** | High (100% if both sync & upload run) | Sync push creates row with ID A; direct upload creates row with ID B. Physical photo is attached to ID B, while ID A remains permanently unfinalized. | Unify pipelines: allow `createUploadSession` to attach to existing `LOCAL_CAPTURED` ID. |
| **RSK-02** | Status History Duplication | **MEDIUM** | Low (requires network duplicate race) | Double submission of visit status transition duplicates history and audit events. | Add `FOR UPDATE` lock on `field_visits` or unique constraint on `(client_operation_id)`. |
| **RSK-03** | Delta Cursor Record Skipping | **MEDIUM** | Low (requires >page limit updates in same ms) | Rapid bulk updates at identical timestamp could cause some records to be omitted during delta fetch. | Add primary key tiebreaker to `SyncCursorPayload`. |
| **RSK-04** | Loose Metadata Coercion | **LOW** | Low | Negative or non-hex evidence metadata inserted into database. | Enforce Zod contract schema in `executeEvidenceMutation`. |

---

## 10. Pre-Sync Remediation Roadmap & Final Directives

Before Stage 6G-B3-C5 (Live Metadata Synchronization) can be authorized by the system administrator, the following remediation steps must be completed:

```mermaid
flowchart TD
    A["Stage 6G-B3-C4 Audit Report Completed"] --> B{"Gate Decision: HOLD"}
    B --> C["Remediate Evidence Duality (Finding F-07)"]
    B --> D["Harden Visit Status Lock (Finding F-03)"]
    B --> E["Add Tiebreaker to Delta Cursor (Finding F-09)"]
    C & D & E --> F["Stage 6G-B3-C4-R Verification Audit"]
    F --> G["Stage 6G-B3-C5 Live Sync Authorization"]
```

### Remediation Checklist
1. **[CRITICAL] Align Evidence Pipelines:**
   Modify `apps/api/src/modules/evidence/services/evidence.service.ts` so that `createUploadSession` checks for an existing record with the client's `evidence_file_id` in `LOCAL_CAPTURED` status and reuses it instead of generating a new UUIDv7.
2. **[RECOMMENDED] Row-Lock on Status Transitions:**
   In `apps/api/src/modules/sync/services/sync-push.service.ts`, acquire a `FOR UPDATE` lock on `field_visits` before checking history or updating status.
3. **[RECOMMENDED] Cursor Tiebreaker:**
   In `apps/api/src/modules/sync/utils/sync-cursor.ts`, include the record ID in cursor encoding.

---

## 11. Final Declaration

> [!IMPORTANT]
> **AUDIT CONCLUSION: HOLD / CONDITIONAL NO-GO**  
> 1. The backend sync foundation is secure, properly isolated via RLS, and strictly type-safe with respect to UUIDv7 entities.  
> 2. However, the architectural mismatch between Sync Push evidence ingestion and Direct S3 photo upload poses an immediate data fragmentation risk if live sync is triggered.  
> 3. **Live synchronization remains strictly unauthorized.** Zero network calls were made, zero database mutations occurred, and the physical mobile device remains completely quiescent and protected.

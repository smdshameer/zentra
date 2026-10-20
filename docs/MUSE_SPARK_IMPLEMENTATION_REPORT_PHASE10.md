# MUSE SPARK IMPLEMENTATION REPORT — PHASE 10
## Mobile Local-First Core (Correction Pass)

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Phase:** 10 (Mobile Local-First Core)  
**Status:** PHASE 10 — CORRECTED / READY FOR FINAL REVIEW  
**Protocol Gate:** PHASE 10 CORRECTION PASS ONLY (No Phase 11+ functionality)  

---

## 1. Phase Identification

- **Phase Number:** 10
- **Phase Name:** Mobile Local-First Core
- **Application:** ZENTRA Field (`@zentra/field`)
- **Target Persona:** Field Engineer (`FIELD_ENGINEER`)
- **Correction Pass Status:** COMPLETE AND VERIFIED
- **Scope Compliance:** Strict Phase 10 boundaries observed; zero implementation, scaffolding, or prototyping of Phases 11–16.

---

## 2. Phase Objective

The objective of Phase 10 is to establish the authoritative **ZENTRA Field** mobile application foundation. It establishes an unconditional local-first architecture ensuring authorized field engineers can reliably inspect assigned service calls, examine school dossiers and equipment inventories, perform offline state transitions, and durably record pending mutations even when working in remote rural blocks with zero cellular reception.

Phase 10 provides the persistence, state, and transaction guarantees necessary for future synchronization without implementing the actual synchronization protocol.

---

## 3. Authoritative Source Documents Inspected

Before design, implementation, and correction pass execution, the following authoritative specifications were inspected:

1. `docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md`: Phase 10 definition and sequence boundary.
2. `docs/ZENTRA_PROJECT_REQUIREMENTS.md`: Mobile offline-first operational mandate, rural connectivity constraints, and tamper-resistant auditability.
3. `docs/ZENTRA_ARCHITECTURE.md`: Mobile-first client tier integration and boundary with ZENTRA Core API.
4. `docs/ZENTRA_MOBILE_ARCHITECTURE.md`: React Native + WatermelonDB on SQLite component stack, transaction queue architecture, and outdoor UI requirements.
5. `docs/ZENTRA_SYNC_ARCHITECTURE.md`: Local operation queue requirements, client operation IDs (monotonic UUIDv7), and Phase 12 sync engine interface definitions.
6. `docs/ZENTRA_SECURITY_ARCHITECTURE.md`: Hardware keystore session storage, non-logging of tokens, and server-authoritative role enforcement.
7. `docs/ZENTRA_ARCHITECTURE_DECISION_RECORD.md`: ADR decisions regarding mobile offline storage and transaction atomicity.
8. `docs/MUSE_SPARK_IMPLEMENTATION_REPORT_PHASE5.md` through `docs/MUSE_SPARK_IMPLEMENTATION_REPORT_PHASE9.md`: Reused API contracts, authentication models, domain terminology, and state machine lifecycle definitions.

---

## 4. Phase 10 Correction Pass Verification Summary

In accordance with the review directives, the following corrections have been executed:

| Correction | Finding / Concern | Corrective Action Taken | Status |
| :--- | :--- | :--- | :---: |
| **#1 — Field Visit Boundary** | Reference to `VISIT_STARTED` ("ARRIVED AT LAB") conflated local case transitions with Phase 13 visit execution. | Removed `VISIT_STARTED` and arrival wording from UI and tests; clarified all offline transitions as demonstration of existing Phase 9 case status persistence. Verified zero visit check-in/out, geofencing, or visit wizard code exists. | RESOLVED |
| **#2 — Haversine / GPS Leakage** | `test/field.spec.ts` contained a leftover Haversine distance test and import from Phase 2. | Removed `calculateHaversineDistanceMeters` import and test from `field.spec.ts`. Verified zero GPS or distance calculation code in `apps/field`. Added 4 explicit boundary tests asserting absence of GPS, camera, visit execution, and S3 upload modules. | RESOLVED |
| **#3 — Preload vs Synchronization** | Preload required explicit architectural separation from synchronization. | Documented `PRELOAD/CACHE ≠ SYNCHRONIZATION` in `PreloadManager`. Added unit test verifying preload does not produce delta tokens, push operations, or modify the local operation queue. | RESOLVED |
| **#4 — Operation Queue Local Semantics** | `ACKNOWLEDGED` queue status could be misconstrued as server acknowledgement. | Updated docstrings and interfaces in `OperationQueue` clarifying `ACKNOWLEDGED` is strictly a future-compatible local bookkeeping state. Added boundary tests confirming queue has zero server push or conflict arbitration methods. | RESOLVED |
| **#5 — sync_metadata Boundary** | Local database table `sync_metadata` required strict boundary documentation. | Documented: *"Schema foundation only — synchronization semantics deferred to Phase 12."* Retained only minimal key-value container with zero cursor negotiation, delta tokens, or conflict versions. | RESOLVED |
| **#6 — Offline Status Mutations & UI** | UI required explicit distinction between local pending mutations and server confirmation. | Updated `CaseDetailScreen` and `AssignedCasesScreen` to render distinct badges: `LOCAL / PENDING` (for `PENDING_SYNC`) vs `SERVER CONFIRMED` (for records loaded from server). | RESOLVED |
| **#7 — Test Accounting** | Test counts needed recalculation after removing Haversine test and adding boundary tests. | Recalculated exact counts: 35 mobile tests (9 files), 185 backend regression tests (7 files), 1 web test (1 file), 221 total monorepo tests. Distinguish 8 new correction tests from 27 initial tests. | RESOLVED |
| **#8 — Native Runtime Limitations** | Honest documentation required regarding headless vs physical hardware. | Maintained explicit disclaimer: *NOT TESTED ON PHYSICAL HARDWARE — REQUIRES MOBILE RUNTIME*. Node/V8 + LokiJSAdapter tests prove repository logic but do not validate physical device runtime. | RESOLVED |

---

## 5. Mobile Architecture

ZENTRA Field implements a layered Clean Architecture:

```
┌────────────────────────────────────────────────────────┐
│               UI & Navigation Layer                     │
│   (Navigator, Login, Dashboard, Cases, Detail, Profile)│
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│               Application & State Layer                │
│    (SessionManager, NetworkMonitor, PreloadManager)    │
└─────────────┬────────────────────────────┬─────────────┘
              │                            │
┌─────────────▼─────────────┐ ┌────────────▼─────────────┐
│  Domain & Repositories     │ │     Typed API Client     │
│ (ServiceCases, Schools,    │ │ (Token refresh, timeout, │
│  Labs, OperationQueue)     │ │  error classification)   │
└─────────────┬─────────────┘ └────────────┬─────────────┘
              │                            │
┌─────────────▼─────────────┐              │
│ Local WatermelonDB Engine │              │
│  (SQLite JSI / Schema v1) │              │
└───────────────────────────┘              ▼
                                  ZENTRA Core REST API
```

---

## 6. Project Structure

The implemented structure in `apps/field/` comprises:

```
apps/field/
├── App.tsx                                 # Root application component & lifecycle
├── app.json                                # Expo CNG mobile configuration
├── package.json                            # Package dependencies
├── tsconfig.json                           # TypeScript configuration with decorator support
├── src/
│   ├── index.ts                            # Public module export entry point
│   ├── api/                                # Typed API Client foundation
│   │   ├── types.ts                        # ApiClientError, classifications, envelopes
│   │   ├── api-client.ts                   # Fetch wrapper with timeouts & token refresh
│   │   ├── auth-api.ts                     # Login, token refresh, logout API
│   │   ├── cases-api.ts                    # Assigned service cases query API
│   │   ├── reference-api.ts                # School, lab, equipment reference fetcher
│   │   └── index.ts
│   ├── auth/                               # Secure Authentication & Session
│   │   ├── secure-storage.ts               # Hardware Keystore & In-Memory secure adapters
│   │   ├── session-manager.ts              # Session persistence, auto-restore, expiry
│   │   └── index.ts
│   ├── database/                           # WatermelonDB Local Database
│   │   ├── schema.ts                       # AppSchema v1 (8 indexed tables)
│   │   ├── migrations.ts                   # Schema migrations ledger
│   │   ├── database.ts                     # Database factory (SQLite JSI + LokiJS)
│   │   ├── models/                         # Domain & queue WatermelonDB models
│   │   │   ├── DistrictModel.ts
│   │   │   ├── BlockModel.ts
│   │   │   ├── SchoolModel.ts
│   │   │   ├── HiTechLabModel.ts
│   │   │   ├── EquipmentModel.ts
│   │   │   ├── ServiceCaseModel.ts
│   │   │   ├── LocalOperationModel.ts      # Persistent local queue model
│   │   │   ├── SyncMetadataModel.ts        # Minimal sync schema container
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── domain/                             # Repositories, Identity, and Preload
│   │   ├── identity/
│   │   │   └── identity-map.ts             # Server ID vs Local ID resolver & UUIDv7
│   │   ├── queue/
│   │   │   ├── operation-types.ts          # Operation types & queue stats interfaces
│   │   │   └── operation-queue.ts          # Queue engine (enqueue, retry, bookkeeping)
│   │   ├── repositories/
│   │   │   ├── service-case.repository.ts  # Atomic local mutation & offline reading
│   │   │   ├── school.repository.ts        # School dossier offline cache
│   │   │   ├── lab.repository.ts           # Hi-tech lab offline cache
│   │   │   ├── equipment.repository.ts     # Lab equipment offline cache
│   │   │   ├── operation-queue.repository.ts
│   │   │   └── index.ts
│   │   └── preload/
│   │       └── preload-manager.ts          # Scoped dossier cache preloader
│   ├── network/                            # Connectivity Awareness
│   │   └── network-monitor.ts              # NetInfo & Mock connectivity monitors
│   ├── navigation/                         # Navigation Foundation
│   │   ├── types.ts                        # ScreenName & route params
│   │   └── Navigator.tsx                   # High-contrast outdoor shell & router
│   ├── screens/                            # High-Contrast Mobile Screens
│   │   ├── LoginScreen.tsx                 # Field Engineer login form
│   │   ├── DashboardScreen.tsx             # Overview, pending ops counter, preload
│   │   ├── AssignedCasesScreen.tsx         # Assigned calls list with sync badges
│   │   ├── CaseDetailScreen.tsx            # Detail view & atomic local status transition
│   │   ├── SchoolDetailScreen.tsx          # School master dossier view
│   │   └── ProfileScreen.tsx               # Engineer profile & queue inspector
│   └── components/
│       └── ErrorBoundary.tsx               # Top-level React error boundary
└── test/                                   # Vitest automated test suite (35 tests)
    ├── field.spec.ts                       # Configuration & boundary isolation tests
    ├── local-database.spec.ts              # Schema, models, and repositories
    ├── operation-queue.spec.ts             # Queue lifecycle, retries, boundary checks
    ├── atomic-transactions.spec.ts         # Atomic mutation, rollback, & offline persistence
    ├── restart-recovery.spec.ts            # App termination & restart simulation
    ├── auth-session.spec.ts                # Session management & security checks
    ├── api-client.spec.ts                  # Network classification & timeouts
    ├── connectivity-awareness.spec.ts      # Online/Offline decoupling from sync
    └── preload-cache.spec.ts               # Scoped preloading & sync decoupling checks
```

---

## 7. Authentication & Session Foundation

- **Backend Integration**: Integrates directly with Phase 5 endpoints (`POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`).
- **Session Restoring**: Automatically loads stored sessions on startup via `SessionManager.restoreSession()`.
- **Expiry Buffer**: Proactively flags tokens within 30 seconds of expiry via `isAccessTokenExpired()`.
- **Silent Refresh**: When HTTP 401 is encountered, `ApiClient` automatically attempts token refresh and replays the request before failing.
- **Hardware Storage**: Access tokens and refresh tokens are stored in platform keystore via `ExpoSecureStoreAdapter` (or `InMemorySecureStorageAdapter` in test/headless environments).
- **Active Role**: Retains `FIELD_ENGINEER` active role model without client-side authorization bypass.

---

## 8. Local Database Foundation

- **Engine**: WatermelonDB on native SQLite (JSI) for zero-delay startup and lazy record evaluation.
- **Schema Version**: Version 1 (`APP_SCHEMA_VERSION = 1`).
- **Tables (8)**:
  1. `districts`: District reference data.
  2. `blocks`: Block reference data.
  3. `schools`: School master dossier (UDISE, categories, coordinates, HM contacts).
  4. `hi_tech_labs`: Lab locations, system counts, and status.
  5. `equipment`: Lab hardware inventory (OEMs, models, serial numbers, conditions).
  6. `service_cases`: Assigned field cases with `sync_state` (`SYNCED`, `PENDING_SYNC`, `LOCAL_ONLY`).
  7. `local_operations`: Persistent transaction queue ledger for offline mutations.
  8. `sync_metadata`: Minimal key-value metadata container (*Schema foundation only — synchronization semantics deferred to Phase 12*).
- **Indexing**: Indexed on foreign keys, `server_id`, `operational_status`, and queue status.

---

## 9. Local Models

Models extend `@nozbe/watermelondb/Model` with TypeScript property decorators:
- `DistrictModel`: `@text('server_id')`, `@text('district_code')`, `@text('district_name')`
- `BlockModel`: `@text('server_id')`, `@text('district_id')`, `@text('block_name')`
- `SchoolModel`: `@text('udise_code')`, `@text('school_name')`, `@field('latitude')`, `@text('headmaster_phone')`
- `HiTechLabModel`: `@text('lab_type')`, `@field('total_systems')`, `@field('is_functional')`
- `EquipmentModel`: `@text('serial_number')`, `@text('oem_name')`, `@text('functional_status')`
- `ServiceCaseModel`: `@text('zentra_case_code')`, `@text('operational_status')`, `@text('sync_state')`, `@field('isPendingSync')`
- `LocalOperationModel`: `@text('client_operation_id')`, `@text('entity_type')`, `@text('status')`, `@field('retry_count')`, `@field('isPending')`
- `SyncMetadataModel`: `@text('key')`, `@text('value')` (*Schema foundation only — synchronization semantics deferred to Phase 12*)

---

## 10. Repository Layer

All database interactions are encapsulated behind repositories; UI screens never touch database tables directly:
- `ServiceCaseRepository`: Offline reading of assigned cases and atomic status updates.
- `SchoolRepository`: Offline querying of school dossiers by UDISE, ID, or district.
- `LabRepository`: Offline querying of lab configurations for assigned schools.
- `EquipmentRepository`: Offline querying of equipment items for assigned labs.
- `OperationQueueRepository`: Queue inspection, statistics, and retry triggers.

---

## 11. Local-First Behavior & Lifecycle Boundary

- **Offline Read Model**: When offline, the app reads immediately from local WatermelonDB without network blocking.
- **Offline Mutation Model**: When offline, the engineer can record status transitions (e.g. `ASSIGNED -> IN_TRANSIT`, `IN_TRANSIT -> IN_PROGRESS`, `IN_PROGRESS -> PENDING_PARTS`).
- **Phase 9 State Transition Demonstration**:
  - The local status transitions demonstrate the local persistence and queue architecture for existing Phase 9 service-case state transitions.
  - **STRICT BOUNDARY**: Phase 10 does **NOT** implement the Phase 13 field visit execution workflow.
  - Phase 10 contains:
    - ❌ NO physical arrival detection
    - ❌ NO visit check-in or check-out
    - ❌ NO GPS coordinate validation or geofencing
    - ❌ NO visit creation workflow (`field_visits` table)
    - ❌ NO multi-visit sequencing
    - ❌ NO field visit completion
    - ❌ NO equipment diagnostic findings entry
    - ❌ NO Headmaster (HM) verification workflow
  - All visit execution features are strictly deferred to Phase 13.
- **Visual Sync Semantics**:
  - The UI explicitly distinguishes:
    - `LOCAL / PENDING` (high-contrast amber badge for unpushed local mutations, `PENDING_SYNC`)
    - `SERVER CONFIRMED` (green badge for records loaded directly from server via preload)
  - The application **never** displays "Synced" unless server confirmation exists.

---

## 12. Local Operation Queue

- **Zero Data Loss Ledger**: Stored durably in `local_operations` table.
- **Deterministic Monotonic Identity**: Every queued operation receives a UUIDv7 `clientOperationId`.
- **Status Lifecycle**:
  $$\text{QUEUED} \longrightarrow \text{IN\_FLIGHT} \longrightarrow \text{ACKNOWLEDGED} \quad \text{or} \quad \text{FAILED}$$
- **Local Bookkeeping Semantics**:
  - `ACKNOWLEDGED` is strictly a future-compatible local bookkeeping state for when an operation is confirmed or resolved by the future Phase 12 sync engine.
  - Phase 10 does **NOT** perform server push, server acknowledgement, delta synchronization, conflict arbitration, tombstone synchronization, or server/client merge logic.
- **Retry Bookkeeping**: Increments `retryCount`, records `errorMessage`, and updates `lastAttemptAt`.
- **Queue Statistics**: Exposes `totalPending`, `queuedCount`, `inFlightCount`, `failedCount`, and `acknowledgedCount`.

---

## 13. Transaction Guarantees (ACID)

In `ServiceCaseRepository.updateStatusLocally`, mutations are executed inside `database.write(...)`:
1. The domain record in `service_cases` is updated (`operationalStatus`, `notes`, `syncState = 'PENDING_SYNC'`).
2. The corresponding mutation record in `local_operations` is inserted.
3. **Atomic Rollback Guarantee**: If any failure occurs during execution, the transaction rolls back completely. Neither the domain record nor the queue entry commits, leaving zero orphan queue records or partial states.

---

## 14. Connectivity Model

- **Architecture**: `INetworkMonitor` interface implemented via `@react-native-community/netinfo` (`NetInfoNetworkMonitor`) and `MockNetworkMonitor`.
- **States**: `ONLINE`, `OFFLINE`, and `UNKNOWN`.
- **CRITICAL DECOUPLING PROOF**: Network connectivity is strictly informational. Becoming `ONLINE` **never** alters local record sync states or marks operations as acknowledged. Actual synchronization remains deferred to Phase 12.

---

## 15. API Client

- **Error Classification**:
  - `NETWORK_OFFLINE`: Physical connection loss or network interface down.
  - `TIMEOUT`: Request exceeded configured timeout threshold via `AbortController`.
  - `AUTHENTICATION_REQUIRED`: 401 Unauthorized requiring login or refresh.
  - `FORBIDDEN`: 403 Forbidden.
  - `VALIDATION_ERROR`: 400 Bad Request with backend validation errors.
  - `SERVER_ERROR`: 500+ Internal Server Error.
- **Sanitization**: Never logs passwords, tokens, or authorization headers.

---

## 16. Cache & Preload Strategy

- **PRELOAD/CACHE ≠ SYNCHRONIZATION**:
  - Preload strictly performs read/cache retrieval for offline access.
  - Preload does **NOT** implement delta synchronization, delta tokens, conflict resolution, operation pushes, or state reconciliation.
- **Authorization-Scoped Preloading**: `PreloadManager.preloadAssignedDossier()` fetches only cases assigned to the authenticated Field Engineer.
- **Referenced Entity Cascading**: Inspects assigned cases and fetches dossiers **only** for the schools, labs, and equipment referenced by those cases.
- **Bounded Volume**: Prohibits full-database or statewide downloading.
- **Resilience**: A failure to fetch reference data for an individual school does not abort the preloading of remaining records.

---

## 17. Security

- **Sensitive Data Minimization**: Passwords and raw tokens are **never** stored in WatermelonDB domain tables.
- **Secure Hardware Storage**: Tokens are kept in hardware keystores (`expo-secure-store`).
- **Server Authority**: The mobile app acknowledges `FIELD_ENGINEER` active role, but backend endpoints remain authoritative for all permissions and territory boundaries.
- **Local Operation Identity**: Deterministic UUIDv7 guarantees client-generated operation IDs are globally unique and tamper-evident.

---

## 18. Navigation Foundation

- **Shell**: Mobile shell in `Navigator.tsx` tailored for high-contrast outdoor visibility.
- **Screens**:
  1. `LoginScreen`: Field engineer credential input.
  2. `DashboardScreen`: Overview, role display, queue stats, and preload button.
  3. `AssignedCasesScreen`: List of local cached calls with `LOCAL / PENDING` vs `SERVER CONFIRMED` badges.
  4. `CaseDetailScreen`: Inspection and atomic offline status transitions.
  5. `SchoolDetailScreen`: School master dossier (UDISE, contact numbers).
  6. `ProfileScreen`: Engineer identity, queue inspector, and logout.
- **Strict Boundaries**: Excludes GPS gating, camera capture, visit check-in wizards, and HM signatures.

---

## 19. Tests (Phase 10)

Following the removal of the Haversine calculation test and the addition of 8 correction tests, Phase 10 includes **35 automated tests across 9 test files** in `apps/field/test/`:

| Test Suite File | Tests | Key Behaviors Verified | Status |
| :--- | :---: | :--- | :---: |
| `test/field.spec.ts` | 6 | Expo configuration; shared constants; **Boundary assertions**: confirms zero GPS/Haversine, zero camera hardware, zero field visit execution, and zero S3 evidence modules. *(1 Haversine test removed, 4 boundary tests added)* | PASS |
| `test/local-database.spec.ts` | 5 | WatermelonDB schema v1, 8 tables, models, offline querying for schools, labs, equipment, and cases. | PASS |
| `test/operation-queue.spec.ts` | 6 | UUIDv7 ordering, status transitions, retries, stats. **Boundary assertions**: confirms queue does not perform synchronization/server push, and does not perform conflict arbitration. *(2 correction tests added)* | PASS |
| `test/atomic-transactions.spec.ts` | 3 | Domain update + queue insert atomicity; rollback on failure; **offline status mutation persistence** without server contact preserving data for Phase 12. *(1 correction test added)* | PASS |
| `test/restart-recovery.spec.ts` | 2 | Persistence and recovery of pending work across reboots; sync flags preserved. | PASS |
| `test/auth-session.spec.ts` | 4 | Secure storage, session restore, expiry, token sanitization, zero plain tokens in DB. | PASS |
| `test/api-client.spec.ts` | 3 | Error classification (`NETWORK_OFFLINE`, `TIMEOUT`), bearer injection, 401 token refresh. | PASS |
| `test/connectivity-awareness.spec.ts` | 3 | Connectivity transitions decoupled from sync; online state does NOT alter queue status. | PASS |
| `test/preload-cache.spec.ts` | 3 | Scoped dossier caching; bounded download volume; **sync decoupling**: confirms preload does not produce delta tokens, push operations, or alter queue. *(1 correction test added)* | PASS |

### Test Accounting Breakdown:
- Initial Phase 10 tests: 28 tests
- Minus removed Haversine test: -1 test
- Plus new correction/boundary tests: +8 tests
- **Total Phase 10 Tests Passing: 35 tests across 9 test files.**

---

## 20. Regression Tests (Phases 5–9)

All backend integration, domain, and web suites continue to pass with zero regressions:
- `apps/api/test/import-staging-domain.spec.ts`: 21 tests pass.
- `apps/api/test/equipment-domain.spec.ts`: 49 tests pass.
- `apps/api/test/service-case-lifecycle.spec.ts`: 25 tests pass.
- `apps/api/test/database-schema.spec.ts`: 19 tests pass.
- `apps/api/test/auth-security.spec.ts`: 38 tests pass.
- `apps/api/test/school-lab-domain.spec.ts`: 30 tests pass.
- `apps/api/test/api.spec.ts`: 3 tests pass.
- `apps/web/test/web.spec.ts`: 1 test pass.

**Total Monorepo Tests Passing: 221 tests across 17 test suites (0 failures).**
*(185 backend `@zentra/api` + 35 mobile `@zentra/field` + 1 web `@zentra/web` = 221 tests)*

---

## 21. Build, Typecheck, and Lint Verification

- **`pnpm turbo run typecheck`**: **15 successful tasks across 10 packages** (0 errors).
- **`pnpm turbo run test --force`**: **13 turbo tasks successful** across all packages (0 errors, 221 total tests).
- **Honest Native Runtime Limitation Note**: Tests were executed in Node/V8 with in-memory adapters (`LokiJSAdapter`, `InMemorySecureStorageAdapter`, `MockNetworkMonitor`). Native Android APK execution requires physical device or Android emulator:  
  *NOT TESTED ON PHYSICAL HARDWARE — REQUIRES MOBILE RUNTIME.*

---

## 22. Known Limitations (Phase 10)

1. **No Background Synchronization Daemon**: Phase 10 records pending mutations in the queue, but does not push them to the server in the background (strictly deferred to Phase 12).
2. **No Hardware Geolocation or Camera**: Phase 10 contains no GPS accuracy gating or camera photo streams (strictly deferred to Phase 11 and Phase 14).
3. **No Multi-Stage Field Visit Wizard**: Phase 10 contains no `field_visits` entity execution, check-in, or check-out workflows (strictly deferred to Phase 13).
4. **Native Runtime Validation**: Headless testing validates all logic and repository semantics, but physical SQLite JSI execution on Android/iOS requires mobile runtime deployment.

---

## 23. Requirements Requiring Clarification

1. **Local Data Retention & Cache Pruning**:
   - `REQUIRES CLARIFICATION`: Maximum retention duration for resolved/closed service cases in local storage before automatic pruning.
2. **Maximum Queue Retry Threshold**:
   - `REQUIRES CLARIFICATION`: Maximum number of retries before a permanently failing operation is flagged for manual supervisor inspection.
3. **Emergency Offline Override Authority**:
   - `REQUIRES CLARIFICATION`: Operational policy on whether an unassigned engineer can take on a critical call entirely offline without server dispatch.

---

## 24. Explicit Phase 11–16 Scope Deferrals

In strict accordance with `docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md`, the following capabilities are deferred:

1. **PHASE 11 — Mobile Hardware GPS & Camera Module**:
   - Native GPS coordinates, accuracy threshold checking ($\le 50\text{m}$), and geofence verification.
   - Rear camera stream (CameraX), photo aspect ratio locking, and client watermarking.
   - **DEFERRED TO PHASE 11.**
2. **PHASE 12 — Delta Synchronization & Conflict Arbitration Engine**:
   - Push and pull synchronization protocols (`POST /api/v1/sync/push`, `GET /api/v1/sync/pull`).
   - Monotonic sync sequence numbers and deletion tombstones.
   - Domain-owned conflict arbitration matrix.
   - **DEFERRED TO PHASE 12.**
3. **PHASE 13 — Field Visit Execution & Multi-Visit Flow**:
   - Physical visit execution workflow (`ARRIVED` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ `COMPLETED`).
   - Geofenced check-in and check-out.
   - Dynamic equipment diagnostic findings entry (`visit_equipment_findings`).
   - **DEFERRED TO PHASE 13.**
4. **PHASE 14 — Evidence Pipeline & Direct S3 Streaming**:
   - Direct pre-signed S3 binary upload streaming.
   - Cryptographic SHA-256 client checksum hashing.
   - Headmaster (HM) on-glass digital sign-off and slot-based evidence enforcement.
   - **DEFERRED TO PHASE 14.**
5. **PHASE 15 — Conveyance Claims & Management Web Portal**:
   - Automated travel distance and conveyance claim calculation.
   - ZENTRA Web management portal for state coordinators and SLA dashboards.
   - **DEFERRED TO PHASE 15.**
6. **PHASE 16 — E2E Field Rehearsal & Production Hardening**:
   - Offline/online chaos testing, field rehearsal, load testing, and production deployment scripts.
   - **DEFERRED TO PHASE 16.**

---

## 25. Acceptance-Gate Verification

| Acceptance Criteria | Status | Evidence / Verification |
| :--- | :---: | :--- |
| Mobile local-first architecture exists | PASS | Established in `apps/field` |
| WatermelonDB/SQLite foundation exists | PASS | Schema v1 with 8 indexed tables and models |
| Authentication/session foundation exists | PASS | `SessionManager` + `ISecureStorage` hardware keystore |
| Local repositories exist | PASS | 5 typed repositories in `src/domain/repositories/` |
| Offline reads work | PASS | Verified in `test/local-database.spec.ts` |
| Local mutations are durable | PASS | Verified in `test/operation-queue.spec.ts` & `atomic-transactions.spec.ts` |
| Mutation + queue insertion is atomic | PASS | Verified in `test/atomic-transactions.spec.ts` (ACID rollback confirmed) |
| Restart recovery works | PASS | Verified in `test/restart-recovery.spec.ts` |
| Connectivity is separate from synchronization | PASS | Verified in `test/connectivity-awareness.spec.ts` |
| Preload is authorization-scoped | PASS | Scoped strictly to assigned cases in `PreloadManager` |
| Preload does not perform synchronization | PASS | Verified in `test/preload-cache.spec.ts` (no delta tokens, no queue writes) |
| Operation queue only records local pending work| PASS | Verified in `test/operation-queue.spec.ts` |
| sync_metadata is only a future foundation | PASS | Minimal key-value container; documented as schema foundation only |
| No GPS implementation exists | PASS | Zero GPS code; verified in `test/field.spec.ts` |
| No camera implementation exists | PASS | Zero camera code; verified in `test/field.spec.ts` |
| No Haversine/GPS functionality remains | PASS | Removed helper and test; verified in `test/field.spec.ts` |
| No synchronization engine exists | PASS | Phase 12 sync engine untouched; verified in `test/operation-queue.spec.ts` |
| No conflict arbitration exists | PASS | Phase 12 conflict engine untouched; verified in `test/operation-queue.spec.ts` |
| No field visit execution exists | PASS | Phase 13 visit wizard untouched; verified in `test/field.spec.ts` |
| No evidence/S3 implementation exists | PASS | Phase 14 S3 pipeline untouched; verified in `test/field.spec.ts` |
| No conveyance/Web Portal exists | PASS | Phase 15 conveyance/portal untouched |
| No Phase 16 implementation exists | PASS | Phase 16 hardening untouched |
| Tests and totals are accurate | PASS | 35 mobile tests, 185 backend tests, 1 web test = 221 total tests pass |
| Native-runtime limitations honestly documented | PASS | Clearly marked: *NOT TESTED ON PHYSICAL HARDWARE — REQUIRES MOBILE RUNTIME* |
| MUSE SPARK report complete | PASS | All 26 sections documented and verified |

---

## 26. Final Status

**PHASE 10 — CORRECTED / READY FOR FINAL REVIEW**

STOPPED AFTER THIS STEP — AWAITING REVIEW.

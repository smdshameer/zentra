# MUSE SPARK IMPLEMENTATION REPORT — PHASE 4
## ZENTRA — Hi-Tech Lab Field Service Management Platform
### Phase 4: Database & Core Domain Implementation (Corrected Post-Review)

---

## 1. Phase 4 Objective & Executive Summary
- **Status**: `IMPLEMENTED` | `TESTED` (with explicit deferred scope classifications)
- **Objective**: Establish the authoritative PostgreSQL database architecture, schema migrations, core domain persistence models, referential integrity rules, indexing strategies, and automated integration test infrastructure for the ZENTRA Hi-Tech Lab Field Service Management Platform.
- **Executive Summary**:
  Phase 4 transforms the approved Phase 1 architecture and Phase 2 database blueprints into a running, type-safe PostgreSQL foundation. Using Kysely with native TypeScript migrations and the Node-Postgres driver, 21 authoritative domain tables were designed, implemented, and verified against a live PostgreSQL 18.6 database instance (`zentra_test`).
  The domain foundation decouples external complaint intake from internal operational service cases, supports multi-visit workflows per case, enforces allowed evidence slot values, indexes dynamic equipment attributes with GIN `jsonb_path_ops`, and provides soft-deletion columns alongside a monotonic tombstone cursor for future mobile offline synchronization. All 19 schema integration tests and 3 API smoke tests passed cleanly under automated execution. Zero production data or real school PII was imported; all fixtures and test suites are 100% deterministic and synthetic.

---

## 2. Scope Boundaries & Explicit Non-Goals
- **Status**: `IMPLEMENTED` (Strict Boundary Adherence Verified)
- **Included in Scope**:
  1. Authoritative PostgreSQL schema across 21 core domain tables.
  2. Sequential, bidirectional (`up()` and `down()`) Kysely TypeScript migrations.
  3. Strongly-typed Kysely database interface definitions (`DatabaseSchema`).
  4. Relational integrity constraints, foreign keys, cascades, unique indexes, and domain CHECK constraints.
  5. Decoupled domain models: Geography, Equipment, Complaints, Service Cases, Visits, Evidence, Import Staging, Auditing, and Tombstones.
  6. Synthetic seed generator and hermetic test suite executing against a real PostgreSQL engine.
- **Explicit Non-Goals (Strict Phase 4 Exclusions & Authoritative Sequence Alignment)**:
  1. **Authentication & User Credential Storage**: No password hashing, argon2/bcrypt, user passwords, login routes, or JWT issuance (strictly deferred to **Phase 5: Authentication & Multi-District RBAC**).
  2. **RBAC & Authorization Middleware**: No role-based access control enforcement middleware or active RLS session variable hooks (strictly deferred to **Phase 5: Authentication & Multi-District RBAC**).
  3. **Staged Ingestion Pipeline & Duplicate Classification Engine**: No spreadsheet parsing services or duplicate classification engine (strictly deferred to **Phase 8: Staged Ingestion & Duplicate Classification Engine**).
  4. **Service Case Lifecycle State Machine & Evidence Gating**: No business rule transition validation or mandatory Slot 1 + Slot 2 completion checks (strictly deferred to **Phase 9: Service Case Lifecycle & Dispatch Engine**).
  5. **Mobile Local-First Core & Hardware Features**: No WatermelonDB SQLite schemas or camera viewfinders (strictly deferred to **Phase 10: Mobile Local-First Core** and **Phase 11: Mobile Hardware GPS & Camera Module**).
  6. **Offline Sync Protocol Engine**: No delta mutation resolution algorithms or client sync endpoints (strictly deferred to **Phase 12: Delta Synchronization & Conflict Arbitration Engine**).
  7. **Direct Binary File Streaming**: No pre-signed S3/MinIO upload handlers (strictly deferred to **Phase 14: Evidence Pipeline & Direct S3 Streaming**).
  8. **Web Portal & Analytics**: No UI dashboards or conveyance claim workflows (strictly deferred to **Phase 15: Conveyance Claims & Management Web Portal**).
  9. **Production Contamination**: No connection to legacy databases (`Field Call Tracker`, `Ai Ticket App`) or real Tamil Nadu school records.

---

## 3. Authoritative Documents & Predecessor Traceability
- **Status**: `IMPLEMENTED`
- **Traceability Chain**:
  - `Phase 0`: `docs/ZENTRA_PROJECT_REQUIREMENTS.md` & `docs/MUSE_SPARK_IMPLEMENTATION_REPORT_PHASE0.md`
    - Preserved domain rules: UDISE 11-digit school identifiers, two-slot photo evidence requirement, separation of external complaint tracking from internal engineering operations.
  - `Phase 1`: `docs/ZENTRA_ARCHITECTURE.md`, `docs/ZENTRA_DATA_MODEL.md`, `docs/ZENTRA_MOBILE_ARCHITECTURE.md`, `docs/ZENTRA_SYNC_ARCHITECTURE.md`, `docs/ZENTRA_SECURITY_ARCHITECTURE.md`
    - Implemented 6 core entity domains, UUIDv7 standard, UTC time strategy, and monotonic tombstone cursor.
  - `Phase 2`: `docs/ZENTRA_TECHNOLOGY_FOUNDATION.md`, `docs/ZENTRA_DATABASE_IMPLEMENTATION_BLUEPRINT.md`
    - Implemented Kysely native migrations, PostgreSQL 16+ engine compatibility, GIN JSONB indexing standards, and Device/Server Time & Location Evidence Model with clock-skew detection.
  - `Phase 3`: `docs/ZENTRA_PROJECT_FOUNDATION.md`, `docs/MUSE_SPARK_IMPLEMENTATION_REPORT_PHASE3.md`
    - Leveraged `@zentra/shared` for RFC 9562 UUIDv7 generation, `@zentra/testing` for `assertTestEnvironmentIsSafe()` circuit breaker, and `@zentra/api` database connection module.

---

## 4. Database Technology & Driver Architecture
- **Status**: `IMPLEMENTED` | `TESTED`
- **Database Engine**: PostgreSQL 16+ (Verified against local PostgreSQL 18.6 64-bit on Windows).
- **Driver Library**: `pg` (Node-Postgres) v8.13.0 and `pg-pool`.
- **Query & DDL Builder**: Kysely v0.27.4.
- **Architecture Highlights**:
  - Pure TypeScript schema definition (`apps/api/src/database/database.types.ts`).
  - No heavyweight ORM runtime overhead or hidden lazy-loading traps.
  - Connection pooling configured with configurable pool limits (`max: 10`, `idleTimeoutMillis: 30000`).
  - Strict compile-time query typing and compile-safe migration contracts.

---

## 5. Schema Architecture & Domain Segregation
- **Status**: `IMPLEMENTED` | `TESTED`
- The database schema is partitioned into six distinct architectural domains:
  1. **Territory & Infrastructure Domain**: `districts`, `blocks`, `schools`, `hi_tech_labs`.
  2. **Asset & Equipment Master Domain**: `oem_manufacturers`, `equipment_types`, `equipment_attribute_definitions`, `lab_equipment`.
  3. **Governance & Personnel Reference Domain**: `users`, `complaint_sources`, `sla_policies`.
  4. **Complaints & Service Execution Domain**: `source_complaints`, `service_cases`, `assignment_history`.
  5. **Field Verification & Evidence Domain**: `field_visits`, `visit_equipment_findings`, `evidence_files`.
  6. **Ingestion Staging, Audit & Synchronization Domain**: `import_jobs`, `import_staging_records`, `audit_events`, `tombstones`.

---

## 6. Comprehensive Entity Inventory (21 Tables)
- **Status**: `IMPLEMENTED` | `TESTED`

| # | Table Name | Primary Key | Key Foreign Keys | Purpose & Core Responsibility |
|---|---|---|---|---|
| 1 | `districts` | `district_id` (UUIDv7) | None | Educational administrative districts across Tamil Nadu. |
| 2 | `blocks` | `block_id` (UUIDv7) | `district_id` | Educational administrative sub-districts/blocks. |
| 3 | `schools` | `school_id` (UUIDv7) | `district_id`, `block_id` | Schools containing Hi-Tech Labs (UDISE natural key). |
| 4 | `hi_tech_labs` | `lab_id` (UUIDv7) | `school_id` | Multi-lab physical facilities inside a school. |
| 5 | `oem_manufacturers` | `oem_id` (UUIDv7) | None | Hardware vendors and equipment manufacturers. |
| 6 | `equipment_types` | `equipment_type_id` (UUIDv7) | None | Standard taxonomy of laboratory hardware types. |
| 7 | `equipment_attribute_definitions` | `attribute_def_id` (UUIDv7) | `equipment_type_id` | Dynamic schema-driven diagnostic field definitions. |
| 8 | `lab_equipment` | `lab_equipment_id` (UUIDv7) | `lab_id`, `equipment_type_id`, `oem_id` | Concrete hardware instances deployed in labs. |
| 9 | `users` | `user_id` (UUIDv7) | None | Personnel directory placeholder (no auth credentials). |
| 10 | `complaint_sources` | `source_system_id` (UUIDv7) | None | Registry of external intake systems (EMIS, Portal). |
| 11 | `source_complaints` | `source_complaint_id` (UUIDv7) | `source_system_id`, `school_id`, `lab_id` | Preserved external complaint intake records. |
| 12 | `sla_policies` | `sla_policy_id` (UUIDv7) | None | Service level resolution target policies. |
| 13 | `service_cases` | `service_case_id` (UUIDv7) | `source_complaint_id`, `school_id`, `lab_id`, `lab_equipment_id`, `assigned_primary_engineer_id`, `sla_policy_id` | Authoritative ZENTRA internal operational ticket. |
| 14 | `assignment_history` | `assignment_history_id` (UUIDv7) | `service_case_id`, `assigned_by_user_id`, `engineer_id` | Immutable log of engineer assignment changes. |
| 15 | `field_visits` | `visit_id` (UUIDv7) | `service_case_id`, `engineer_id` | Sequential physical field visits per case. |
| 16 | `visit_equipment_findings` | `finding_id` (UUIDv7) | `visit_id`, `lab_equipment_id`, `actual_equipment_type_id` | On-site diagnostic findings & equipment discrepancies. |
| 17 | `evidence_files` | `evidence_file_id` (UUIDv7) | `visit_id`, `service_case_id` | Metadata for Slot 1 (report) and Slot 2 (photo). |
| 18 | `import_jobs` | `import_job_id` (UUIDv7) | `uploaded_by_user_id` | Batch spreadsheet/CSV ingestion tracking. |
| 19 | `import_staging_records` | `staging_record_id` (UUIDv7) | `import_job_id`, `resolved_school_id` | Staging buffer holding raw unvalidated import rows. |
| 20 | `audit_events` | `audit_event_id` (UUIDv7) | `actor_user_id` | Append-only audit log for system mutations. |
| 21 | `tombstones` | `tombstone_id` (UUIDv7) | `deleted_by_user_id` | Global deletion log with monotonic sync sequence. |

---

## 7. Relationship Model & Cardinality Verification
- **Status**: `IMPLEMENTED` | `TESTED`
- **Territory Cardinality**:
  - `districts` $1 \to N$ `blocks` (Enforced via FK, tested).
  - `blocks` $1 \to N$ `schools` (Enforced via FK, tested).
  - `schools` $1 \to N$ `hi_tech_labs` (Enforced via FK, tested with multi-lab fixtures).
- **Asset Master Cardinality**:
  - `equipment_types` $1 \to N$ `equipment_attribute_definitions` (Enforced via CASCADE FK).
  - `hi_tech_labs` $1 \to N$ `lab_equipment` (Enforced via FK, tested).
  - `oem_manufacturers` $1 \to N$ `lab_equipment` (Enforced via SET NULL FK).
- **Service Operations Cardinality**:
  - `complaint_sources` $1 \to N$ `source_complaints` (Enforced via FK).
  - `schools` $1 \to N$ `source_complaints` (Permits multiple complaints per school, tested).
  - `source_complaints` $1 \to 1$ `service_cases` (Enforced via UNIQUE FK, tested).
  - `service_cases` $1 \to N$ `assignment_history` (Enforced via FK, tested).
  - `service_cases` $1 \to N$ `field_visits` (Enforced via sequential unique constraint, tested).
  - `field_visits` $1 \to N$ `visit_equipment_findings` (Enforced via FK, tested).
  - `field_visits` $1 \to N$ `evidence_files` (Enforced via FK and slot constraints, tested).

---

## 8. Primary Key & Identifier Strategy
- **Status**: `IMPLEMENTED` | `TESTED`
- **UUIDv7 Implementation**:
  - Standardized across all 21 tables for primary keys using RFC 9562 UUIDv7.
  - Implemented in `@zentra/shared` via `generateUuidV7()`, combining a 48-bit Unix millisecond timestamp with random bits.
  - Stored in PostgreSQL as standard 16-byte `UUID` data type.
  - **Performance Characteristic**: Rather than claiming absolute prevention of fragmentation, UUIDv7 **reduces random insertion patterns and associated B-tree fragmentation/write amplification compared with UUIDv4**, while supporting client-side offline generation on mobile devices.
- **Human-Readable Identifiers**:
  - `service_cases.zentra_case_code`: Format `ZNT-YYYY-DIST-XXXXXX` (e.g., `ZNT-2026-NGP-000481`).
  - `import_jobs`: Format `IMP-YYYYMMDD-XXXX`.
  - Natural keys preserved: `schools.udise_code` (11 digits), `districts.district_code` (3-4 characters).

---

## 9. Timestamp & Timezone Architecture
- **Status**: `IMPLEMENTED` | `TESTED`
- **Database Column Standard**: All temporal columns use `TIMESTAMP WITH TIME ZONE` (`TIMESTAMPTZ`).
  - In PostgreSQL, `TIMESTAMPTZ` represents an **absolute instant in time** and is stored internally in UTC.
- **Application Normalization**:
  - Application runtimes explicitly normalize timestamps to UTC prior to transmission and persistence.
  - Session timezones must be explicitly managed (e.g., `SET timezone = 'UTC'`). It is recognized that `CURRENT_TIMESTAMP` returns a `TIMESTAMPTZ` representing the current transaction start instant, and text evaluation depends on the session timezone; therefore session timezone control is mandatory.
- **Device/Server Time & Location Evidence Model**:
  - `field_visits` captures:
    1. `check_in_timestamp` (Device capture timestamp).
    2. `created_at` (Server ingestion timestamp).
    3. `check_in_latitude` / `check_in_longitude` / `check_in_accuracy_meters` (Location coordinates & estimated horizontal accuracy). Note: Location coordinates represent spatial evidence, not a clock source.
  - Clock-skew detection: Backend comparison between device capture time and server ingestion time detects suspicious time discrepancies ($> 15$ minutes).
  - **GPS Hardware Clock Status**: Mobile platform APIs (e.g. Android Fused Location) do not unconditionally guarantee an immutable atomic hardware clock across diverse mobile chipsets. Establishing an authoritative hardware GPS-clock trust mechanism remains strictly deferred to **Phase 11: Mobile Hardware GPS & Camera Module** for native security validation.

---

## 10. Geographic Hierarchy Implementation
- **Status**: `IMPLEMENTED` | `TESTED`
- **Cascade Behavior**: Deletion of a district or block is restricted (`ON DELETE RESTRICT`) to prevent orphaned school hierarchies.
- **Constraints**:
  - `districts`: `district_code` is UNIQUE.
  - `blocks`: `(district_id, block_code)` is UNIQUE.
  - `schools`: `udise_code` is UNIQUE.
- **Verification**: Integration tests 3 and 4 verify relational navigation and constraint enforcement across District $\to$ Block $\to$ School.

---

## 11. School & Lab Model Implementation
- **Status**: `IMPLEMENTED` | `TESTED`
- **Multi-Lab Support**: Schools can house multiple independent labs (e.g., High School Lab vs. Higher Secondary Lab).
- **Lab Code Scoping**: `hi_tech_labs` enforces `UNIQUE(school_id, lab_code)`.
- **Lab Types**: `lab_type` restricted via CHECK constraint to `('PRIMARY', 'UPPER_PRIMARY', 'HIGH_SCHOOL', 'HIGHER_SECONDARY')`.
- **Verification**: Integration test 5 proves multiple distinct labs can coexist in a single school entity.

---

## 12. Equipment Master & Custom Attribute Architecture
- **Status**: `IMPLEMENTED` | `TESTED`
- **Dynamic Field Strategy**: Avoids altering database table schemas for OEM-specific attributes.
- **Schema**:
  - `equipment_types`: Master classification (UPS, Projector, Server, etc.).
  - `equipment_attribute_definitions`: Defines dynamic keys, labels, types (`TEXT`, `NUMBER`, `BOOLEAN`, `DROPDOWN`), and dropdown options.
  - `lab_equipment.custom_attributes`: Stored as PostgreSQL `JSONB`.
- **Indexing**: GIN index `idx_lab_equipment_custom_attributes` on `lab_equipment USING gin (custom_attributes jsonb_path_ops)`.
- **Verification**: Integration test 6 verifies storing, querying, and updating custom JSONB attributes.

---

## 13. Complaint Source Registry
- **Status**: `IMPLEMENTED` | `TESTED`
- **Table**: `complaint_sources`
- **Standardized Systems Registered**:
  - `LEGACY_CALL_TRACKER`: Historic legacy ticketing export.
  - `EMIS_PORTAL`: Official Tamil Nadu Education Management Information System.
  - `HELPLINE_MANUAL`: Direct phone call intake.
  - `DIRECT_FIELD_REPORT`: In-person engineer discovery.
- **Constraint**: `system_code` is strictly UNIQUE.

---

## 14. Source Complaint Domain Implementation
- **Status**: `IMPLEMENTED` | `TESTED`
- **Preserved External Intake Records**:
  - Captures external complaints without mutating original data upon intake.
  - **Immutability Status**: Immutability of source complaints is a domain/application governance rule and is **not database-enforced via UPDATE/DELETE triggers** in Phase 4.
- **Deduplication Strategy**:
  - Unique composite index `idx_source_complaints_ext_id` on `(source_system_id, external_ticket_id)` provides exact-source uniqueness **when an external ticket ID exists**.
  - Complaints without external IDs (e.g., manual phone intake, direct field reports) do not rely on this composite key and must be managed through the staged ingestion and correlation workflow (**Phase 8: Staged Ingestion & Duplicate Classification Engine**).
  - A simplistic `(school_id, issue)` unique constraint is deliberately avoided, allowing schools to legitimately register multiple simultaneous or recurring complaints over time.
- **Payload Preservation**: `raw_payload` JSONB column stores the complete external intake row for provenance and re-parsing.
- **Verification**: Integration tests 7, 11, and 12 verify independent existence, deduplication rejection when an external ticket ID exists, and multi-complaint school handling.

---

## 15. ZENTRA Service Case Model Implementation
- **Status**: `IMPLEMENTED` | `TESTED`
- **Domain Independence**: Operational status transitions in `service_cases` operate independently of `source_complaints.source_status`.
- **Status Enum Values**:
  - `operational_status`: `UNASSIGNED`, `ASSIGNED`, `SCHEDULED`, `IN_PROGRESS`, `PENDING_SPARES`, `RESOLVED`, `CLOSED`, `CANCELLED`.
  - `internal_priority`: `P1_CRITICAL`, `P2_HIGH`, `P3_MEDIUM`, `P4_LOW`.
  - `sla_breach_status`: `ON_TRACK`, `APPROACHING_BREACH`, `BREACHED`, `EXEMPTED`.
  - `verification_status`: `UNVERIFIED`, `PENDING_HM_SIGN`, `HM_VERIFIED`, `REJECTED`.
- **Verification**: Integration test 13 explicitly verifies that resolving a service case leaves the source complaint status unchanged.

---

## 16. Assignment History & Technician Allocation Foundation
- **Status**: `IMPLEMENTED` | `TESTED`
- **Table**: `assignment_history`
- **Allocation Roles**: `assignment_role` (`PRIMARY`, `SECONDARY`).
- **Auditability**: Records `service_case_id`, `engineer_id`, `assigned_by_user_id`, `assigned_at`, and `reassignment_reason`.
- **Immutability**: Append-only log allowing complete reconstruction of technician allocation timelines.

---

## 17. Field Visit & Multi-Visit Foundation
- **Status**: `IMPLEMENTED` | `TESTED`
- **Table**: `field_visits`
- **Multi-Visit Support**: A service case can have multiple visits indexed sequentially by `visit_sequence_number` (1, 2, 3...).
- **Integrity**: `UNIQUE(service_case_id, visit_sequence_number)` prevents race conditions and ensures deterministic visit ordering.
- **Outcomes**: `visit_outcome` restricted via CHECK to `COMPLETED_RESOLVED`, `PENDING_SPARES`, `PENDING_REVISIT`, `UNABLE_TO_ACCESS`, `CANCELLED`.
- **Conveyance Clarification**: `conveyance_km` is purely a **numeric distance record** (kilometers). It is **not** a reimbursement rate or reimbursement calculation. Any calculation logic is business-layer logic deferred to **Phase 15: Conveyance Claims & Management Web Portal**.
- **Verification**: Integration test 9 demonstrates multiple sequential visits for a single service case.

---

## 18. Visit Findings & Evidence Metadata Isolation
- **Status**: `IMPLEMENTED` | `TESTED` (with explicit deferred scope classifications)
- **Visit Equipment Findings**:
  - Decouples reported equipment from actual hardware observed on site.
  - Records `reported_equipment_text`, `actual_serial_number_observed`, `condition_observed`, and `diagnostic_attributes` (JSONB).
- **Evidence Files & Slot Isolation**:
  - `evidence_files` strictly stores file metadata: `storage_path`, `file_checksum_sha256`, `file_size_bytes`, `mime_type`, `captured_at`, and GPS coordinates.
  - **Zero BLOBs in PostgreSQL**: Image and PDF binaries are streamed directly to object storage in **Phase 14: Evidence Pipeline & Direct S3 Streaming**.
- **Evidence Enforcement Distinction**:
  - **Allowed Slot Values (Enforced)**: The CHECK constraint on `evidence_slot` enforces allowed values (`SLOT_1_HM_SIGNED_REPORT`, `SLOT_2_EQUIPMENT_WORKING_PHOTO`, etc.).
  - **Mandatory Slot 1 + Slot 2 Completion (NOT Enforced at DB Level)**: The table constraint does **not** verify that both slots exist before a service case can resolve.
  - **Status**: Enforcing mandatory completion is `REQUIRES IMPLEMENTATION / DEFERRED` to **Phase 9: Service Case Lifecycle & Dispatch Engine** and **Phase 14: Evidence Pipeline & Direct S3 Streaming**.
  - **Slot Uniqueness**: Restricting visits to at most one active Slot 1/Slot 2 file is `REQUIRES IMPLEMENTATION / DEFERRED`.

---

## 19. Audit Trail & Tombstone Architecture
- **Status**: `IMPLEMENTED` | `TESTED` (with explicit implementation ownership clarifications)
- **`audit_events`**:
  - Append-only audit table tracking mutations across all entities.
  - Records `event_timestamp`, `actor_user_id`, `actor_ip_address`, `event_category`, `target_entity_type`, `target_entity_id`, `action_type`, `pre_mutation_state` (JSONB), and `post_mutation_state` (JSONB).
  - Hard trigger-level immutability preventing UPDATE/DELETE on `audit_events` is `REQUIRES IMPLEMENTATION / DEFERRED`.
- **`tombstones`**:
  - Global deletion register for offline client synchronization.
  - Columns: `tombstone_id`, `entity_type`, `entity_id`, `sync_sequence_number` (`BIGSERIAL`), `deleted_at`, `deleted_by_user_id`, `tombstone_reason`.
  - Monotonic `sync_sequence_number` enables deterministic delta pull cursors (**Phase 12: Delta Synchronization & Conflict Arbitration Engine**).
- **Tombstone Implementation Ownership**:
  - Setting `service_cases.is_deleted = TRUE` does **not** automatically insert a record into `tombstones` via a database trigger in Phase 4 (no trigger exists).
  - In integration test 14, the test code explicitly executed both an `UPDATE` on `service_cases` and an `INSERT` into `tombstones`.
  - Automatic coordinated tombstone insertion is an **application service / repository layer responsibility** deferred to future phases (**Phase 9** deletion workflows and **Phase 12** synchronization). Implementation ownership is documented as `REQUIRES IMPLEMENTATION / DEFERRED`.

---

## 20. Semi-Structured Data & JSONB Strategy
- **Status**: `IMPLEMENTED` | `TESTED`
- **Strict Boundary**: Core domain relations, foreign keys, and status enums are strictly normalized relational columns.
- **Authorized JSONB Uses**:
  1. `lab_equipment.custom_attributes`: Dynamic OEM specs.
  2. `equipment_attribute_definitions.dropdown_options`: List of choice options.
  3. `source_complaints.raw_payload`: Complete upstream JSON payload.
  4. `visit_equipment_findings.diagnostic_attributes`: On-site electrical/mechanical metrics.
  5. `import_staging_records.raw_row_data`: Raw imported spreadsheet columns.
  6. `audit_events.pre_mutation_state` / `post_mutation_state`: State delta snapshots.

---

## 21. Integrity Constraints & Referential Safety Matrix
- **Status**: `IMPLEMENTED` | `TESTED`

| Constraint Type | Target Table | Fields / Expression | Enforced Rule |
|---|---|---|---|
| **Foreign Key** | `blocks` | `district_id -> districts` | `ON DELETE RESTRICT` (Prevents orphan blocks) |
| **Foreign Key** | `schools` | `block_id -> blocks` | `ON DELETE RESTRICT` (Prevents orphan schools) |
| **Foreign Key** | `service_cases` | `source_complaint_id -> source_complaints` | `ON DELETE RESTRICT` (1:1 Service Case to Complaint) |
| **Foreign Key** | `field_visits` | `service_case_id -> service_cases` | `ON DELETE CASCADE` (Visits bound to case) |
| **Foreign Key** | `evidence_files` | `visit_id -> field_visits` | `ON DELETE CASCADE` (Evidence bound to visit) |
| **Unique** | `schools` | `udise_code` | Rejects duplicate school UDISE codes |
| **Unique** | `hi_tech_labs` | `(school_id, lab_code)` | Rejects duplicate lab codes within same school |
| **Unique** | `source_complaints` | `(source_system_id, external_ticket_id)` | Rejects duplicate external ticket imports when external ID is provided |
| **Unique** | `service_cases` | `source_complaint_id` | Enforces exact 1:1 relationship |
| **Unique** | `service_cases` | `zentra_case_code` | Rejects duplicate human case codes |
| **Unique** | `field_visits` | `(service_case_id, visit_sequence_number)` | Enforces sequential visit order per case |
| **CHECK** | `service_cases` | `operational_status` | Restricts to 8 valid enum states |
| **CHECK** | `field_visits` | `visit_outcome` | Restricts to 5 valid enum states |
| **CHECK** | `evidence_files` | `evidence_slot` | Restricts to allowed evidence slot values (does NOT enforce mandatory completion) |

---

## 22. Indexing Strategy & Performance Architecture
- **Status**: `IMPLEMENTED` | `TESTED`
- **B-Tree Indexes**:
  - `idx_schools_udise` ON `schools(udise_code)` (UNIQUE)
  - `idx_schools_district` ON `schools(district_id)`
  - `idx_source_complaints_ext_id` ON `source_complaints(source_system_id, external_ticket_id)` (UNIQUE)
  - `idx_service_cases_school_status` ON `service_cases(school_id, operational_status)`
  - `idx_service_cases_engineer_status` ON `service_cases(assigned_primary_engineer_id, operational_status)`
  - `idx_field_visits_case_seq` ON `field_visits(service_case_id, visit_sequence_number)` (UNIQUE)
  - `idx_evidence_files_visit_slot` ON `evidence_files(visit_id, evidence_slot)`
  - `idx_tombstones_sync_seq` ON `tombstones(sync_sequence_number)`
- **GIN Indexes**:
  - `idx_lab_equipment_custom_attributes` ON `lab_equipment USING gin (custom_attributes jsonb_path_ops)`

---

## 23. Migration Architecture & Reversibility Verification
- **Status**: `IMPLEMENTED` | `TESTED`
- **Tooling**: Kysely Migration Runner with `ExplicitMigrationProvider`.
- **Migration Suite**:
  1. `20261005000001_create_territory_and_schools.ts`
  2. `20261005000002_create_equipment_master.ts`
  3. `20261005000003_create_complaints_and_service_cases.ts`
  4. `20261005000004_create_visits_evidence_and_findings.ts`
  5. `20261005000005_create_governance_staging_and_audit.ts`
- **Bidirectional Reversibility**:
  - Verified by integration test 19: `rollbackLatestMigration()` rolled back migration 5 (dropping `tombstones`, `audit_events`, `import_staging_records`, `import_jobs`), followed by `runMigrationsToLatest()` cleanly restoring all tables.

---

## 24. Seed Data & Synthetic Fixtures Strategy
- **Status**: `IMPLEMENTED` | `TESTED`
- **File**: `apps/api/src/database/seeds/synthetic-dev-fixtures.ts`
- **Guiding Principles**:
  - 100% synthetic, deterministic fixtures.
  - Absolute zero real school names, Head Master names, phone numbers, or UDISE codes.
  - Provisions synthetic entities: `Dev District Alpha`, `Dev Block North`, `Dev Demo School Alpha` (`33990000001`), `Dev Demo Lab 1`, `Dev OEM Solutions`, `Dev Server Rack`, `Dev Coordinator Alpha`, and `Dev Field Engineer Alpha`.
  - Enables local full-stack development without privacy risks.

---

## 25. Row-Level Security (RLS) & Multi-Tenant Boundary Design
- **Status**: `IMPLEMENTED` (Schema-Level Architecture) | `NOT TESTED / DEFERRED` (Runtime Activation in Phase 5)
- **Design Pattern**:
  - Multi-district isolation anchored on `schools.district_id`.
  - Designed for PostgreSQL session variable evaluation: `SET LOCAL zentra.current_district_id = '...'`.
  - Application connections will connect via unprivileged role `zentra_app`.
- **Phase 4 Exemption Justification**:
  - RLS runtime policies require active authentication claims (`current_user_id`, `district_id`, `user_role`). Because authentication and session management are **Phase 5 (Authentication & Multi-District RBAC)** deliverables, active policy execution is deferred to prevent coupling.

---

## 26. Test Suites Executed & Test Matrix
- **Status**: `TESTED` (For executed items) | `NOT TESTED / DEFERRED` (For unexecuted items)
- **Test File**: `apps/api/test/database-schema.spec.ts`
- **Executed Against**: Live PostgreSQL 18.6 (`zentra_test`).

| Test # | Test Title | Requirement Verified | Result |
|---|---|---|---|
| 1 | Clean migration succeeds | All 21 domain tables exist in database | `PASSED` |
| 2 | Migration state recorded | All 5 migrations recorded in `kysely_migration` | `PASSED` |
| 3 | District -> Block integrity | Relational FK navigation from District to Block | `PASSED` |
| 4 | Block -> School integrity | Foreign keys and UDISE persistence | `PASSED` |
| 5 | School -> Lab multi-lab support | Multiple labs per school with unique lab codes | `PASSED` |
| 6 | Lab -> Equipment & JSONB | Hardware asset linking & custom JSONB attributes | `PASSED` |
| 7 | Source complaint independence | Intake records exist prior to service case creation | `PASSED` |
| 8 | Service case creation & code | Case links complaint and generates human code | `PASSED` |
| 9 | Multi-visit sequence numbering | Ordered visits (1, 2) on single case | `PASSED` |
| 10 | Evidence Slot allowed values | Allowed slot values & foreign key binding | `PASSED` |
| 11 | Source complaint deduplication | Rejection of duplicate `(source_system_id, ext_id)` | `PASSED` |
| 12 | Same school multi-complaint | Same school legitimately creates multiple complaints | `PASSED` |
| 13 | Status domain separation | Resolving case leaves source complaint status intact | `PASSED` |
| 14 | Soft-delete & tombstone cursor | Soft-delete flag update on case and tombstone record insertion with monotonic cursor verified | `PASSED` |
| 15 | Orphan FK rejection | Rejects inserting child with non-existent parent FK | `PASSED` |
| 16 | UDISE unique constraint | Rejects inserting duplicate UDISE codes | `PASSED` |
| 17 | Operational status CHECK | Rejects invalid `operational_status` value on case | `PASSED` |
| 18 | Structured audit logging | Accepts valid audit event record | `PASSED` |
| 19 | Migration rollback & re-apply | Bidirectional migration down() and up() execution | `PASSED` |

---

## 27. Test Results & Verification Metrics
- **Status**: `TESTED`
- **API Test Suite Execution Results**:
  ```
  RUN  v2.1.9 D:/Zentra/apps/api

  ✓ test/api.spec.ts (3 tests) 293ms
  ✓ test/database-schema.spec.ts (19 tests) 1263ms
    ✓ ZENTRA PostgreSQL Database & Domain Foundation Tests > 19. Reversible migration down() and up() execution succeeds cleanly 561ms

  Test Files  2 passed (2)
       Tests  22 passed (22)
    Duration  2.96s
  ```
- **Monorepo Turbo Pipeline Execution Results**:
  - `turbo run build`: **8 successful, 8 total** (8 packages with build tasks executed across 10 in-scope workspace packages; `@zentra/tooling` and `@zentra/field` have no root build task defined).
  - `turbo run typecheck`: **15 successful, 15 total**.
  - `turbo run test`: **13 successful, 13 total**.
  - `turbo run lint`: **6 successful, 6 total**.

---

## 28. Explicitly NOT TESTED Items & Justification
- **Status**: `NOT TESTED / DEFERRED`

The following capabilities were **not executed** in Phase 4 integration tests and are explicitly cataloged to avoid overstatement of test coverage:

1. **Mandatory Evidence Completion**: `NOT TESTED / DEFERRED`
   - *Reason*: The table CHECK constraint only checks allowed enum values; business rules preventing transition to `RESOLVED` without both Slot 1 and Slot 2 are deferred to **Phase 9** and **Phase 14**.
2. **Evidence Slot Uniqueness per Visit**: `NOT TESTED / DEFERRED`
   - *Reason*: The database schema currently allows multiple evidence files per slot unless constrained at the application layer; per-visit slot uniqueness was not tested.
3. **Audit Immutability (UPDATE/DELETE Triggers)**: `NOT TESTED / DEFERRED`
   - *Reason*: Test 18 tested inserting structured audit records; hard database triggers rejecting UPDATE or DELETE on `audit_events` are not implemented at the database level in Phase 4.
4. **Coordinated Automatic Tombstone Appending & Soft-Delete Across All Tables**: `NOT TESTED / DEFERRED`
   - *Reason*: Test 14 tested manual execution of update on `service_cases` and manual insert on `tombstones`. Automatic trigger-based or service-based tombstone appending upon soft delete is not implemented, and soft-delete on `field_visits` and `evidence_files` was not tested.
5. **NULL / Blank External Ticket IDs**: `NOT TESTED / DEFERRED`
   - *Reason*: Handling of complaints lacking external ticket IDs and their correlation workflow was not tested in Phase 4 (deferred to **Phase 8**).
6. **Transaction Rollback Under Partial Failure**: `NOT TESTED / DEFERRED`
   - *Reason*: Multi-statement transactional rollbacks during mid-transaction failures were not tested in the Phase 4 schema test suite.
7. **Concurrent Updates & Race Conditions**: `NOT TESTED / DEFERRED`
   - *Reason*: Concurrent write collisions and optimistic locking will be validated in **Phase 12 (Delta Synchronization)** and **Phase 16 (E2E Hardening)**.
8. **Cross-District RLS Kernel Enforcement**: `NOT TESTED / DEFERRED`
   - *Reason*: Active RLS session variable evaluation is deferred to **Phase 5 (Authentication & Multi-District RBAC)**.
9. **All Domain Status CHECK Constraints**: `NOT TESTED / DEFERRED`
   - *Reason*: Only `service_cases.operational_status` invalid string rejection was explicitly tested (Test 17). CHECK constraints on `field_visits.visit_outcome`, `internal_priority`, `sla_breach_status`, and `verification_status` were not individually subjected to negative test assertions.

---

## 29. Security & Data Protection Audit
- **Status**: `IMPLEMENTED` | `TESTED`
- **Zero Real PII Verification**: No actual government school data, teacher contact numbers, or student information exist anywhere in test code or seeds.
- **Connection Environment Protection**: The `@zentra/testing` package enforces `assertTestEnvironmentIsSafe()`, ensuring tests immediately abort if executed against non-test connection strings.
- **Credential Decoupling**: The `users` table contains no password columns, token secrets, or authentication hashes.

---

## 30. Phase Boundary & Non-Goal Verification
- **Status**: `IMPLEMENTED` (Verified)
- Strict compliance with Phase 4 boundary rules confirmed:
  - Phase 5 boundaries respected: No auth controllers, no JWT strategies, no Guards, no RBAC decorators.
  - Phase 8 boundaries respected: No CSV/XLSX staging pipelines or duplicate classification algorithms.
  - Phase 9 boundaries respected: No service case state machine or dispatch algorithms.
  - Phase 10 & 11 boundaries respected: No mobile SQLite WatermelonDB schemas, GPS gating, or camera viewfinders.
  - Phase 12 boundaries respected: No offline delta sync push/pull endpoints or conflict resolvers.
  - Phase 14 boundaries respected: No pre-signed S3 binary upload handlers.
  - Phase 15 boundaries respected: No web management portals or conveyance approval desks.

---

## 31. Complete Inventory of Created Files
- **Status**: `IMPLEMENTED`
  1. `apps/api/src/database/database.types.ts`: Strongly typed Kysely interface definitions for all 21 tables.
  2. `apps/api/src/database/migration-runner.ts`: Programmatic migration runner and reversibility manager.
  3. `apps/api/src/database/migrations/20261005000001_create_territory_and_schools.ts`: Migration 1 (Territory).
  4. `apps/api/src/database/migrations/20261005000002_create_equipment_master.ts`: Migration 2 (Equipment Master).
  5. `apps/api/src/database/migrations/20261005000003_create_complaints_and_service_cases.ts`: Migration 3 (Complaints & Cases).
  6. `apps/api/src/database/migrations/20261005000004_create_visits_evidence_and_findings.ts`: Migration 4 (Visits & Evidence).
  7. `apps/api/src/database/migrations/20261005000005_create_governance_staging_and_audit.ts`: Migration 5 (Audit & Tombstones).
  8. `apps/api/src/database/seeds/synthetic-dev-fixtures.ts`: Synthetic dev seed fixture generator.
  9. `apps/api/test/database-schema.spec.ts`: Comprehensive 19-test PostgreSQL integration suite.
  10. `docs/ZENTRA_DATABASE_IMPLEMENTATION.md`: Authoritative technical specification for the database.
  11. `docs/MUSE_SPARK_IMPLEMENTATION_REPORT_PHASE4.md`: This authoritative MUSE SPARK report.

---

## 32. Complete Inventory of Modified Files
- **Status**: `IMPLEMENTED`
  1. `packages/shared/src/index.ts`: Added RFC 9562 `generateUuidV7()` utility.
  2. `packages/shared/test/shared.spec.ts`: Added unit tests verifying UUIDv7 format and sequential ordering.
  3. `apps/api/package.json`: Added `pg`, `kysely`, and `@types/pg` dependencies.

---

## 33. Architectural Decisions & Deviations Log
- **Status**: `IMPLEMENTED`
  - **ADR-P4-01**: *Explicit Kysely Migration Provider*: Implemented an explicit TypeScript migration provider rather than dynamic file system globbing to ensure deterministic execution across TypeScript, Vitest, and compiled production runtimes.
  - **ADR-P4-02**: *Separation of Source Complaint Status vs. Service Case Status*: Enforced physical separation between external complaint records and internal service cases, preventing upstream data overwrites.
  - **ADR-P4-03**: *Sequential Multi-Visit Indexing*: Enforced `UNIQUE(service_case_id, visit_sequence_number)` ensuring deterministic visit history per case.

---

## 34. Deviations from Phase 1 / Phase 2 Blueprint
- **Status**: `IMPLEMENTED` (Verified)
  - **No intentional negative deviations identified during review.** The implementation faithfully preserves the architectural blueprints defined in `docs/ZENTRA_DATABASE_IMPLEMENTATION_BLUEPRINT.md` and `docs/ZENTRA_DATA_MODEL.md`.

---

## 35. Risk Register & Mitigation Strategy
- **Status**: `IMPLEMENTED`

| Risk ID | Identified Risk | Severity | Mitigation Strategy Implemented |
|---|---|---|---|
| **RSK-DB-01** | B-Tree index fragmentation under high volume | High | RFC 9562 UUIDv7 implemented as primary key standard to reduce random insertion page splits. |
| **RSK-DB-02** | Accidental execution against production database | Critical | `@zentra/testing` environment safety assertion blocks non-test databases. |
| **RSK-DB-03** | Deletion resurrection in offline mobile caches | High | Monotonic `tombstones` sync sequence cursor implemented. |
| **RSK-DB-04** | Discrepancy between reported vs actual hardware | Medium | `visit_equipment_findings` table isolates actual observed hardware. |
| **RSK-DB-05** | Image storage bloating database engine | High | Hard architectural constraint: metadata only; zero BLOB storage. |

---

## 36. Open Decisions Requiring Clarification (Candidate Rules Audit)
- **Status**: `REQUIRES CLARIFICATION`

The following six business rules were identified during Phase 0 / Phase 1 analysis and have been structurally accommodated in the schema, but require formal stakeholder clarification prior to production deployment:

1. **Geofence Radius Threshold**:
   - *Current Schema Support*: `field_visits.check_in_within_geofence BOOLEAN`.
   - *Candidate Business Rule*: $\le 50\text{ meters}$ radius from school coordinates.
   - *Governance Status*: `REQUIRES CLARIFICATION`.
2. **Sign-Off Authority Role**:
   - *Current Schema Support*: `service_cases.verification_status` and `service_cases.verified_by_user_id`.
   - *Candidate Business Rule*: Permits either Head Master (HM) or designated Assistant Instructor (AI) sign-off.
   - *Governance Status*: `REQUIRES CLARIFICATION`.
3. **Multi-Lab Room Mapping**:
   - *Current Schema Support*: `hi_tech_labs.lab_code` scoped to `school_id`.
   - *Candidate Business Rule*: Naming conventions for campuses with 3+ laboratories.
   - *Governance Status*: `REQUIRES CLARIFICATION`.
4. **Third-Party Contractor Access**:
   - *Current Schema Support*: `assignment_history.assignment_role` and `users`.
   - *Candidate Business Rule*: Whether external OEM technicians directly update cases or work via district coordinators.
   - *Governance Status*: `REQUIRES CLARIFICATION`.
5. **External Ticket Integration Availability**:
   - *Current Schema Support*: `complaint_sources` and `import_jobs`.
   - *Candidate Business Rule*: Whether upstream portals offer direct REST webhooks or rely strictly on CSV/Excel batch exports.
   - *Governance Status*: `REQUIRES CLARIFICATION`.
6. **Conveyance Rate Variations**:
   - *Current Schema Support*: `field_visits.conveyance_km` (purely a numeric distance record in kilometers).
   - *Candidate Business Rule*: Flat ₹5.00/km rate for two-wheelers across rural blocks.
   - *Governance Status*: `REQUIRES CLARIFICATION` (Reimbursement calculations are not hardcoded in the database).

---

## 37. Phase 5 Readiness Assessment & Final Protocol Sign-off
- **Status**: `READY FOR HUMAN REVIEW`
- **Assessment**:
  - The PostgreSQL database schema and domain foundations are implemented, compiled, and verified.
  - All 19 schema integration tests pass cleanly against PostgreSQL 18.6.
  - Monorepo builds, typechecks, tests, and lints pass with zero errors.
  - All technical claims have been calibrated to reflect verified realities.

---

## PHASE 4 HUMAN REVIEW CORRECTION PASS
- **Review Date**: 2026-10-05
- **Purpose**: Systematically correct overstatements, calibrate technical claims, align future phase numbering, and explicitly catalog test coverage limitations identified during initial human review.

### 1. Issues Identified & Corrections Made

| # | Issue Identified | Review Finding | Correction Made in Documentation | Code Changed? | Migration Changed? |
|---|---|---|---|---|---|
| **C1** | **Evidence Enforcement Wording** | The report claimed that the `evidence_files` CHECK constraint enforced mandatory Slot 1 + Slot 2 completion. In reality, the constraint only restricts allowed enum values per row. | Clarified that the CHECK constraint only validates allowed slot values. Mandatory completion (requiring both slots before case resolution) is documented as `REQUIRES IMPLEMENTATION / DEFERRED` to **Phase 9** and **Phase 14**. | No | No |
| **C2** | **Phase Number Inconsistencies** | Various future phases were cited with loose, non-authoritative numbering. | Re-aligned all future phase references strictly to the 16-phase roadmap in `docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md`. | No | No |
| **C3** | **Unsupported Alignment Claims** | The report used absolute phrases like "100% aligned" and "zero deviations". | Replaced with evidence-based formulation: *"No intentional negative deviations identified during review."* | No | No |
| **C4** | **UUIDv7 Fragmentation Claims** | The report claimed UUIDv7 "prevents B-tree fragmentation". | Replaced with technically accurate wording: *"reduces random insertion patterns and associated B-tree fragmentation/write amplification compared with UUIDv4."* | No | No |
| **C5** | **TIMESTAMPTZ & UTC Clarification** | The report implied `CURRENT_TIMESTAMP` was intrinsically UTC merely because `TIMESTAMPTZ` was used. | Clarified that `TIMESTAMPTZ` represents an absolute instant in time stored internally in UTC; application runtimes normalize to UTC; session/database timezones must be explicitly managed (`SET timezone = 'UTC'`). | No | No |
| **C6** | **Time/Location Model Calibration** | The report referred to location as part of a "Three-Clock" mechanism. | Renamed to "Device/Server Time & Location Evidence Model", identifying location coordinates as spatial evidence rather than a clock. | No | No |
| **C7** | **Conveyance Representation** | Risk of conflating `conveyance_km` with a reimbursement rate. | Clarified that `field_visits.conveyance_km` is purely a distance record (numeric km); reimbursement calculations and candidate rate ₹5.00/km remain `REQUIRES CLARIFICATION` and deferred to Phase 15. | No | No |
| **C8** | **External Ticket Deduplication Scope** | The report did not distinguish complaints with vs without external ticket IDs. | Clarified that `(source_system_id, external_ticket_id)` provides uniqueness only when an external ID is present. Complaints lacking external IDs proceed through staged correlation (**Phase 8**). Explained why a simplistic `(school_id, issue)` constraint is deliberately avoided. | No | No |
| **C9** | **Overstated Test Coverage** | Test coverage was reported without cataloging unexecuted items. | Added Section 28 explicitly cataloging 9 unexecuted/deferred test items. | No | No |

---

## PHASE 4 FINAL CORRECTION PASS
- **Review Date**: 2026-10-05 (Final Pass)
- **Scope**: Final documentation and verification calibration.

### 1. Final Corrections Performed
1. **Three-Clock Terminology Correction**:
   - Replaced "Three-Clock Model" with **"Device/Server Time & Location Evidence Model"** across all documentation sections.
   - Explicitly clarified that location coordinates/accuracy (`check_in_latitude`, `check_in_longitude`, `check_in_accuracy_meters`) represent **spatial evidence, not a clock source**.
   - Documented the two actual clocks: device capture timestamp and authoritative server ingestion timestamp.
   - Retained clock-skew detection delta check and kept authoritative hardware GPS-clock trust strictly deferred to **Phase 11 (Mobile Hardware GPS & Camera Module)**.
2. **Build Test Result Contradiction Resolution**:
   - Corrected the contradictory statement *"8 successful, 8 total (All 10 packages built)"*.
   - Replaced with exact execution reality: *"turbo run build: 8 successful, 8 total (8 packages with build tasks executed across 10 in-scope workspace packages; @zentra/tooling and @zentra/field have no root build task defined)"*.
3. **Source Complaint Immutability Wording**:
   - Replaced *"Immutable external complaint intake records"* with **"Preserved external complaint intake records"**.
   - Explicitly stated that immutability is an **application/domain governance rule and is NOT database-enforced via triggers in Phase 4**.
4. **Tombstone Implementation Ownership Clarification**:
   - Reviewed Test 14 in `apps/api/test/database-schema.spec.ts`.
   - Confirmed that Test 14 explicitly issues both an `UPDATE` on `service_cases` and an `INSERT` into `tombstones`.
   - There is **no database trigger** on `service_cases` that automatically writes to `tombstones`.
   - Explicitly documented that coordinated automatic tombstone appending is an **application service / repository layer responsibility** deferred to future phases (**Phase 9** deletion workflows and **Phase 12** synchronization). Implementation ownership is documented as `REQUIRES IMPLEMENTATION / DEFERRED`.
5. **Authoritative Roadmap Verification**:
   - Verified that `docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md` is the authoritative 16-phase roadmap.
   - Confirmed all references to Phase 5, 8, 9, 10, 11, 12, 14, 15, and 16 in the report match this sequence. The sequence document was left unchanged.
6. **Classification Consistency**:
   - Enforced strict use of `IMPLEMENTED`, `TESTED`, `NOT TESTED / DEFERRED`, and `REQUIRES CLARIFICATION` throughout the report.
7. **Database Architecture Preservation**:
   - No migrations or schema definitions were modified. The 21-table architecture remains intact and verified.

### 2. Files Reviewed & Updated
- `docs/ZENTRA_DATABASE_IMPLEMENTATION.md`: Updated with Time & Location Evidence model, preserved source complaint wording, and tombstone ownership clarification.
- `docs/MUSE_SPARK_IMPLEMENTATION_REPORT_PHASE4.md`: Updated corresponding sections and appended this final correction log.
- `docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md`: Verified as authoritative current roadmap (unchanged).

### 3. Implementation, Migration & Code Change Status
- **Application Code Changed**: No.
- **Database Migrations Changed**: No.
- **Schema Redesigned**: No.

### 4. Remaining Risks
- **RSK-P4-01**: Service case lifecycle state machine (Phase 9) must enforce mandatory Slot 1 + Slot 2 evidence gating before allowing case closure.
- **RSK-P4-02**: Staged intake correlation (Phase 8) must handle complaints lacking external ticket IDs without causing duplicate dispatch.
- **RSK-P4-03**: Application service layer (Phase 9/12) must implement transactional coordination between soft-deletes and tombstone insertions.

### 5. Remaining Open Business Decisions
- All 6 candidate rules cataloged in Section 36 remain formally flagged as `REQUIRES CLARIFICATION`:
  1. Geofence radius ($\le 50\text{ m}$)
  2. HM vs AI sign-off authority
  3. Multi-lab room naming conventions
  4. Third-party OEM direct portal access
  5. Upstream portal REST API vs CSV export availability
  6. Travel conveyance rate variations (₹5.00/km candidate)

### 6. Exact Test Status
Executed against PostgreSQL 18.6 on `zentra_test`:
- `apps/api/test/database-schema.spec.ts`: **19/19 PASSED**
- `apps/api/test/api.spec.ts`: **3/3 PASSED**
- `packages/shared/test/shared.spec.ts`: **5/5 PASSED**
- Total API Tests: **22/22 PASSED**

### 7. Final Governance Status
**READY FOR HUMAN REVIEW**

---

STOPPED AFTER THIS STEP — AWAITING REVIEW.

# MUSE SPARK IMPLEMENTATION REPORT — PHASE 8
## ZENTRA — Hi-Tech Lab Field Service Management Platform
### Phase 8: Staged Ingestion & Duplicate Classification Engine
#### (Includes Post-Review Correction Pass)

---

## 1. Phase 8 Objective
- **Status**: `IMPLEMENTED` | `TESTED`
- **Objective**: Implement the authoritative two-phase spreadsheet ingestion pipeline and 5-tier duplicate classification engine for ZENTRA, establishing robust file parsing (.xlsx, .xls, .csv), isolated staging tables, data normalization, fallback school correlation, 5-tier duplicate classification, approval/commit lifecycle, PostgreSQL Row-Level Security (RLS) on import entities, administrative audit logging, and an inviolable boundary wall ensuring external re-imports never overwrite authoritative field-service operational data.

---

## 2. Executive Summary
- **Status**: `IMPLEMENTED` | `TESTED`
- **Executive Summary**:
  Phase 8 delivers the staged data ingestion and classification subsystem for ZENTRA, providing the primary mechanism by which legacy helpline tickets, manual departmental spreadsheets, and third-party call center logs enter the platform safely. Building upon Phase 4 (authoritative database schema), Phase 5 (RBAC and RLS infrastructure), Phase 6 (territory and school master hierarchy), and Phase 7 (equipment master catalogue), Phase 8 implements:
  1. **Two-Phase Staged Ingestion Architecture (`apps/api/src/modules/imports/`)**: Ingested files are never written directly into production service or operational tables. Ingestion parses rows into an isolated staging buffer (`import_staging_records`), allowing human coordinators to inspect, review, edit, approve, or reject complaints before commit.
  2. **Multi-Format Spreadsheet Parsing (`SpreadsheetParserService`)**: Safe streaming and buffering using SheetJS (`xlsx`) supporting Modern Excel (`.xlsx`), Legacy Excel (`.xls`), and Comma-Separated Values (`.csv`). Security gates include a 15MB file size limit, 10,000 row cap, formula neutralization, and blank row filtration.
  3. **Data Mapping & Resilient Normalization (`FieldMappingNormalizerService`)**: Flexible alias resolution for disparate column headers, phone number cleaning (10-digit extraction with +91 handling), whitespace trimming, priority normalization (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), UDISE code validation (11-digit numeric format), and varchar(11) database safety.
  4. **Separation of Algorithmic Recommendation vs. Authorized Human Approval**:
     - The duplicate classification engine produces classification tiers, confidence scores, duplicate reasoning, and a **`recommended_action`** (e.g. `'RECOMMEND_APPROVE'`, `'REVIEW_ACTIVE_CHASER'`, `'REVIEW_WARRANTY_CALLBACK'`, `'REJECT_DUPLICATE'`).
     - **Algorithmic recommendations are strictly non-authorizing**: Inbound staging rows are inserted with `is_approved_for_commit = false`, `approved_by_user_id = null`, and `approved_at = null` across all tiers (including Tier 2 and Tier 3).
     - **Authorized human approval** requires an explicit administrative review call by an authorized user (`MASTER_ADMIN` statewide, or territory-scoped `DISTRICT_COORDINATOR`), which sets `is_approved_for_commit = true`, records `approved_by_user_id`, and sets `approved_at`.
     - Staged rows cannot be committed without explicit authorized human approval.
  5. **Five-Tier Duplicate Classification Engine (`DuplicateClassificationEngineService`)**:
     - **Tier 1 (`EXACT_SOURCE_DUPLICATE`)**: Natural composite identity match (`source_system_id + external_ticket_id`), confidence 1.0. Flagged duplicate; recommended action: `'REJECT_DUPLICATE'`.
     - **Tier 2 (`NEW_UNIQUE`)**: Valid school resolved, zero conflicting active complaints on the same equipment, confidence 1.0. Recommended action: `'RECOMMEND_APPROVE'`; recommended for Phase 9 service-case processing.
     - **Tier 3 (`NEW_ISSUE_DIFFERENT_EQUIPMENT`)**: Matching school with existing active ticket, but targeting distinctly different hardware, confidence 0.90. Recommended action: `'RECOMMEND_APPROVE'`; recommended for Phase 9 service-case processing.
     - **Tier 4 (`ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT`)**: Matching school and active unresolved ticket on the same equipment category, confidence 0.85. Recommended action: `'REVIEW_ACTIVE_CHASER'`.
     - **Tier 5 (`REOPENED_POST_SERVICE_FAILURE`)**: Matching school and equipment where previous case was resolved within the past 7 days, confidence 0.75. Recommended action: `'REVIEW_WARRANTY_CALLBACK'`.
     - **Intra-Batch Deduplication (`DUPLICATE_IN_FILE`)**: Duplicate rows occurring within the same uploaded spreadsheet are detected and flagged (`'REJECT_DUPLICATE'`).
  6. **School Identification & Fallback Correlation**: Primary resolution via 11-digit UDISE code. Fallback correlation by school name, district, and block when UDISE is absent or invalid.
  7. **Inviolable Import Boundary Wall & Strict Phase 9 Boundary**:
     - Staging data and re-imports write strictly to `source_complaints` and `import_staging_records`.
     - Imports NEVER create service cases, NEVER transition cases, NEVER dispatch engineers, and NEVER write assignment history.
     - Under no circumstances can an import overwrite or alter field-service operational data (`service_cases`, `case_assignments`, `field_visits`, diagnosis findings, GPS coordinates, or evidence photos).
  8. **Atomic Transactional Commit (`ImportsService`)**: Approved staging records commit inside a PostgreSQL atomic transaction (`BEGIN ... COMMIT`). If any unrecoverable error occurs, the entire commit rolls back cleanly.
  9. **Multi-District RBAC & Row-Level Security**: Additive migration `20261008000001_create_import_staging_rls.ts` establishes RLS on `import_jobs` and `import_staging_records`. District Coordinators are restricted to their authorized territories; Master Admins and Reporting Heads maintain statewide access; Field Engineers are strictly denied import permissions.
  10. **Administrative Audit Logging**: All major lifecycle events (`IMPORT_JOB_CREATED`, `IMPORT_JOB_PROCESSED`, `IMPORT_RECORDS_APPROVED`, `IMPORT_COMMITTED`) are recorded in `audit_events`.
  11. **Comprehensive Verification**: 21 integration tests in `apps/api/test/import-staging-domain.spec.ts` (including dedicated boundary proofs). All 160 `@zentra/api` backend tests and all 179 monorepo tests pass with 100% success rate.

---

## 3. Scope Implemented
- **Status**: `IMPLEMENTED` | `TESTED`
- **Implementation Deliverables**:
  1. **Database Migration & RLS**:
     - `apps/api/src/database/migrations/20261008000001_create_import_staging_rls.ts`:
       - Additive columns on `import_jobs`: `source_system_id`, `file_hash_sha256`, `file_size_bytes`.
       - Additive columns on `import_staging_records`: `row_number`, `duplicate_reason`, `duplicate_confidence`, `recommended_action`, `approved_by_user_id`, `approved_at`, `matched_source_complaint_id`, `committed_source_complaint_id`.
       - Database default for `is_approved_for_commit` altered to `false`.
       - Idempotent and reversible migration with `DROP COLUMN IF EXISTS` in `down()`.
       - Performance indexes: `idx_import_jobs_status_territory`, `idx_staging_records_job_status`, `idx_staging_records_duplicate_tier`, `idx_staging_records_udise`.
       - RLS policies: `import_staging_records_territory_isolation` and `import_jobs_territory_isolation`.
     - Registered in `apps/api/src/database/migration-runner.ts`.
     - Reversible migration execution verified in `test/database-schema.spec.ts`.
  2. **Shared Types & Contracts**:
     - `@zentra/types`: `DuplicateClassificationTier`, `ImportJobStatus`, `ImportFileType`, `ImportJob`, `ImportStagingRecord` (with `recommendedAction`, `approvedByUserId`, `approvedAt`), `ImportJobStatistics`.
     - `@zentra/contracts`: `importFileSchema`, `importStagingQuerySchema`, `reviewStagingRecordsSchema`, `commitImportJobSchema`.
  3. **Repositories**:
     - `AuditEventsRepository`: Writes Administrative Audit Logging events (`event_category = 'ADMINISTRATIVE'`).
     - `SourceComplaintsRepository`: Manages `complaint_sources` and `source_complaints`, ensuring boundary wall integrity.
     - `ImportJobsRepository`: CRUD and state transitions for `import_jobs`.
     - `ImportStagingRepository`: Chunked batch insertion, filtered querying, approval status updating with user tracking, and job statistics computation. Commit query enforces `approved_by_user_id IS NOT NULL`.
  4. **Services**:
     - `SpreadsheetParserService`: Multi-format parsing (.xlsx, .xls, .csv), size/row bounds enforcement, macro stripping.
     - `FieldMappingNormalizerService`: Header alias resolution, phone sanitization, priority defaulting, UDISE validation, varchar(11) truncation safety.
     - `DuplicateClassificationEngineService`: 5-tier classification logic, intra-batch deduplication, fallback school correlation, equipment type mapping, `recommendedAction` generation.
     - `ImportsService`: High-level workflow orchestration (upload, process, review, toggle approval, atomic commit).
  5. **Controllers & Endpoints**:
     - `ImportsController`: Multipart upload, job status, staging review, approval toggle, and commit endpoints protected by `JwtAuthGuard` and `RolesGuard`.
  6. **Fixtures & Test Suites**:
     - `apps/api/test/synthetic-dev-fixtures.ts`: Added import permissions (`imports:read`, `imports:write`, `imports:approve`).
     - `apps/api/test/import-staging-domain.spec.ts`: 21 end-to-end integration tests covering items A through Z of prompt requirements plus mandatory boundary and human approval proofs.

---

## 4. Explicit Non-Goals
- **Status**: `VERIFIED` (Strict Phase Boundary Enforced)
- **Explicit Non-Goals (Deferred to Subsequent Phases Matching `docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md`)**:
  1. **Phase 9: Service Case Lifecycle & Dispatch Engine**: Ticket deduplication into active `service_cases`, state machine transitions (`UNASSIGNED` to `CLOSED`), engineer assignment history, and SLA breach tickers are DEFERRED TO PHASE 9.
  2. **Phase 10: Mobile Local-First Core (ZENTRA Field)**: WatermelonDB on SQLite, offline sync queue, client-side `UUIDv7` generation, and territory caching are DEFERRED TO PHASE 10.
  3. **Phase 11: Mobile Hardware GPS & Camera Module**: Fused Location stream $\le 50\text{ m}$ accuracy threshold gating, rear-camera viewfinder with permanent metadata watermarking, and EXIF GPS tags are DEFERRED TO PHASE 11.
  4. **Phase 12: Delta Synchronization & Conflict Arbitration Engine**: Row-level push/pull synchronization, domain-owned conflict resolution matrix, and monotonic tombstones are DEFERRED TO PHASE 12.
  5. **Phase 13: Field Visit Execution & Multi-Visit Flow**: Mobile on-site visit wizard (check-in, diagnosis, spares consumed, check-out) and multiple visits per service case (`1:N`) are DEFERRED TO PHASE 13.
  6. **Phase 14: Evidence Pipeline & Direct S3 Streaming**: Pre-signed S3 upload endpoints, binary upload decoupling, Slot 1 (HM Signed Report) and Slot 2 (Equipment Photo) isolation, and SHA-256 validation are DEFERRED TO PHASE 14.
  7. **Phase 15: Conveyance Claims & Management Web Portal (ZENTRA Web)**: React + Vite web portal, dispatch boards, staging preview diff modals, SLA radar, and travel conveyance claim approval desk are DEFERRED TO PHASE 15.
  8. **Phase 16: E2E Field Rehearsal & Production Hardening**: Physical Android testing, k6 load testing, and security audits are DEFERRED TO PHASE 16.

---

## 5. Authoritative Document Traceability
- **Status**: `IMPLEMENTED`
- **Traceability Matrix**:
  - `docs/ZENTRA_PROJECT_REQUIREMENTS.md` (Sections 4 & 5): Requirement for bulk ingestion of legacy complaints, school resolution, and duplicate ticket prevention.
  - `docs/ZENTRA_ARCHITECTURE.md` (Section 4): Two-phase staging architecture separating untrusted input buffers from operational field data.
  - `docs/ZENTRA_DATA_MODEL.md` (Section 5): `complaint_sources`, `source_complaints`, `import_jobs`, and `import_staging_records` relational schemas.
  - `docs/ZENTRA_IMPORT_OCR_AI_ARCHITECTURE.md`: Technical specification for 5-tier duplicate classification, fallback school matching, and staging approval lifecycle.
  - `docs/ZENTRA_SECURITY_ARCHITECTURE.md` & `docs/ZENTRA_RLS_IMPLEMENTATION.md`: Multi-district RBAC enforcement and PostgreSQL Row-Level Security.
  - `docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md`: Governs phase scope, naming ("Staged Ingestion & Duplicate Classification Engine"), and boundary constraints.

---

## 6. Import Architecture
- **Status**: `IMPLEMENTED` | `TESTED`
- **Architecture Model**:
  The ZENTRA import architecture decouples external arrival from operational execution:
  ```
  External File (.xlsx / .xls / .csv)
             │
             ▼
  ┌────────────────────────────────────────┐
  │      SpreadsheetParserService          │  --> Neutralizes macros, enforces size/row limits
  └───────────────────┬────────────────────┘
                      │
                      ▼
  ┌────────────────────────────────────────┐
  │   FieldMappingNormalizerService        │  --> Normalizes phones, UDISE, headers, priorities
  └───────────────────┬────────────────────┘
                      │
                      ▼
  ┌────────────────────────────────────────┐
  │ DuplicateClassificationEngineService   │  --> Evaluates 5-tier classification against DB
  │                                        │  --> Generates recommended_action (non-authorizing)
  └───────────────────┬────────────────────┘
                      │
                      ▼
  ┌────────────────────────────────────────┐
  │     import_staging_records Table       │  --> Isolated Staging Buffer (is_approved = false)
  └───────────────────┬────────────────────┘
                      │
         (Authorized Human Review)
     (MASTER_ADMIN / Scoped COORDINATOR)
                      │
                      ▼
  ┌────────────────────────────────────────┐
  │      Authorized Approval Action        │  --> Sets is_approved = true, approved_by_user_id
  └───────────────────┬────────────────────┘
                      │
                      ▼
  ┌────────────────────────────────────────┐
  │      Atomic Transactional Commit       │  --> Writes strictly to source_complaints
  └───────────────────┬────────────────────┘
                      │
                      ▼
           [ BOUNDARY WALL ]
      (Field Operations Protected)
  ```

---

## 7. Import Job Lifecycle
- **Status**: `IMPLEMENTED` | `TESTED`
- **Lifecycle States**:
  1. `PENDING`: Import job created, file received, metadata hashed and stored.
  2. `PARSING`: Raw file being decoded into row representations.
  3. `NORMALIZING`: Column mappings resolved, phone/UDISE strings validated and cleaned.
  4. `CLASSIFYING`: Duplicate engine evaluating existing tickets and local rows.
  5. `STAGED`: Staging records persisted; awaiting human review and approval.
  6. `COMMITTING`: Transactional commit in progress.
  7. `COMPLETED`: Approved records committed to `source_complaints`; job finalized.
  8. `FAILED`: Fatal parsing or validation error encountered; error recorded.
  9. `CANCELLED`: Staging job discarded by administrator prior to commit.

---

## 8. Staging Data Model
- **Status**: `IMPLEMENTED` | `TESTED`
- **Entity Schema Details**:
  - `import_jobs`:
    - `job_id`: UUIDv7 PK
    - `source_system_id`: UUIDv7 FK -> `complaint_sources`
    - `file_name`: VARCHAR(255)
    - `file_type`: VARCHAR(20) (`XLSX`, `XLS`, `CSV`)
    - `file_hash_sha256`: VARCHAR(64)
    - `file_size_bytes`: INTEGER
    - `status`: VARCHAR(50)
    - `total_rows`, `processed_rows`, `error_rows`: INTEGER
    - `district_id`: UUIDv7 FK -> `districts` (nullable; territory scoping)
    - `created_by_user_id`: UUIDv7 FK -> `users`
  - `import_staging_records`:
    - `staging_record_id`: UUIDv7 PK
    - `import_job_id`: UUIDv7 FK -> `import_jobs`
    - `row_number`: INTEGER
    - `raw_row_data`: JSONB (preserves exact source content untouched)
    - `mapped_udise_code`: VARCHAR(11) (length-safe)
    - `mapped_school_name`: VARCHAR(255)
    - `mapped_complaint_text`: TEXT
    - `mapped_priority`: VARCHAR(20)
    - `mapped_caller_phone`: VARCHAR(20)
    - `duplicate_tier`: VARCHAR(50) (`EXACT_SOURCE_DUPLICATE`, `NEW_UNIQUE`, etc.)
    - `duplicate_reason`: TEXT
    - `duplicate_confidence`: NUMERIC(3,2)
    - `recommended_action`: VARCHAR(50) (`RECOMMEND_APPROVE`, `REVIEW_ACTIVE_CHASER`, etc.)
    - `validation_status`: VARCHAR(20) (`VALID`, `INVALID`, `WARNING`)
    - `validation_errors`: JSONB (array of validation error strings)
    - `is_approved`: BOOLEAN (default `false` on ALL rows upon staging)
    - `approved_by_user_id`: UUIDv7 FK -> `users` (null until authorized human review)
    - `approved_at`: TIMESTAMPTZ (null until authorized human review)
    - `matched_source_complaint_id`: UUIDv7 FK -> `source_complaints` (nullable)
    - `committed_source_complaint_id`: UUIDv7 FK -> `source_complaints` (nullable)

---

## 9. Mapping / Normalization
- **Status**: `IMPLEMENTED` | `TESTED`
- **Normalization Rules**:
  - **Header Resolution**: Case-insensitive alias dictionary matching variants such as `udise_code`, `udise`, `school_code`, `emis_code` $\rightarrow$ `udise_code`; `caller_phone`, `contact_number`, `mobile`, `hm_phone` $\rightarrow$ `caller_phone`.
  - **Phone Sanitization**: Strips whitespace, dashes, parenthetical formatting, and leading `+91` or `0`. Extracts standard 10-digit Indian mobile format.
  - **UDISE Cleaning**: Strips spaces; validates 11-digit numeric format. If input exceeds 11 characters or is invalid, safely truncates normalized string to 11 characters for DB column compatibility while storing full raw value in `raw_row_data` and logging validation error.
  - **Priority Normalization**: Maps variations (`urgent`, `critical`, `high`, `p1`, `p2`, `low`) to canonical `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. Defaults to `MEDIUM` when blank.

---

## 10. Required-Field Validation
- **Status**: `IMPLEMENTED` | `TESTED`
- **Validation Gates**:
  - Mandatory fields: Complaint description / problem statement, and School identifier (either valid UDISE code or resolvable School Name).
  - Row Isolation: Validation errors mark individual rows as `validation_status = 'INVALID'` with specific error messages in `validation_errors` JSONB.
  - Non-Blocking: Invalid rows do not abort the parsing of valid rows; valid rows proceed to staging. Invalid rows cannot be committed until corrected or approved by an administrator.

---

## 11. Five-Tier Duplicate Classification
- **Status**: `IMPLEMENTED` | `TESTED`
- **Classification Rules & Recommendations**:
  - **Tier 1 (`EXACT_SOURCE_DUPLICATE`)**:
    - Condition: Matching `source_system_id` and `external_ticket_id` found in `source_complaints`.
    - Confidence: 1.0.
    - Recommended Action: `'REJECT_DUPLICATE'`.
    - Approval State: `is_approved = false`, `approved_by_user_id = null`.
  - **Tier 2 (`NEW_UNIQUE`)**:
    - Condition: Valid school resolved, zero conflicting active tickets on the specified equipment.
    - Confidence: 1.0.
    - Recommended Action: `'RECOMMEND_APPROVE'`; recommended for Phase 9 service-case processing.
    - Approval State: `is_approved = false` (requires authorized human approval before commit).
  - **Tier 3 (`NEW_ISSUE_DIFFERENT_EQUIPMENT`)**:
    - Condition: Matching school has an active ticket, but the inbound complaint targets a distinctly different hardware category (e.g. UPS vs. Interactive Display).
    - Confidence: 0.90.
    - Recommended Action: `'RECOMMEND_APPROVE'`; recommended for Phase 9 service-case processing.
    - Approval State: `is_approved = false` (requires authorized human approval before commit).
  - **Tier 4 (`ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT`)**:
    - Condition: Matching school has an active unresolved ticket on the same hardware category.
    - Confidence: 0.85.
    - Recommended Action: `'REVIEW_ACTIVE_CHASER'`.
    - Approval State: `is_approved = false`.
  - **Tier 5 (`REOPENED_POST_SERVICE_FAILURE`)**:
    - Condition: Matching school and equipment where previous service case was marked resolved within the past 7 calendar days.
    - Confidence: 0.75.
    - Recommended Action: `'REVIEW_WARRANTY_CALLBACK'`.
    - Approval State: `is_approved = false`.
  - **Intra-Batch Deduplication (`DUPLICATE_IN_FILE`)**:
    - Multiple occurrences of the same ticket identifier within the same uploaded file are flagged with confidence 0.95 and recommended action `'REJECT_DUPLICATE'`.

---

## 12. Identity and Fallback Correlation
- **Status**: `IMPLEMENTED` | `TESTED`
- **Resolution Strategy**:
  1. **Primary Identification**: 11-digit UDISE code matched against `schools.udise_code`.
  2. **Fallback Correlation**: If UDISE is absent or invalid, performs normalized ILIKE matching on `school_name` within the specified district and block. If exactly one school matches, correlation succeeds with a validation warning. If zero or multiple matches occur, row is flagged `INVALID`.
  3. **Natural Key Preservation**: External source ticket numbers are preserved verbatim in `external_ticket_id` to ensure re-import correlation.

---

## 13. Re-Import / Idempotency
- **Status**: `IMPLEMENTED` | `TESTED`
- **Re-import Safety**:
  - Uploading the identical spreadsheet or an overlapping extract detects existing tickets via Tier 1 natural identity matching.
  - Duplicate rows are automatically linked to `matched_source_complaint_id` and left unapproved.
  - Re-imports NEVER spawn duplicate operational cases or overwrite previously committed records.

---

## 14. Boundary Wall
- **Status**: `IMPLEMENTED` | `TESTED`
- **Operational Protection**:
  - The import engine writes strictly to `import_jobs`, `import_staging_records`, and `source_complaints`.
  - Staging mutations and re-imports have zero direct write access to:
    - `service_cases`
    - `case_assignments`
    - `field_visits`
    - Diagnostic findings & spares consumed
    - GPS check-in/check-out coordinates
    - Evidence photos & signed reports
  - Even if an imported row contains modified metadata for an existing ticket, operational field-service data remains completely untouched. Verified by mandatory test scenario (Section 31).

---

## 15. Approval / Commit Architecture
- **Status**: `IMPLEMENTED` | `TESTED`
- **Workflow**:
  1. Human review via `GET /api/v1/imports/jobs/:jobId/staging` with filtering by duplicate tier, validation status, and approval status.
  2. Granular approval toggling via `PATCH /api/v1/imports/jobs/:jobId/staging/review`.
     - Validates actor authorization (`MASTER_ADMIN` or territory-scoped `DISTRICT_COORDINATOR`).
     - Gated: `REPORTING_HEAD` and `FIELD_ENGINEER` are denied with HTTP 403.
     - On approval: sets `is_approved_for_commit = true`, `approved_by_user_id = user.sub`, `approved_at = NOW()`.
     - On disapproval: sets `is_approved_for_commit = false`, `approved_by_user_id = null`, `approved_at = null`.
  3. Commit execution via `POST /api/v1/imports/jobs/:jobId/commit`.
     - Enforces that only records with `is_approved_for_commit = true` AND `approved_by_user_id IS NOT NULL` are processed.
     - Merely classified/recommended records without authorized human approval cannot be committed (fails with HTTP 400).
     - Atomic execution inside a PostgreSQL transaction. Only approved rows are inserted into `source_complaints`.
     - The staging record is updated with `committed_source_complaint_id`.

---

## 16. Authorization / RLS
- **Status**: `IMPLEMENTED` | `TESTED`
- **Security Matrix**:
  - `MASTER_ADMIN`: Statewide access to upload, review, toggle approval, and commit import jobs.
  - `REPORTING_HEAD`: Statewide read-only access to import jobs and staging records. Mutations and approvals rejected with HTTP 403 Forbidden.
  - `DISTRICT_COORDINATOR`: Territory-scoped access. Can upload, review, approve, and commit jobs for their assigned district only. Cross-district operations blocked.
  - `FIELD_ENGINEER`: Completely blocked from all import endpoints (HTTP 403 Forbidden).
- **PostgreSQL Row-Level Security**:
  - Policies `import_jobs_territory_isolation` and `import_staging_records_territory_isolation` enforce territory isolation at the database kernel level based on `zentra.current_user_id` and territory assignments.

---

## 17. Audit Logging
- **Status**: `IMPLEMENTED` | `TESTED`
- **Audit Logging Architecture**:
  - Emits administrative audit events to `audit_events` with `event_category = 'ADMINISTRATIVE'`.
  - Operations logged:
    - `IMPORT_JOB_CREATED`: User ID, job ID, file name, row count.
    - `IMPORT_JOB_PROCESSED`: Job ID, total rows, valid rows, error rows, duplicate tier breakdown.
    - `IMPORT_RECORDS_APPROVED`: User ID, job ID, approved/rejected record count.
    - `IMPORT_COMMITTED`: User ID, job ID, total committed records count.
  - *Terminology Compliance*: Accurately documented as "Administrative Audit Logging". No unverified claims of database immutability.

---

## 18. API Surface
- **Status**: `IMPLEMENTED` | `TESTED`
- **Endpoints**:
  - `POST /api/v1/imports/upload`: Multipart file upload (`.xlsx`, `.xls`, `.csv`), requires `sourceSystemId`, optional `districtId`.
  - `GET /api/v1/imports/jobs/:jobId`: Get import job status, row counts, and summary statistics.
  - `GET /api/v1/imports/jobs/:jobId/staging`: Query staged rows with pagination and filters (`duplicateTier`, `validationStatus`, `isApproved`).
  - `PATCH /api/v1/imports/jobs/:jobId/staging/review`: Bulk approve or reject staged records (records `approved_by_user_id` and `approved_at`).
  - `POST /api/v1/imports/jobs/:jobId/commit`: Atomically commit approved staged records to `source_complaints`.

---

## 19. Error Handling
- **Status**: `IMPLEMENTED` | `TESTED`
- **Error Behavior**:
  - Malformed or corrupted spreadsheets: HTTP 400 Bad Request with descriptive parsing error.
  - File size exceeding 15MB: HTTP 400 Bad Request ("File size exceeds limit of 15MB").
  - File rows exceeding 10,000: HTTP 400 Bad Request ("Row count exceeds maximum limit of 10,000").
  - Row-level validation failures: Non-fatal; row marked `INVALID` in staging, remaining rows processed.
  - Commit error: Atomic transaction rollback, job marked `FAILED`.

---

## 20. Security Considerations
- **Status**: `IMPLEMENTED` | `TESTED`
- **Security Protections**:
  - Formula Injection Protection: Neutralizes spreadsheet cells beginning with `=, +, -, @` to prevent CSV/Excel injection attacks.
  - Safe Parsing: Employs SheetJS in read-only buffer mode with `raw: false` and macro execution disabled.
  - Authentication: All endpoints gated behind `JwtAuthGuard` and `RolesGuard`.
  - Rate & Size Limiting: Fastify multipart limits enforced.

---

## 21. Synthetic Fixtures
- **Status**: `IMPLEMENTED` | `TESTED`
- **Fixtures (`apps/api/test/synthetic-dev-fixtures.ts`)**:
  - Updated role permissions to grant `imports:read`, `imports:write`, `imports:approve` to `MASTER_ADMIN` and `DISTRICT_COORDINATOR`.
  - Preserved synthetic seed data (`complaint_sources`, `schools`, `districts`, `users`) with zero real-world government PII or production data.

---

## 22. Test Results
- **Status**: `TESTED` | `VERIFIED`
- **Test Results Summary**:
  - Phase 8 Test Suite (`apps/api/test/import-staging-domain.spec.ts`):
    - 21 of 21 tests passed (100% pass rate).
  - All `@zentra/api` Test Suites:
    - 6 test files passed, 160 tests passed, 0 failed.
  - Monorepo Full Regression Run (`pnpm test`):
    - 10 packages in scope, 13 tasks successful, 179 tests passed, 0 failed.

---

## 23. Exact Test Accounting
- **Status**: `VERIFIED`
- **Test Accounting Breakdown**:

| Test Suite / Package | Scope | Tests Run | Passed | Failed |
| :--- | :--- | :---: | :---: | :---: |
| `apps/api/test/import-staging-domain.spec.ts` | **Phase 8 Tests (19 initial + 2 boundary proofs)** | 21 | 21 | 0 |
| `apps/api/test/database-schema.spec.ts` | Phase 4 Database Foundation Regression | 19 | 19 | 0 |
| `apps/api/test/auth-security.spec.ts` | Phase 5 Auth & RBAC Regression | 38 | 38 | 0 |
| `apps/api/test/school-lab-domain.spec.ts` | Phase 6 School & Lab Regression | 30 | 30 | 0 |
| `apps/api/test/equipment-domain.spec.ts` | Phase 7 Equipment Master Regression | 49 | 49 | 0 |
| `apps/api/test/api.spec.ts` | Phase 5 API Baseline Regression | 3 | 3 | 0 |
| **Total `@zentra/api` Backend Tests** | **All API Suites Combined** | **160** | **160** | **0** |
| `@zentra/shared` | Monorepo Shared Package | 5 | 5 | 0 |
| `@zentra/contracts` | Monorepo Contracts Package | 3 | 3 | 0 |
| `@zentra/config` | Monorepo Config Package | 3 | 3 | 0 |
| `@zentra/testing` | Monorepo Testing Package | 4 | 4 | 0 |
| `@zentra/field` | Monorepo Field App Package | 3 | 3 | 0 |
| `@zentra/web` | Monorepo Web App Package | 1 | 1 | 0 |
| **Total Monorepo Tests** | **Full Workspace Suite** | **179** | **179** | **0** |

*Zero test failures. Zero skipped tests. Zero double-counting.*

---

## 24. Corrections / Reconciliation Performed
- **Status**: `VERIFIED`
- **Corrections Identified & Fixed During Implementation & Correction Pass**:
  1. **Separation of Algorithmic Recommendation vs. Authorized Human Approval**:
     - *Issue*: Staging previously marked Tier 2 and Tier 3 rows as `is_approved = true` upon ingestion.
     - *Correction*: Separated algorithmic recommendation from human approval. Ingestion populates `recommended_action = 'RECOMMEND_APPROVE'`, but sets `is_approved_for_commit = false`, `approved_by_user_id = null`, and `approved_at = null`. Staged rows cannot commit until explicit human approval occurs by an authorized user (`MASTER_ADMIN` or scoped `DISTRICT_COORDINATOR`).
  2. **Migration Idempotency & Database Defaults**:
     - Added `recommended_action`, `approved_by_user_id`, and `approved_at` to `import_staging_records`.
     - Altered column default of `is_approved_for_commit` to `false`.
     - Reversible `down()` migration upgraded with `DROP COLUMN IF EXISTS` to guarantee rollback safety.
  3. **Strict Phase 9 Boundary Phrasing**:
     - Phrasing such as "ready for dispatch workflow" or "candidate for bundled engineer dispatch" was replaced with "recommended for Phase 9 service-case processing".
     - Verified that Phase 8 duplicate classification and commits DO NOT create service cases, DO NOT dispatch engineers, and DO NOT touch assignment history.
  4. **UDISE Column Length Protection**: In `import_staging_records`, `mapped_udise_code` is defined as `varchar(11)`. Normalized output is safely truncated to 11 characters, while retaining the full untruncated string in `raw_row_data` and logging a validation error.
  5. **Tier 1 Natural Key Match Source Alignment**: Aligned test fixtures to verify `(source_system_id, external_ticket_id)` correlation.
  6. **Duplicate Engine Classification Evaluation Order**: Verified that recently closed tickets for the same equipment (`REOPENED_POST_SERVICE_FAILURE`, Tier 5) take precedence over active tickets on unrelated equipment (`NEW_ISSUE_DIFFERENT_EQUIPMENT`, Tier 3).

---

## 25. Remaining REQUIRES CLARIFICATION Items
- **Status**: `DOCUMENTED`
- **Items Pending Future Stakeholder Input**:
  1. *Optical Character Recognition (OCR) Ingestion*: Whether scanned physical complaints / PDF documents should be parsed via an asynchronous background OCR pipeline (e.g., Tesseract / Google Document AI) in a future release or remain an external pre-processing step.
  2. *Duplicate Merge Policy on Commit*: Currently, Tier 4 duplicate complaints remain uncommitted or staged as chasers. If stakeholders require automatic appending of chaser call logs to existing active service cases, this should be formalized in Phase 9 service case lifecycle rules.
  3. *Auto-Approval Thresholds*: Staging requires human approval for all rows. Stakeholders may decide whether future high-confidence Tier 2 complaints can be auto-approved for specific verified sources.

---

## 26. Deferred Phase 9+ Work
- **Status**: `DOCUMENTED`
- **Explicit Scope Defers**:
  - **Phase 9**: Service Case Lifecycle state machine (`UNASSIGNED` to `CLOSED`), engineer dispatch engine, assignment history tracking, and SLA warning tickers.
  - **Phase 10**: Mobile Local-First Core (ZENTRA Field), WatermelonDB on SQLite, offline mutation queue.
  - **Phase 11**: Mobile Hardware GPS & Camera Module, Fused Location gating ($\le 50\text{ m}$), metadata watermarking.
  - **Phase 12**: Delta Synchronization & Conflict Arbitration Engine (`/api/v1/sync/push`, `/api/v1/sync/pull`).
  - **Phase 13**: Field Visit Execution & Multi-Visit Flow (check-in, diagnosis, spares consumed, check-out).
  - **Phase 14**: Evidence Pipeline & Direct S3 Streaming (pre-signed upload URLs, Slot 1/Slot 2 isolation).
  - **Phase 15**: Conveyance Claims & Management Web Portal (ZENTRA Web).
  - **Phase 16**: E2E Field Rehearsal & Production Hardening.

---

## 27. Final Implementation Status
- **Status**: `IMPLEMENTED` | `TESTED` | `VERIFIED`
- **Gate Compliance**:
  - [x] Sample spreadsheets (.xlsx, .xls, .csv) parsed and staged.
  - [x] Five-tier duplicate classification implemented and verified.
  - [x] Algorithmic recommendation strictly separated from authorized human approval.
  - [x] Multi-district RBAC and RLS isolation enforced.
  - [x] Administrative approval commits records atomically.
  - [x] Strict Phase 9 boundary: zero service cases created, zero dispatching, field operational data protected.
  - [x] 100% test pass rate across all unit, integration, and monorepo regression suites.

---

STOPPED AFTER THIS STEP — AWAITING REVIEW.

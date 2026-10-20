# ZENTRA — Architecture Decision Records (ADR)
## Hi-Tech Lab Field Service Management Platform

---

## Index of Architectural Decisions

- [ADR-001: Mobile-First Strategy & Mobile Framework Choice](#adr-001-mobile-first-strategy--mobile-framework-choice)
- [ADR-002: Modular Backend Architecture & API Style](#adr-002-modular-backend-architecture--api-style)
- [ADR-003: Authoritative Relational Database with Row-Level Security](#adr-003-authoritative-relational-database-with-row-level-security)
- [ADR-004: Local-First Mobile Database Engine](#adr-004-local-first-mobile-database-engine)
- [ADR-005: Decoupled Binary Media Pipeline & Pre-Signed S3 Uploads](#adr-005-decoupled-binary-media-pipeline--pre-signed-s3-uploads)
- [ADR-006: Strict Separation of Source Complaints and Service Cases](#adr-006-strict-separation-of-source-complaints-and-service-cases)
- [ADR-007: First-Class Multi-Visit Data Model](#adr-007-first-class-multi-visit-data-model)
- [ADR-008: Physical Evidence Slot Isolation](#adr-008-physical-evidence-slot-isolation)
- [ADR-009: Dynamic & Schema-Driven Equipment Attribute Modeling](#adr-009-dynamic--schema-driven-equipment-attribute-modeling)
- [ADR-010: Domain-Owned Delta Synchronization & Prohibition of Whole-Dataset Sync](#adr-010-domain-owned-delta-synchronization--prohibition-of-whole-dataset-sync)
- [ADR-011: Two-Phase Ingestion Pipeline with Human-in-the-Loop Approval](#adr-011-two-phase-ingestion-pipeline-with-human-in-the-loop-approval)
- [ADR-012: Advisory-Only Role for OCR and AI with Full Value Lineage](#adr-012-advisory-only-role-for-ocr-and-ai-with-full-value-lineage)
- [ADR-013: Server-Side Multi-District Territory Authorization](#adr-013-server-side-multi-district-territory-authorization)
- [ADR-014: Fail-Closed Multi-Environment Isolation & Test Gating](#adr-014-fail-closed-multi-environment-isolation--test-gating)
- [ADR-015: Configurable Business Rules (SLA Policies & Conveyance Reimbursement)](#adr-015-configurable-business-rules-sla-policies--conveyance-reimbursement)

---

### ADR-001: Mobile-First Strategy & Mobile Framework Choice

- **DECISION**: Adopt a strict **Mobile-First Strategy** centered on **ZENTRA Field**, implemented using **React Native with TypeScript** and direct native hardware bridging for CameraX and Fused Location Provider.
- **WHY**: The primary operational actor is the Field Engineer operating outdoors in rural schools. Web-only or desktop-first platforms fail in field environments. React Native allows 100% shared TypeScript domain models and Zod validation schemas across mobile, web, and backend codebases, while providing native 60fps performance and direct hardware sensor control on mid-range Android devices.
- **ALTERNATIVES**:
  - *Flutter (Dart)*: Excellent hardware control and offline performance, but introduces a second programming language (Dart), completely preventing shared TypeScript contracts with the backend and web portal.
  - *Native Android (Kotlin)*: Maximum native control, but triples engineering surface area and prevents web code sharing.
  - *Progressive Web App (PWA)*: Rejected due to fragile offline storage quotas, restricted background sync capabilities on Android/iOS, and unreliable camera/GPS access in webviews.
- **TRADE-OFFS**: React Native requires managing native Android build tools (Gradle, Android SDK) and native dependency bridging compared to pure web technologies.
- **RISK**: Native module version incompatibilities during major React Native upgrades. Mitigated by isolating native hardware bridges (Camera, GPS, SQLite) behind strict interface facades.
- **FUTURE IMPACT**: Allows rapid expansion to iOS in the future with minimal architectural adjustments.

---

### ADR-002: Modular Backend Architecture & API Style

- **DECISION**: Implement **ZENTRA Core** as a modular TypeScript backend utilizing **NestJS with Fastify** exposing a **RESTful JSON API with OpenAPI contracts**.
- **WHY**: NestJS enforces clean enterprise software boundaries (Controllers, Services, Repositories, Guards, Interceptors) with built-in Dependency Injection. Fastify provides high-throughput request handling with minimal latency. Shared Zod contracts guarantee that request payloads validated on mobile and web match server expectations precisely.
- **ALTERNATIVES**:
  - *Go (Golang)*: Exceptional raw performance and low memory footprint, but bifurcates domain models and slows cross-platform contract iteration.
  - *Python (FastAPI)*: Good for rapid development and AI scripts, but less structured for complex enterprise domain-driven service layers and prevents TypeScript type sharing.
  - *GraphQL*: Over-complicated caching and sync overhead for an offline-first system that relies on deterministic delta synchronization endpoints.
- **TRADE-OFFS**: Slightly higher initial boilerplate than unopinionated Express.js; requires maintaining NestJS module hierarchies.
- **RISK**: Team unfamiliarity with NestJS dependency injection patterns. Mitigated by established project structure conventions.
- **FUTURE IMPACT**: Clean separation of modules (Cases, Visits, Equipment, Ingestion, Sync) enables easy extraction into microservices if statewide load demands horizontal decomposition.

---

### ADR-003: Authoritative Relational Database with Row-Level Security

- **DECISION**: Select **PostgreSQL 16+** with native **Row-Level Security (RLS)** as the authoritative central database.
- **WHY**: ZENTRA requires strict ACID transactional guarantees for financial conveyance claims, spare parts consumption, and immutable audit logs. PostgreSQL provides native `JSONB` querying for dynamic equipment attributes, robust spatial capabilities (PostGIS) for school geofencing, and native Row-Level Security to guarantee cross-district isolation at the database engine level.
- **ALTERNATIVES**:
  - *MongoDB / Document Store*: Rejected because unconstrained document models easily permit status collisions, lack multi-table transactional guarantees, and cannot enforce strict relational foreign keys across schools, labs, and visits.
  - *MySQL 8.0*: Lacks native Row-Level Security (RLS) policies and has less mature JSONB indexing capabilities.
- **TRADE-OFFS**: Relational schemas require structured migrations and strict foreign key discipline.
- **RISK**: Database connection saturation under heavy sync spikes. Mitigated by connection pooling (PgBouncer) and separate read replicas.
- **FUTURE IMPACT**: Guarantees institutional data durability for multi-year government audit and compliance requirements.

---

### ADR-004: Local-First Mobile Database Engine

- **DECISION**: Standardize on **WatermelonDB backed by native SQLite via JSI** for ZENTRA Field.
- **WHY**: Field Engineers carry thousands of school records, contacts, and active tickets. Traditional mobile storage (AsyncStorage, raw SQLite via bridge) causes UI thread stutters and sluggish startup times. WatermelonDB loads data lazily, utilizes native SQLite threads via JavaScript Interface (JSI), and provides built-in observable queries that reactively update the UI when background sync commits changes.
- **ALTERNATIVES**:
  - *AsyncStorage*: Single key-value store; completely incapable of relational filtering across districts, blocks, and tickets; high risk of data corruption.
  - *Realm Database*: Proprietary licensing constraints and complex binary linking.
- **TRADE-OFFS**: Requires maintaining a separate local schema and migration lifecycle on the mobile client.
- **RISK**: Schema drift between local mobile SQLite and server PostgreSQL. Mitigated by automated schema contract tests.
- **FUTURE IMPACT**: Zero UI lag regardless of whether the mobile database holds 50 tickets or 5,000 schools.

---

### ADR-005: Decoupled Binary Media Pipeline & Pre-Signed S3 Uploads

- **DECISION**: Completely decouple binary photographic media from the JSON API by implementing **Pre-Signed S3 Resumable Uploads** directly from the mobile client to S3-compatible object storage (MinIO / AWS S3).
- **WHY**: Historical forensic analysis (`KI-005`) proved that embedding 1.4MB–5MB base64 images inside JSON API payloads caused severe transport timeouts (55-second budget breaches), API gateway memory exhaustion, and lost evidence file IDs. Direct S3 uploads stream binary bytes directly to storage, eliminating API server bottlenecks.
- **ALTERNATIVES**:
  - *Multi-part form uploads through API Gateway*: Saturates API server bandwidth and worker threads during bulk sync.
  - *Google Drive via Apps Script Webhook*: Legacy architecture; suffered from unproven silent drops (`KI-001`), no transactional guarantees, and rate limits.
- **TRADE-OFFS**: Requires a two-step commit protocol (request upload URL -> upload to S3 -> confirm upload metadata on API).
- **RISK**: Orphaned S3 objects if client uploads binary but fails to confirm with API. Mitigated by automated 24-hour S3 staging lifecycle expiration for unconfirmed uploads.
- **FUTURE IMPACT**: System easily scales to hundreds of gigabytes of daily photographic evidence without degrading core database performance.

---

### ADR-006: Strict Separation of Source Complaints and Service Cases

- **DECISION**: Enforce an immutable architectural boundary separating **Source Complaints** (`source_complaints`) from operational **Service Cases** (`service_cases`).
- **WHY**: Conflating intake records with ongoing field execution was the primary root cause of data corruption in legacy systems. External spreadsheets updated weekly frequently overwrote active engineer assignments, reset operational statuses, and erased field notes. By maintaining separate entities, external source snapshots remain permanently immutable while internal field execution progresses independently.
- **ALTERNATIVES**:
  - *Single Unified Ticket Entity*: Rejected because it forces conflicting status domains (`source_status` vs `service_status`) into a single mutable record, making re-imports destructive.
- **TRADE-OFFS**: Requires maintaining foreign key mappings between source complaints and service cases.
- **RISK**: Slight increase in query joins. Mitigated by indexing `source_complaint_id`.
- **FUTURE IMPACT**: Allows ZENTRA to seamlessly connect to new external ticketing tools or helplines without altering a single field service business rule.

---

### ADR-007: First-Class Multi-Visit Data Model

- **DECISION**: Model field visits as a dedicated, first-class child entity supporting a **1:N relationship** (`service_case 1:N field_visits`), strictly prohibiting mutable JSON visit history arrays.
- **WHY**: Complex ICT failures (e.g., burned UPS inverter boards, shattered projector lenses, structured cable rewiring) require multiple trips: initial diagnosis, awaiting spare parts, and final installation. Storing visits as a mutable array inside the case record leads to concurrent write collisions and makes individual visits impossible to audit.
- **ALTERNATIVES**:
  - *Single-Visit Case Model*: Forces engineers to resolve and close cases artificially, or spawn confusing "child tickets" for follow-ups.
  - *JSON Array of Visits in ServiceCase*: Susceptible to race conditions during mobile delta sync; cannot enforce foreign keys on spares or conveyance.
- **TRADE-OFFS**: Coordinators must view aggregated visit histories rather than a single flat ticket view.
- **RISK**: Increased record volume in `field_visits`. Mitigated by standard database partitioning and indexing.
- **FUTURE IMPACT**: Enables precise tracking of "First-Time-Fix" (FTF) rates and engineer travel efficiency.

---

### ADR-008: Physical Evidence Slot Isolation

- **DECISION**: Isolate evidence artifacts into independent, typed contracts: **Slot 1 (HM Signed Completion Report)** and **Slot 2 (Equipment Working Photo)**.
- **WHY**: Historical forensic analysis identified critical bugs where updating or deleting an incorrect equipment photo inadvertently purged the Headmaster's signed paper sign-off report. Storing evidence in a generic unstructured array caused cross-slot deletion. Slot isolation guarantees that each evidence type has independent identity, upload state, and lifecycle.
- **ALTERNATIVES**:
  - *Generic Evidence Array (`evidence: string[]`)*: Rejected due to proven historical cross-deletion vulnerabilities.
- **TRADE-OFFS**: Mobile UI and API must explicitly handle typed slots rather than generic photo uploaders.
- **RISK**: Inflexibility if a new mandatory slot is introduced. Mitigated by supporting typed auxiliary slots (`SLOT_AUX_*`).
- **FUTURE IMPACT**: Guarantees institutional legal defensibility of service sign-offs for government contract billing.

---

### ADR-009: Dynamic & Schema-Driven Equipment Attribute Modeling

- **DECISION**: Implement dynamic equipment attributes using configurable **Equipment Attribute Definitions** backed by PostgreSQL `JSONB` storage on `lab_equipment`.
- **WHY**: ZENTRA is definitively **not** a UPS-only platform. Real-world labs contain 12 distinct equipment classes (Computers, Switches, Routers, I/O Cabling, UPS, Cameras, Projectors, Smartboards, etc.). Designing a monolithic table with 60 nullable columns creates unmaintainable schemas, while adding new hardware types (e.g., 3D Printers) would require database migrations and code changes.
- **ALTERNATIVES**:
  - *Giant Flat Table (`lab_equipment_all`)*: Massive schema bloat; thousands of sparse null columns; inflexible.
  - *Pure Entity-Attribute-Value (EAV) Relational Model*: Requires dozens of table joins for a single asset query; severe query performance penalty.
- **TRADE-OFFS**: Requires validating dynamic JSONB attributes against `equipment_attribute_definitions` at the application service layer.
- **RISK**: Malformed JSONB payloads if validation is bypassed. Mitigated by strict Zod schema validation interceptors.
- **FUTURE IMPACT**: Allows administrators to configure new equipment types, diagnostic fields, and dropdowns via ZENTRA Web in minutes with zero database downtime.

---

### ADR-010: Domain-Owned Delta Synchronization & Prohibition of Whole-Dataset Sync

- **DECISION**: Implement **Granular, Row-Level Delta Synchronization** governed by strict **Field Ownership Domains** (Source Owned, Admin Owned, Field Visit Owned, Server Operational), and strictly prohibit whole-dataset replacements.
- **WHY**: In legacy applications, downloading the entire database JSON, mutating it locally, and overwriting the remote file caused catastrophic data loss and test/live contamination. Domain-owned conflict arbitration ensures that offline field visit updates never overwrite online administrative reassignments, and spreadsheet re-imports never overwrite field notes.
- **ALTERNATIVES**:
  - *Naive Last-Write-Wins (LWW)*: Overwrites concurrent edits across domains indiscriminately; causes silent data loss.
  - *Operational Transformation (OT) / CRDTs*: Overkill for transactional field service tickets with clear domain boundaries.
- **TRADE-OFFS**: Requires developing and maintaining a stateful synchronization engine and conflict resolver.
- **RISK**: Complex client-side queue logic. Mitigated by comprehensive deterministic integration test suites.
- **FUTURE IMPACT**: Zero sync-induced data loss; high mobile performance over slow 2G/3G connections.

---

### ADR-011: Two-Phase Ingestion Pipeline with Human-in-the-Loop Approval

- **DECISION**: Enforce a mandatory **Two-Phase Staged Ingestion Pipeline** (Upload -> Staging Table -> Parsing & Normalization -> Duplicate & Anomaly Check -> Interactive Diff Preview -> Admin Approval -> Atomic Commit) for all bulk complaint imports.
- **WHY**: External government spreadsheets contain unmapped columns, misspelled headers, duplicate rows, and conflicting data. Ingesting raw files directly into production tables created corrupt records, wiped technician assignments, and duplicated open calls. Staging files into preview diffs guarantees that human coordinators catch anomalies before data is committed.
- **ALTERNATIVES**:
  - *Automated Background Ingestion*: Fast, but completely blind to column shifts, formatting corruptions, and erroneous duplicates.
- **TRADE-OFFS**: Requires administrator intervention to click "Approve" on imports.
- **RISK**: Administrator delays approving imports. Mitigated by visual urgency indicators and automated batch alerts.
- **FUTURE IMPACT**: Complete protection against dirty external data; 100% auditable import history.

---

### ADR-012: Advisory-Only Role for OCR and AI with Full Value Lineage

- **DECISION**: Position OCR and AI extraction services as **Strictly Advisory Pre-processors** with mandatory human verification and permanent value lineage tracking (`raw_extracted_value`, `normalized_value`, `confidence_score`, `human_corrected_value`).
- **WHY**: Scanned documents and mobile screenshots have varying resolution and handwritten text. Allowing AI to write authoritative production records autonomously introduces hallucinated UDISE codes, misassigned schools, and erroneous failure categories. Maintaining full lineage ensures complete auditability.
- **ALTERNATIVES**:
  - *Autonomous AI Ingestion*: Unacceptable legal and operational risk in public education infrastructure governance.
  - *Manual Typing Only (No OCR/AI)*: High administrative burden; slow ticket turnaround.
- **TRADE-OFFS**: Requires building side-by-side verification interfaces on ZENTRA Web.
- **RISK**: AI service outages. Mitigated by making OCR/AI an optional helper; manual entry is always fully supported.
- **FUTURE IMPACT**: AI accuracy can be continuously benchmarked against human corrections, creating a dataset for fine-tuning.

---

### ADR-013: Server-Side Multi-District Territory Authorization

- **DECISION**: Implement **Server-Enforced Territory Authorization** supporting many-to-many engineer allocations (`user_territory_assignments`) backed by PostgreSQL Row-Level Security (RLS).
- **WHY**: Analysis of real engineer travel ledgers proved that engineers do **not** operate under a simplistic 1:1 district model. Senior engineers regularly cover 2 to 3 adjacent districts or handle cross-district emergency drives. The architecture must permit multi-district scoping while strictly preventing unauthorized access to unassigned territories.
- **ALTERNATIVES**:
  - *Rigid 1:1 District Column on User*: Breaks real-world field dispatching; forces creating duplicate accounts for the same engineer.
  - *Client-Side Filtering*: Insecure; easily bypassed via API inspection or modified mobile builds.
- **TRADE-OFFS**: Requires joining `user_territory_assignments` in RLS security policies.
- **RISK**: Slower queries if territory join tables lack proper indexing. Mitigated by composite indexes on `(user_id, district_id)`.
- **FUTURE IMPACT**: Easily adapts to changing educational revenue districts and regional clustering.

---

### ADR-014: Fail-Closed Multi-Environment Isolation & Test Gating

- **DECISION**: Establish **Fail-Closed Environment Isolation** with explicit programmatic gates (`tests/production-gate.ts`) that instantly abort automated test suites if production environments, credentials, or hostnames are detected.
- **WHY**: Historical forensic analysis (`KI-004`, `TEST_STATUS.md`) revealed that automated test suites executed against live production systems, generating fake probe tickets (`PROBE AUTOMATION MTOBQMR4`) and creating synthetic folders in live Google Drive. Zero production credentials may ever exist in test configuration files.
- **ALTERNATIVES**:
  - *Manual Tester Vigilance*: Proven to fail repeatedly in practice.
- **TRADE-OFFS**: Developers must configure local mock containers (Docker PostgreSQL, MinIO) for testing.
- **RISK**: Test suites failing due to over-strict environment checks. Acceptable trade-off to ensure 100% production safety.
- **FUTURE IMPACT**: Complete confidence to run continuous integration (CI) pipelines without risk of production corruption.

---

### ADR-015: Configurable Business Rules (SLA Policies & Conveyance Reimbursement)

- **DECISION**: Model SLA turnaround durations and travel conveyance rates as **Configurable Dynamic Policies** (`sla_policies`, `conveyance_policies`), strictly avoiding hard-coded constants in application source code.
- **WHY**: Current observed operational values (Critical: 24h, High: 48h, Medium: 72h, Low: 7d; Motorcycle: ₹5.00/km) are **Candidate Business Rules** derived from historical discovery. Educational department contract terms, fuel rates, and regional SLAs change over time. Hard-coding constants requires code recompilation and redeployment for routine contractual updates.
- **ALTERNATIVES**:
  - *Hard-Coded Enums & Constants*: Brittle; violates Phase 0 and Phase 1 directives.
- **TRADE-OFFS**: Requires database queries or cached policy lookups when calculating breach times and travel claims.
- **RISK**: Missing policy configurations. Mitigated by seeding sensible default fallback policies.
- **FUTURE IMPACT**: The platform can be deployed across different states or educational boards with varying SLA contracts without changing application code.

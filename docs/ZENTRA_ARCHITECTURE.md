# ZENTRA — System Architecture Specification
## Hi-Tech Lab Field Service Management Platform

---

## 1. Executive Summary & Purpose

**ZENTRA** is an enterprise-grade, mobile-first field service management (FSM) platform purpose-built for the maintenance, repair, and operational governance of Information & Communication Technology (ICT) infrastructure across government school **Hi-Tech Labs**.

Hi-Tech Labs represent critical digital classroom infrastructure deployed across thousands of government high and higher secondary schools. When ICT hardware (computing, power, networking, surveillance, or interactive audio-visual systems) fails, educational programs and statewide computer-based assessments stall.

ZENTRA replaces ad-hoc spreadsheets, uncoordinated messaging groups, and error-prone legacy trackers with an integrated, three-surface platform:
1. **ZENTRA Field**: A resilient, offline-first mobile application designed for Field Engineers operating outdoors in low-connectivity rural environments.
2. **ZENTRA Web**: A centralized administration, dispatch, master data, SLA governance, and reporting portal for State Leads, District Coordinators, and System Administrators.
3. **ZENTRA Core**: A highly secure, transactional backend engine handling business rules, multi-tenant RBAC, staged data ingestion, evidence verification, and deterministic mobile synchronization.

---

## 2. High-Level Architectural Topology

ZENTRA is organized around three decoupled operational surfaces communicating through strict API boundaries:

```mermaid
graph TB
    subgraph "Field Surface"
        ZF["ZENTRA Field (Mobile Client)<br/>• Local-First SQLite / WatermelonDB<br/>• Offline Transaction Queue<br/>• Resumable Binary Media Queue<br/>• Accuracy-Gated GPS Camera Engine"]
    end

    subgraph "Core Business Surface (ZENTRA Core)"
        AGW["API Gateway & Reverse Proxy<br/>• TLS Termination<br/>• Rate Limiting & WAF<br/>• JWT / Session Auth Verification"]
        
        API["Core REST & Sync API<br/>• Service Case Management<br/>• Multi-District Dispatch Engine<br/>• Evidence Metadata Ledger<br/>• Audit & Security Interceptors"]
        
        SE["Sync & Conflict Engine<br/>• Delta Change Tracking<br/>• Domain-Owned Conflict Rules<br/>• Idempotent Transaction Resolver"]
        
        IW["Staged Ingestion Engine<br/>• XLSX/CSV Parsing & Normalization<br/>• Identity & Duplicate Evaluator<br/>• Staged Diff & Preview Store"]
        
        BW["Background Job Daemon (Worker)<br/>• SLA Ticker & Breach Alerts<br/>• Media Checksum & EXIF Verifier<br/>• Daily Aggregations & Tombstone Purge"]
        
        DB[("Authoritative Relational Database<br/>PostgreSQL 16+<br/>• Row-Level Security (RLS)<br/>• JSONB Dynamic Attribute Stores<br/>• Immutable Audit Tables")]
        
        OBJ[("Encrypted Object Storage<br/>S3-Compatible / MinIO<br/>• Slot-Isolated Photo Buckets<br/>• Pre-Signed Resumable Uploads<br/>• Immutable File Objects")]
    end

    subgraph "Management Surface"
        ZW["ZENTRA Web (Management Portal)<br/>• District & Engineer Dispatch Grids<br/>• Import Staging & Human Approval Diff<br/>• Real-Time SLA Monitor & Escalations<br/>• Multi-Dimensional Reporting Engine"]
    end

    ZF <-->|"HTTPS / REST (Delta Sync & Media Pre-Signed URLs)"| AGW
    ZW <-->|"HTTPS / REST (Admin APIs & Staging Review)"| AGW
    AGW --> API
    API --> SE
    API --> IW
    API --> DB
    SE --> DB
    IW --> DB
    BW --> DB
    BW --> OBJ
    API -.->|"Generate Pre-Signed PUT"| OBJ
    ZF -->|"Direct Binary Upload (PUT)"| OBJ
```

### The Three Operational Surfaces
1. **ZENTRA Field (Field Engineer Edge)**:
   - Primary operational surface.
   - Built to operate independently of real-time server connectivity.
   - Maintains an authoritative local database and an append-only transaction queue.
   - Enforces field evidence contracts (Slot 1 HM Signed Report and Slot 2 Equipment Photo) with hardware-level GPS verification.
2. **ZENTRA Core (Central Platform)**:
   - Contains all business logic, authorization policies, state machines, and relational persistence.
   - Exposes RESTful JSON endpoints for administrative operations and specialized delta synchronization endpoints for the mobile client.
   - Decouples background processing (SLA monitoring, file processing, report generation) via dedicated worker daemons.
3. **ZENTRA Web (Management & Governance Desk)**:
   - Desktop-optimized web application for administrators, coordinators, and state reporting heads.
   - Provides high-density data tables, multi-ticket dispatch boards, human-in-the-loop import staging wizards, and executive analytics.

---

## 3. Technology Evaluation & Selection Rationale

In Phase 1, technology options were rigorously evaluated against the primary project requirement: **a robust, mobile-first field engineering system operating across rural Tamil Nadu with unreliable network conditions, hardware GPS gating, and camera integration**.

### 3.1 Mobile Client Architecture Evaluation

| Framework Option | Offline Database Support | Native Hardware & Camera Control | Developer Velocity & Code Sharing | Ecosystem Stability | Evaluation Verdict |
|---|---|---|---|---|---|
| **Flutter (Dart)** | Excellent (Isar / drift / SQLite) | High (Native Camera / GPS plugins) | High across iOS/Android | High (Google backed) | **Strong Candidate** |
| **React Native + Expo** | Excellent (WatermelonDB / OP-SQLite) | Excellent (Camera / Geolocation) | Maximum (Shared TypeScript types with backend/web) | Very High (Mature) | **RECOMMENDED PRIMARY** |
| **Native Android (Kotlin)** | Maximum (Room / SQLite) | Maximum (CameraX / FusedLocation) | Zero web code sharing; higher maintenance overhead | Very High | Viable alternative for single-platform |
| **Progressive Web App (PWA)** | Fragile (IndexedDB storage quota evictions) | Poor (Background sync restricted; Safari/Android camera quirks) | High (Standard web) | Low durability in offline-heavy field environments | **REJECTED** |

> **Recommendation: React Native with TypeScript and WatermelonDB / OP-SQLite**.
> - Enables 100% shared TypeScript interfaces between ZENTRA Field, ZENTRA Web, and ZENTRA Core.
> - Proven reactive local-first database architecture (WatermelonDB) optimized for fast startup on low-cost Android hardware.
> - Direct access to native Android CameraX and Fused Location Provider APIs for strict <=50m GPS gating.

### 3.2 Web Frontend Architecture Evaluation
- **Option 1: React 18+ with Vite and Tailwind CSS (RECOMMENDED)**:
  - Lightning-fast build times, zero server-rendering complexity for internal administrative dashboards, full ecosystem compatibility with high-density data grids (TanStack Table), and headless component architecture.
- **Option 2: Next.js (App Router)**:
  - Powerful, but SSR/Edge complexity is unnecessary for an authenticated management portal behind corporate logins.

### 3.3 Backend API & Runtime Evaluation
- **Option 1: Node.js with NestJS / Fastify & TypeScript (RECOMMENDED)**:
  - Enterprise modular architecture (Dependency Injection, interceptors, guards).
  - High throughput with Fastify HTTP engine.
  - End-to-end type safety using shared Zod contracts between client and server.
- **Option 2: Go (Golang)**:
  - Superb raw concurrency and minimal memory footprint, but bifurcates contracts and models from the TypeScript frontend ecosystem.

### 3.4 Authoritative Database Evaluation
- **Option: PostgreSQL 16+ with Row-Level Security (RLS) (RECOMMENDED)**:
  - ACID-compliant relational core for financial ledgers, audit trails, and multi-district territory enforcement.
  - First-class `JSONB` support enables dynamic, schema-driven equipment attributes without requiring schema migrations for new hardware types.
  - Native Row-Level Security (RLS) provides a cryptographically tight defense against cross-district data leakage.

### 3.5 Local Mobile Database Evaluation
- **Option: WatermelonDB (SQLite engine via JSI) (RECOMMENDED)**:
  - Lazy loading: Can handle tens of thousands of school records with near-instant UI render on budget Android hardware.
  - Built-in observable synchronization protocol matching ZENTRA's delta-sync philosophy.

### 3.6 Media & Object Storage Evaluation
- **Option: S3-Compatible Object Storage (MinIO on-premise or AWS S3 / Cloudflare R2) (RECOMMENDED)**:
  - Pre-signed URL architecture allows mobile clients to upload 2MB–5MB photo binaries directly to object storage, bypassing the API gateway and eliminating payload bottlenecks.

---

## 4. Separation of Concerns: Source Complaint vs. ZENTRA Service Case

One of the foundational architectural lessons learned from historical system failures is the **absolute separation** between external complaint intake and physical field execution:

```mermaid
classDiagram
    class SourceComplaint {
        +UUID source_complaint_id
        +String source_system
        +String external_ticket_id
        +String original_title
        +String original_description
        +DateTime registered_date
        +String source_status
        +String source_priority
        +String reported_equipment
        +String reported_serial_no
        +String reporter_name
        +String reporter_phone
        +JSONB raw_source_payload
        +DateTime created_at
    }

    class ServiceCase {
        +UUID service_case_id
        +UUID source_complaint_id
        +String zentra_case_code
        +UUID lab_equipment_id
        +UUID school_id
        +UUID lab_id
        +ServiceStatus operational_status
        +Priority internal_priority
        +UUID primary_engineer_id
        +UUID secondary_engineer_id
        +DateTime assigned_at
        +String actual_diagnosis
        +String action_taken
        +VerificationStatus verification_status
        +DateTime resolved_at
        +DateTime closed_at
    }

    class FieldVisit {
        +UUID visit_id
        +UUID service_case_id
        +UUID engineer_id
        +DateTime visit_date
        +DateTime check_in_time
        +Decimal check_in_lat
        +Decimal check_in_lng
        +Decimal check_in_accuracy
        +String diagnosis_notes
        +String work_performed
        +VisitOutcome outcome
        +String pending_reason
        +DateTime next_follow_up_date
        +DateTime check_out_time
    }

    SourceComplaint "1" -- "0..1" ServiceCase : spawns
    ServiceCase "1" -- "1..*" FieldVisit : requires
```

### Key Architectural Boundaries
1. **Source Complaint Immutability**:
   - `SourceComplaint` captures external truth as logged by school teachers, helpline operators, or external department tools.
   - Neither Field Engineers nor District Coordinators may overwrite source descriptions, intake timestamps, or original reporter details.
2. **Service Case Dynamism**:
   - `ServiceCase` governs internal execution: which engineer is dispatched, what equipment was actually inspected, how many visits occurred, and what spares were consumed.
3. **Dual-Status Architecture**:
   - `source_status` (e.g., `Open`, `In Progress`, `Pending Verification` in external portals) is tracked separately from `operational_status` (e.g., `ASSIGNED`, `VISIT_IN_PROGRESS`, `PENDING_SPARES`, `RESOLVED`, `CLOSED` in ZENTRA).
   - Updating operational status in ZENTRA never destructively mutates historical source records.

---

## 5. Understanding the Statewide Scale: 8,209 Asset Records

Phase 0 analysis identified a statewide dataset containing 8,209 records (`HiTech Labs Live _ Down Assets_data (1).xlsx`). An essential architectural distinction must be enforced:

> [!IMPORTANT]
> **8,209 Records ≠ 8,209 Unique Labs.**
> The dataset represents **monitored asset / laboratory status snapshots** across schools in Tamil Nadu's 38 districts.
> 
> Within the data:
> - **Schools**: Distinct educational institutions identified by 11-digit national UDISE codes.
> - **Hi-Tech Labs**: Individual physical laboratory installations within a school (e.g., `33320100101_HL01` indicates Lab 1; larger higher secondary schools frequently have `HL01` and `HL02`).
> - **Equipment Records**: Multiple monitored asset items within each lab (e.g., Computers count, Router status, IP-Camera status, UPS status).
> 
> ZENTRA's relational model normalizes this into clean hierarchical entities: `District` → `Block` → `School` → `HiTechLab` → `LabEquipment`.

---

## 6. Configurable Business Rule Candidates vs. Permanent Rules

In accordance with Phase 1 directives, current field values observed during discovery are classified as **Current Business Rule Candidates** rather than hard-coded system invariants:

| Parameter | Current Observed Value | Architectural Classification | System Design Requirement |
|---|---|---|---|
| **SLA Critical Turnaround** | 24 Hours | Candidate Business Rule | Configurable via `SlaPolicy` entity |
| **SLA High Turnaround** | 48 Hours | Candidate Business Rule | Configurable via `SlaPolicy` entity |
| **SLA Medium Turnaround** | 72–96 Hours | Candidate Business Rule | Configurable via `SlaPolicy` entity |
| **SLA Low Turnaround** | 7 Days | Candidate Business Rule | Configurable via `SlaPolicy` entity |
| **Motorcycle Conveyance Rate** | ₹5.00 / km | Candidate Business Rule | Configurable via `ConveyancePolicy` entity |
| **GPS Geofence Accuracy** | <= 50 meters | Candidate Security Directive | Configurable per territory threshold |
| **Active Districts** | 38 Districts in Tamil Nadu | Reference Master Data | Dynamic database table; zero code hard-coding |

---

## 7. Component Interaction Flows

### 7.1 Complaint Ingestion & Staged Dispatch Flow

```mermaid
sequenceDiagram
    autonumber
    actor Admin as District Coordinator / Admin
    participant Web as ZENTRA Web
    participant Ingest as Staging Ingestion Engine
    participant DB as Authoritative PostgreSQL
    participant Worker as Background Daemon
    actor FE as Field Engineer
    participant Mobile as ZENTRA Field (Mobile)

    Admin->>Web: Uploads Complaints Spreadsheet (XLSX/CSV)
    Web->>Ingest: Post Raw File to /api/v1/imports/stage
    Ingest->>Ingest: Parse, Normalize, & Check Duplicates
    Ingest->>DB: Store in import_staging_records (Status: STAGED)
    Ingest-->>Web: Return Staged Diff & Anomaly Report
    Admin->>Web: Reviews Diff, Resolves Warnings & Clicks "Approve"
    Web->>Ingest: Post Approval Commit
    Ingest->>DB: Atomic Transaction: Insert SourceComplaints & ServiceCases
    Admin->>Web: Dispatches ServiceCase to Field Engineer
    Web->>DB: Update ServiceCase (assigned_engineer_id, operational_status='ASSIGNED')
    DB->>Worker: Enqueue Assignment Notification
    Worker-->>Mobile: Push Sync Notification
    Mobile->>DB: Pull Delta Sync (/api/v1/sync/pull)
    DB-->>Mobile: Deliver New ServiceCase + School Master Bundle
    Mobile->>FE: Displays "New Assigned Call" on Offline Device
```

### 7.2 On-Site Service & Evidence Completion Flow

```mermaid
sequenceDiagram
    autonumber
    actor FE as Field Engineer
    participant Mobile as ZENTRA Field (Mobile)
    participant LocalDB as Local SQLite / WatermelonDB
    participant API as ZENTRA Core API
    participant S3 as Object Storage
    participant DB as PostgreSQL

    FE->>Mobile: Arrives at School & Starts Visit
    Mobile->>Mobile: Hardware Check: Verify GPS Accuracy <= 50m
    Mobile->>LocalDB: Record Check-in (Lat, Lng, Accuracy, Timestamp)
    FE->>Mobile: Enters On-Site Diagnosis & Work Performed
    FE->>Mobile: Captures Slot 1 Photo (HM Signed Report)
    FE->>Mobile: Captures Slot 2 Photo (UPS/PC Working with GPS Watermark)
    Mobile->>LocalDB: Save Photos to Sandbox & Enqueue Sync Mutation
    FE->>Mobile: Completes Visit & Check-out
    
    rect rgb(240, 248, 255)
    Note over Mobile,S3: Connectivity Restored (Background Sync)
    Mobile->>API: Request Pre-Signed Upload URLs for Slot 1 & Slot 2
    API-->>Mobile: Return Pre-Signed S3 URLs
    Mobile->>S3: Binary PUT Slot 1 Image (Resumable)
    Mobile->>S3: Binary PUT Slot 2 Image (Resumable)
    Mobile->>API: Commit Sync Mutation (Visit Record + Evidence Metadata)
    API->>DB: Atomic Commit: Insert FieldVisit, EvidenceFiles, Update ServiceCase to RESOLVED
    DB-->>Mobile: Acknowledge Sync (client_operation_id confirmed)
    Mobile->>LocalDB: Mark Queue Item as SYNCED
    end
```

---

## 8. Summary of Architectural Guarantees

1. **Local-First Resilience**: Field Engineers never experience application stalls, blank screens, or lost data due to weak cellular coverage.
2. **Tamper-Evident Evidence**: Physical repairs are corroborated by isolated, dual-slot photographic evidence coupled with validated GPS coordinates.
3. **Data Integrity & Lineage**: Source complaints remain immutable; field execution is tracked independently; all mutations leave an append-only audit trail.
4. **Configuration-Driven Flexibility**: All hardware types, diagnostic fields, territories, SLA matrices, and travel expense rates are driven by database configurations.

# ZENTRA — Phase 0 Business Requirement Discovery

---

## 1. Objective

The objective of Phase 0 is to conduct an exhaustive business requirement and data discovery analysis for **ZENTRA — Hi-Tech Lab Field Service Management Platform**.

Phase 0 is an **ANALYSIS ONLY** phase. Its sole mandate is to understand the operational realities, real-world complaint data, field workflows, and lessons learned from historical systems, and to document these in a formal Project Requirements Document and Implementation Report.

---

## 2. Scope

The scope of Phase 0 includes:
1. Deep inspection of registered complaint datasets and asset lists across Tamil Nadu school Hi-Tech Labs.
2. Review of existing operational workflows, field visit logs, and conveyance ledgers.
3. Review of security forensics, failure modes, and architectural lessons from historical systems.
4. Definition of user personas, mobile-first field workflows, web management needs, and data lifecycles.
5. Strict enforcement of all negative constraints (no code, no DB migrations, no tech stack selection, no modification of existing systems).

### Out of Scope in Phase 0
- Writing application source code (backend, web, or mobile).
- Creating database schemas, tables, or migrations.
- Implementing APIs, authentication, OCR, or AI models.
- Deploying infrastructure or selecting concrete technologies.
- Modifying any legacy applications or existing files in other folders.

---

## 3. Files/Data Studied

The analysis investigated real datasets and technical records across the filesystem:

| File / Artifact Investigated | Type / Size | Records Analyzed | Verification Finding |
|---|---|---|---|
| `D:\Test App\data\HiTech Labs Live _ Down Assets_data (1).xlsx` | Excel Spreadsheet (3.4 MB) | 8,209 Rows | State-wide inventory of school Hi-Tech Labs across 38 districts; monitors Computers, Routers, IP-Cameras, and UPS. |
| `D:\Field call Tracker app\Field_Call_Tracker.xlsx` | Excel Spreadsheet (29.9 KB) | 53 Active Call Rows | Real field calls for Nagapattinam District; tracks UDISE, Issue, Category, AI Name, Contact, Status, Distance, Conveyance, Spares, and Visited By. |
| `D:\Ai Ticket App - UPS\data\Thiruvarur_HTL_Service_Desk_Master.csv` | CSV Dataset (21.9 KB) | 34 Ticket Rows | Multi-district service desk tickets (Nagapattinam & Thiruvarur); tracks Priority, Status, Reported Issues, Duration, Serial Numbers, Vendors, and 4 Photo URLs. |
| `D:\Ai Ticket App - UPS\Thiruvarur_22_Schools_UPS_Complaint_Tracker.csv` | CSV Dataset (4.0 KB) | 22 Urgent Rows | High-priority field complaint tracker; tracks Target Plan of Action (POA) Dates, exact issue descriptions, and verification statuses. |
| `D:\Ai Ticket App - UPS\data\htl_itsm_tickets.json` | JSON Database (69.2 KB) | 34 Rich Ticket Objects | Operational ticket lifecycle; tracks timeline events, Google Drive folder IDs, and dual completion evidence structure (`hmSignedReport` + `completionPhoto`). |
| `D:\Ai Ticket App - UPS\data\master_schools.json` | JSON Master (72.4 KB) | 262 Schools | School master dataset; contains school IDs (`TVR-011`), UDISE codes, categories (`GGHSS`, `GHSS`, `PUMS`), AI contact names, and phone numbers. |
| `D:\Ai Ticket App - UPS\Hi-Tech_Lab_Warriors_Thiruvarur_Google_Contacts.csv` | CSV Directory (66.8 KB) | 182 Contact Rows | Confirms official nomenclature: **AI = Administrator cum Instructor** (Lab Teacher); **HM = Headmaster / Headmistress**. |
| `D:\Travel Allowance\Mohamed Shameer Convayance Claim.xlsx` | Excel Ledger (18.5 KB) | 32 Claim Rows | Real field conveyance claim log of Field Engineer Mohamed Shameer; tracks motorcycle/bus travel, starting/ending km, and daily allowances across schools. |
| `D:\Ai Ticket App - UPS\docs\forensics\KI-001-report.md` | Markdown Forensic Report | 121 Lines | Forensic post-mortem on Google Apps Script execution timeout, silent file drop, and pseudo-success reporting. |
| `D:\Ai Ticket App - UPS\docs\KNOWN_ISSUES.md` | Markdown Issue Registry | 101 Lines | Documents historical vulnerabilities: KI-001 (GAS durability loss), KI-005 (evidence ID loss on 1.4MB payloads), KI-006 (token exposure on debug routes). |
| `D:\Ai Ticket App - UPS\docs\PROTECTED_GPS_ARCHITECTURE.md` | Architectural Directive | 34 Lines | Mobile Web GPS camera guidelines, <=50m accuracy threshold, metadata watermarking, and server-side EXIF validation. |

---

## 4. Complaint Data Findings

The empirical analysis yielded concrete facts regarding registered complaints:
- **Geographic Scale**: Verified coverage of 8,209 Hi-Tech Labs across all 38 districts of Tamil Nadu.
- **Natural Keys**: Schools are universally identified by 11-digit UDISE codes (e.g., `33190400501`), while individual labs within schools are identified by composite codes (e.g., `33320100101_HL01`).
- **Ticket IDs**: Multiple numbering schemes exist across intake channels:
  - Numeric IDs from external portals: e.g., `12511`, `12434`.
  - Structured incident identifiers: e.g., `HTL-NGP-01004-2`, `HTL-TVR-02601` (`HTL` = Hi-Tech Lab, `NGP` = Nagapattinam, `TVR` = Thiruvarur).
- **Intake Channels Identified**: Helpline calls (`HELPLINE TICKET`), Ticketing tool escalations (`TICKETING TOOL TICKET`), Google Forms submitted by teachers (`GOOGLE FORM - AI`), and internal service drives (`KS SMART`).
- **Classification Status**: **PASS** (Evidence directly verified from data files).

---

## 5. Mobile-First Findings

Investigation of field operational dynamics confirms that the primary user is the **Field Engineer**:
- Field engineers travel continuously between rural schools and spend their working hours on-site in school laboratories.
- Engineers require instant access to school contacts (AI Teacher & HM phone numbers) with 1-touch dialer integration.
- Data capture must be optimized for touch and outdoor sunlight, with minimal manual keyboard entry.
- Visual evidence capture (photographs of equipment and signed service reports) and GPS check-ins are core operational tasks that occur exclusively on mobile devices.
- **Classification Status**: **PASS** (Confirmed via field logs, conveyance claims, and architecture documents).

---

## 6. Web Application Findings

Investigation of administrative workflows confirms the necessity of **ZENTRA Web**:
- Central leadership and District Coordinators need oversight over state-wide / district-wide ticket backlogs.
- Ingestion of external complaint spreadsheets and service desk exports requires large-screen interfaces with interactive column mapping and duplicate preview modals.
- Dispatching engineers, reallocating tickets, and managing engineer workloads require comprehensive table grids and filtering.
- Departmental audit reviews require multi-dimensional reporting and Excel export.
- **Classification Status**: **PASS** (Confirmed via existing desktop spreadsheets and management dashboards).

---

## 7. Source vs Field-Service Findings

A critical finding from historical data is that **Source Complaint Data** and **Field-Service Data** have frequently been conflated, causing severe synchronization defects:
- In the source system, a ticket may remain "Pending" or "Open" for weeks while physical work is underway.
- When field engineers update their on-site status to "Work in Progress" or "Resolved", mapping this directly to the source status caused collisions with subsequent spreadsheet re-imports.
- Re-importing updated state spreadsheets frequently overwrote engineer notes and cleared assigned technician names.
- **Architectural Separation**: ZENTRA must maintain **Source Complaint Information** as immutable intake snapshots, while **Field-Service Information** tracks operational execution independently.
- **Classification Status**: **PASS** (Proven by regression history and data structure analysis).

---

## 8. User and Role Findings

- **Multi-District Engineers**: Historical records prove that engineers are **not** restricted to a single district. For example, Field Engineer Mohamed Shameer operates across Nagapattinam, Thiruvarur, and Mayiladuthurai. ZENTRA must support assigning an engineer to multiple districts.
- **Role Terminology**: Clarified domain terminology from real contact directories:
  - **AI**: Administrator cum Instructor (the dedicated computer teacher managing the Hi-Tech Lab).
  - **HM**: Headmaster / Headmistress (the head of the school who approves work and signs physical reports).
- **Core System Roles**: Master Admin, Reporting Head, District Coordinator, Field Engineer.
- **Classification Status**: **PASS** (Verified via contact books and conveyance logs).

---

## 9. Equipment Findings

> [!IMPORTANT]
> **ZENTRA IS DEFINITIVELY NOT A UPS-ONLY APPLICATION.**

Inspection of all 53 Nagapattinam complaints and 8,209 state asset records proves that complaints span a diverse array of ICT hardware. The following equipment categories are directly evidenced:
1. **Computers / CPUs / Monitors**: "SYSTEM 5,8 N/W NOT CONNECTED", "Two CPU not working", "Cpu and monitor current not supply".
2. **Network Switches**: "D-Link 8PORT SWITCH", "Cable grimped again at switch end".
3. **Routers**: "MERAKI ROUTER", "UNABLE TO CONNECT INTERNET", "Router Live/Down".
4. **Structured Cabling & I/O Ports**: "I/O BOX DAMAGED", "IO BOX PROBLEM", "patch cord not Attached", "Rj45 Jack".
5. **UPS & Power**: "Total Dead / No Power", "Continuous Beep Sound", "Isolation Transformer Tripping", "No Battery Backup".
6. **IP Surveillance Cameras**: "IP CAMERA NOT DELIVERED", "IP CAMERA BEING POSITIONED DOWNWARD".
7. **Web Cameras**: "WEB CAMERA NOT RECEIVED", "Web camera to smartboard wire missing".
8. **Projectors & Screens**: "Projector mountkit not received", "projector remote not received", "Projector screen damaged".
9. **Smartboards**: "computer to smartboard connected wire not receive".
10. **Headphones & Splitters**: "10 head phone splitters not received".
11. **Racks & Electrical Infrastructure**: "NO POWER CONNECTION IN 9U RACK", "Switch board broken".
12. **Lab Furniture**: "TWO SYSTEM TABLE NOT ASSEMBLED(SCREW NOT AVAILABLE)".

- **Classification Status**: **PASS** (Directly evidenced across complaint datasets).

---

## 10. Import/OCR/AI Findings

- Bulk complaint ingestion is required for Excel (`.xlsx`, `.xls`) and CSV files exported from external department portals.
- OCR and AI may eventually assist in reading scanned service logs or portal screenshots, but **AI must never be the authoritative source of truth**.
- **Human-in-the-Loop Gate**: All imports must stage data into a preview interface before committing to production.
- **Classification Status**: **PASS** (Requirements documented; implementation deferred).

---

## 11. Offline Findings

- Field Engineers frequently operate in remote and rural schools with zero or intermittent cellular connectivity.
- ZENTRA Field must allow offline viewing of assigned calls, offline note entry, and offline photo capture.
- Mutations must be stored in a persistent local queue and synchronized deterministically with exponential backoff when connectivity returns.
- **Classification Status**: **PASS** (Requirements documented; implementation deferred).

---

## 12. SLA and Reporting Findings

- SLA tiers are dictated by academic disruption: Critical (24 hours), High (48 hours), Medium (72–96 hours), Low (7 days).
- Real complaint records calculate ticket age in elapsed days (`Age (Days)`).
- Reporting must track: District, Block, School, Equipment Type, Failure Mode, Engineer Productivity, SLA Compliance %, and Conveyance Costs (`Distance × ₹5/km`).
- **Classification Status**: **PASS** (Directly verified from `Field_Call_Tracker.xlsx` KPI columns).

---

## 13. Security Findings

Analysis of historical forensics (`KI-001`, `KI-005`, `KI-006`, and codebase post-mortems) identified critical architectural hazards that ZENTRA is designed to avoid:
1. **Unsafe Whole-Dataset Writes**: Legacy code overwrote entire JSON files / database tables, leading to catastrophic data loss upon network failure. ZENTRA mandates atomic row-level mutations.
2. **Test / Live Contamination**: Test suites ran directly against live storage and databases, creating synthetic records and uploading mock files. ZENTRA mandates fail-closed environment gates.
3. **Transport Timeouts on Large Media Payloads**: Legacy apps sent 1.4MB base64 payloads through serverless webhooks, causing 55s timeout drops and lost evidence IDs. ZENTRA mandates direct chunked object uploads with pre-signed URLs or dedicated streaming routes.
4. **Resurrection of Deleted Records**: Soft-delete tombstones are required to ensure deleted records do not reappear on refetching.
5. **PII Protection**: Teacher and Headmaster mobile phone numbers must be protected from unauthorized harvesting.
6. **Classification Status**: **PASS** (Forensically confirmed via post-mortem reports).

---

## 14. Confirmed Requirements

The following requirements are confirmed by authentic project evidence:

| Requirement Area | Confirmed Requirement Detail | Verification Status |
|---|---|---|
| **Multi-Equipment Support** | Must support Computers, Switches, Routers, I/O Cabling, UPS, IP Cameras, Webcams, Projectors, Smartboards, and Electricals. | PASS |
| **Mobile-First Focus** | Field Engineer on ZENTRA Field is the primary operational actor. | PASS |
| **Source vs. Service Separation** | Source complaint snapshot and field-service execution must remain separate. | PASS |
| **Multiple Field Visits** | One service case must support 1 to N field visits. | PASS |
| **Dual Evidence Capture** | Resolution requires both an HM Signed Report and an Equipment Working Photo. | PASS |
| **Evidence Slot Isolation** | HM report and equipment photo must be isolated data entities. | PASS |
| **Offline Mobile Operation** | Local caching, offline data entry, and deterministic background sync. | PASS |
| **Multi-District Engineers** | Engineers can be allocated to multiple districts simultaneously. | PASS |
| **Dynamic Configuration** | Zero hard-coding of districts, equipment categories, OEMs, or statuses. | PASS |
| **Conveyance Tracking** | Tracking travel distance and calculating reimbursement claims. | PASS |
| **UDISE Master Data Index** | 11-digit national school UDISE codes as the primary institutional key. | PASS |
| **Atomic Durability** | Row-level mutations and elimination of whole-dataset writes. | PASS |

---

## 15. Possible Requirements

The following requirements are identified as potential operational enhancements:
1. Digital on-glass touchscreen signatures for Headmasters and Teachers.
2. Direct teacher-facing web portal for incident logging.
3. Barcode / QR code scanning of school asset tags.
4. Intelligent geographic route planning for field engineers.
5. External vendor / OEM extranet for warranty RMA tracking.
6. Automated SMS / WhatsApp status notifications to school staff.
- **Classification Status**: **NOT TESTED** (Requires stakeholder review).

---

## 16. REQUIRES CLARIFICATION

The following requirements could not be definitively determined from available files and require formal client clarification:
1. **Geofence Radius Threshold**: Exact allowable radius in meters (50m, 100m, or 250m) for valid school check-in.
2. **Sign-off Delegation Rules**: Is an AI Instructor signature legally valid when the Headmaster is absent?
3. **Multi-Lab Room Mapping**: Protocol for distinguishing equipment in schools with multiple labs.
4. **Third-Party Contractor Scope**: Whether external contractors will have direct login access.
5. **External API Integrations**: Whether state education portals will provide automated REST endpoints.
6. **Conveyance Rate Variations**: Uniformity of conveyance reimbursement rates across urban vs rural terrains.
- **Classification Status**: **NOT VERIFIED** (Pending user feedback).

---

## 17. Technology Decisions Deferred

In strict adherence to Phase 0 instructions, **zero technology choices have been made**:

| Component | Status | Deferred Options for Future Phases |
|---|---|---|
| Mobile Framework | DEFERRED | Flutter, React Native, Expo, Native Kotlin, PWA |
| Web Framework | DEFERRED | React, Next.js, Vue, Angular, Svelte |
| Backend Runtime | DEFERRED | NestJS, Fastify, Express, Go, Python/FastAPI |
| Database Engine | DEFERRED | PostgreSQL, MySQL, MongoDB |
| Object Storage | DEFERRED | AWS S3, Google Cloud Storage, MinIO, Azure Blob |
| Auth System | DEFERRED | Custom Session/JWT, Supabase Auth, Firebase, Keycloak |
| OCR / AI Engine | DEFERRED | Tesseract, Google Vision, AWS Textract, Gemini, Claude |
| Hosting Infrastructure | DEFERRED | AWS, GCP, Vercel, Self-hosted VPS / Docker |

- **Classification Status**: **NOT APPLICABLE** (Intentionally deferred by specification).

---

## 18. Safety / Scope Validation

Validation against all Phase 0 absolute restrictions:

| Checklist Validation Item | Status | Verification Evidence |
|---|---|---|
| Actual complaint data studied | PASS | Analyzed 8,209 asset rows, 53 field calls, 34 tickets, 22 urgent trackers. |
| Relevant project documents studied | PASS | Analyzed KI-001 forensic report, KNOWN_ISSUES, DECISIONS, ARCHITECTURE. |
| Mobile-first requirements identified | PASS | Detailed in Section 3 & 24 of Requirements Document. |
| Web requirements identified | PASS | Detailed in Section 25 of Requirements Document. |
| Source complaint data separated from field-service data | PASS | Detailed in Section 6 & 7 of Requirements Document. |
| ZENTRA not treated as UPS-only | PASS | 12 distinct equipment categories identified and documented. |
| District count not hard-coded | PASS | Configuration-driven architecture specified for all 38 districts. |
| Equipment types not hard-coded | PASS | Extensible taxonomy defined in Section 9 & 23. |
| Technology decisions deferred | PASS | No frameworks, databases, or cloud vendors chosen. |
| Unclear requirements marked REQUIRES CLARIFICATION | PASS | 6 specific items flagged in Section 16 & Section 29. |
| No application code written | PASS | Zero `.ts`, `.tsx`, `.js`, or `.py` application files created. |
| No database created | PASS | Zero database tables, schemas, or migrations created. |
| No production data modified | PASS | Zero existing files or production systems altered. |
| Existing Field Call Tracker not modified | PASS | `D:\Field call Tracker app` and `D:\Ai Ticket App - UPS` untouched. |
| No deployment performed | PASS | Zero deployments triggered. |
| Only the two requested documentation files created | PASS | Only `docs/ZENTRA_PROJECT_REQUIREMENTS.md` and `docs/MUSE_SPARK_IMPLEMENTATION_REPORT_PHASE0.md` created in `d:\Zentra`. |

---

## 19. Phase 0 Conclusion

Phase 0 Business Requirement & Data Discovery is **COMPLETE**.

All project datasets, historical lessons, operational workflows, and security considerations have been rigorously synthesized into the authoritative **ZENTRA Project Requirements Document** (`docs/ZENTRA_PROJECT_REQUIREMENTS.md`) and this **Phase 0 Implementation Report**.

Every restriction has been strictly respected: no code was written, no database was created, no technologies were selected, and no existing project files were modified.

STOPPED AFTER THIS STEP — AWAITING REVIEW.

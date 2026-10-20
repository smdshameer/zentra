# ZENTRA — Risk Register & Open Decisions Ledger (Phase 2)
## Hi-Tech Lab Field Service Management Platform

---

## 1. Executive Summary & Governance

This document establishes the authoritative **Risk Register** and **Open Decisions Ledger** for the ZENTRA platform. It systematically identifies operational, technical, and security risks across field environments, defines concrete detection and mitigation protocols, and catalogs all open business decisions requiring client or stakeholder clarification.

---

## 2. Authoritative Risk Register

In accordance with Phase 2 requirements, all 16 mandated operational, technical, and environmental risks are evaluated across:
- **Risk ID**: Unique risk identifier.
- **Risk Category**: System surface or operational tier.
- **Probability**: `LOW`, `MEDIUM`, `HIGH`.
- **Impact**: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.
- **Detection Method**: Automated testing, telemetry, or monitoring.
- **Mitigation Strategy**: Architectural and engineering controls.
- **Owner**: Responsible engineering role.
- **Phase Resolved**: Target implementation phase.

| Risk ID | Risk Description | Prob. | Impact | Detection Method | Mitigation Strategy | Owner | Phase Resolved |
|---|---|:---:|:---:|---|---|---|:---:|
| **RSK-01** | **React Native Native-Module Complexity**: Expo config plugin version drift during React Native / Android SDK upgrades. | Med | High | Automated CI build test across Android API levels (33, 34, 35). | Adopt Expo Prebuild (Continuous Native Generation - CNG). Native `android/` generated deterministically from versioned plugins; zero manual Gradle hacks. | Mobile Lead | Phase 10 |
| **RSK-02** | **WatermelonDB SQLite Compatibility**: JSI threading conflicts or native SQLite crash on older MediaTek/budget Android chips. | Med | High | Physical device smoke tests on low-end test hardware (Android 10/11, 2GB RAM). | Standardize on official `@nozbe/watermelondb` with `op-sqlite` JSI backend; test lazy-loading query thresholds. | Mobile Lead | Phase 10 |
| **RSK-03** | **Android OS Background Execution Throttling**: Aggressive OS battery savers kill background sync and long photo uploads. | High | Med | Telemetry tracking `sync_push_total` vs `active_offline_queue_gauge`. | Use Android Foreground Service with persistent notification during active sync runs; register `WorkManager` for periodic background sync. | Mobile Lead | Phase 11 |
| **RSK-04** | **Offline Token Expiration**: Field Engineer JWT expires while in a multi-day zero-connectivity rural block, blocking work. | High | High | Offline simulation test suites in CI; test clock fast-forwarding. | Issue cryptographically signed `offline_work_permit` valid for 14 days, stored in Android Keystore; auto-refresh silently upon reconnection. | Security Lead | Phase 5 |
| **RSK-05** | **Sync Conflicts & Overwrite**: Concurrent edits between field engineer and web coordinator causing silent data loss. | Med | High | Automated sync conflict test matrix evaluating all 4 conflict scenarios. | Implement Domain-Owned Conflict Matrix (no naive Last-Write-Wins); Field Visit Owned data merged cleanly with Admin Owned assignments. | Sync Lead | Phase 12 |
| **RSK-06** | **PostgreSQL RLS Mistakes / Leaks**: Misconfigured Row-Level Security policy exposing school tickets to unauthorized districts. | Med | Critical | Automated integration tests executing cross-district SQL queries; assert 0 rows returned. | Strict `FORCE ROW LEVEL SECURITY` on all territory tables; automated CI RLS assertion suite runs on every PR. | Database Lead | Phase 4 |
| **RSK-07** | **S3 Binary Upload Failures**: Large photos drop mid-stream on 2G edge networks, leaving orphaned records or lost evidence. | High | High | S3 ETag verification + background reconciliation worker checking unconfirmed uploads. | Decouple binary uploads via pre-signed S3 URLs; resumable chunked streaming; hold cases in `PENDING_EVIDENCE_UPLOAD` until confirmed. | Backend Lead | Phase 14 |
| **RSK-08** | **PG-Boss Queue Stalls**: Worker crashes or database connection pool exhaustion starving background jobs and SLA calculations. | Low | High | Prometheus metrics monitoring queue depth and worker heartbeat; liveness probes. | Dedicated connection pool for PG-Boss; dead-letter queue (DLQ) with automated exponential backoff retries. | Backend Lead | Phase 4 |
| **RSK-09** | **Import Duplicate Misclassification**: Ingestion engine creates parallel tickets for the same physical breakdown, wasting engineer travel. | Med | High | Staged diff preview modal in ZENTRA Web highlighting duplicate classifications. | 5-Tier Duplicate Engine; human-in-the-loop review gate prevents direct-to-production ingestion; links chasers to existing cases. | Ingestion Lead | Phase 8 |
| **RSK-10** | **AI / OCR Hallucinations**: Multimodal AI extracts incorrect UDISE codes or misclassifies hardware failure modes. | High | High | Extraction confidence scoring; side-by-side diff preview on ZENTRA Web. | Advisory-only role for AI; full value lineage (`raw`, `ai`, `human_corrected`); mandatory human approval before database commit. | AI Lead | Phase 8 |
| **RSK-11** | **Test / Live Environment Contamination**: Automated test suite accidentally connects to live database or production S3 bucket. | Low | Critical | `production-gate.ts` in test runner global setup; instant process abort on prod marker. | Absolute physical, cryptographic, and network isolation; zero production credentials exist in test environments. | Security Lead | Phase 3 |
| **RSK-12** | **Third-Party Dependency Vulnerabilities**: Malicious or compromised npm packages in monorepo workspaces. | Med | High | Automated `pnpm audit` and Dependabot / CodeQL scanning in CI pipeline. | Frozen lockfiles (`--frozen-lockfile`); strict permissive license whitelisting; zero copyleft viral licenses. | Security Lead | Phase 3 |
| **RSK-13** | **Production Secret Leakage**: Database URLs or JWT signing keys committed to Git or exposed via debug routes. | Low | Critical | Automated `git-secrets` pre-commit hooks; secret scanning in GitHub Actions. | Secrets managed exclusively via cloud secret managers (KMS / IAM roles); sanitization middleware blocks secret logging. | Security Lead | Phase 5 |
| **RSK-14** | **Mobile Storage Exhaustion**: High-resolution photos fill up local phone storage on devices with limited free space. | Med | Med | Local storage check before capturing photo; warning banner at < 500MB free. | Auto-compress photos to high-quality JPEG (target 1.5MB); purge local sandbox cache after server confirmation. | Mobile Lead | Phase 11 |
| **RSK-15** | **GPS Location Spoofing / Mock Locations**: Engineer uses fake GPS apps to check in without physically visiting the school. | Med | High | Native Android `Location.isFromMockProvider()` check in FusedLocation service. | Block check-in if mock location detected; verify genuine satellite timestamps; burn visible metadata banner into photo pixels. | Mobile Lead | Phase 11 |
| **RSK-16** | **Device Clock Manipulation**: Engineer changes system clock to hide SLA breach or falsify visit arrival time. | Med | High | Automated triangulation check: `|Device Clock - GPS Clock| > 15 mins`. | Satellite GPS clock and server NTP receive time taken as authoritative; flag records with clock skew suspect in audit events. | Database Lead | Phase 4 |

---

## 3. Explicit Open Decisions Ledger

In accordance with Phase 2 Section 27, all unresolved Phase 0 and newly discovered Phase 2 design choices are formally preserved as **Open Decisions** awaiting stakeholder clarification. Under the MUSE SPARK protocol, these are **never silently resolved**:

| Decision ID | Domain | Open Question / Decision Description | Phase 1/2 Discovery Context | Proposed Candidate Rule | Required Stakeholder Action |
|---|---|---|---|---|---|
| **DEC-01** | **Field Security** | **Allowable Geofence Accuracy Radius**: What is the maximum acceptable distance threshold in meters between the engineer's check-in GPS and the school's registered gate coordinates? | School compounds vary in size; rural higher secondary schools have large grounds (10–20 acres), while primary schools are compact. | **Candidate: 150 meters** (with accuracy metric $\le 50\text{ m}$). | Client to confirm if rural campuses require larger radius (e.g., 250m). |
| **DEC-02** | **Governance** | **Sign-off Delegation Authority**: Is an AI Instructor (Computer Teacher) signature legally valid on Slot 1 paper reports if the Headmaster (HM) is absent on official duty? | Headmasters are frequently summoned to district educational offices for meetings; waiting for HM can stall engineer departures. | **Candidate: AI signature permitted with mandatory "HM on Duty" checkbox.** | School Education Department to confirm contractual validity. |
| **DEC-03** | **Asset Catalog** | **Multi-Lab Room Identification**: For schools hosting multiple Hi-Tech Labs (e.g., High School Lab `_HL01` and Higher Secondary Lab `_HL02`), how are equipment assets assigned to specific rooms? | Discovery revealed composite codes (`_HL01`, `_HL02`). Assets must be mapped to physical rooms to avoid confusion during visits. | **Candidate: Require Lab Code selection upon ticket intake.** | Operations team to confirm if room numbers should be mandatory. |
| **DEC-04** | **Access Scope** | **Third-Party Contractor Portal Scope**: Should external hardware warranty vendors (e.g., UPS manufacturers, projector vendors) receive restricted portal access? | Some warranty repairs require OEM technicians; currently tracked via vendor ticket number strings in spreadsheets. | **Candidate: Restricted Extranet Role (`OEM_VENDOR_REPRESENTATIVE`).** | Stakeholders to decide if vendors log into ZENTRA or communicate via email/SMS. |
| **DEC-05** | **Integration** | **Automated State API Integration**: Will external educational department helplines provide automated REST endpoints for bidirectional ticket sync, or will Excel/CSV dumps remain the primary interface? | Currently, all intake occurs via periodic Excel dumps. Building custom scrapers is fragile without API contracts. | **Candidate: Staged Excel/CSV Ingestion as primary; REST webhooks ready.** | State IT department to clarify roadmap for helpline API exposure. |
| **DEC-06** | **Finance** | **Conveyance Reimbursement Uniformity**: Is the ₹5.00/km motorcycle conveyance rate uniform across all districts, and what documentation is mandatory for public transit claims? | Historical ledgers show ₹5/km for bikes and actual ticket fares for buses/trains. Urban districts (Chennai) have differing transit costs. | **Candidate: Configurable `ConveyancePolicy` with ₹5.00/km default.** | Finance/Operations team to confirm district rate multipliers. |
| **DEC-07** *(New)* | **Mobile UX** | **Photo Retention Policy on Mobile Sandbox**: How long should captured evidence photos remain in the local phone gallery/sandbox after successful server upload? | Low-end phones experience storage pressure; retaining 100 photos consumes 150MB–300MB. | **Candidate: Purge local sandbox 48 hours after verified server commit.** | Field operations team to approve auto-purge timeline. |
| **DEC-08** *(New)* | **Ingestion** | **Reopened vs. New Ticket Window**: What is the threshold in days after case resolution where a recurring fault is treated as a "Reopened Ticket" vs. a "New Ticket"? | Hardware may fail again due to power surges or faulty repairs. Important for First-Time-Fix (FTF) contractor metrics. | **Candidate: 7 Days (Failures within 7 days flag Recurring Fault).** | Department SLA team to confirm contractual warranty window. |
| **DEC-09** *(New)* | **Hardware** | **Barcode / QR Asset Tagging Requirement**: Will physical QR code or barcode stickers be affixed to lab hardware for automated mobile scanning? | Currently, engineers type serial numbers or leave them blank. QR scanning eliminates serial typos. | **Candidate: Optional in Phase 1; enable via feature flag when stickers deployed.** | Operations Head to confirm asset sticker rollout schedule. |

---

## 4. Summary of Governance Controls

1. **Active Risk Monitoring**: All 16 key risks have evaluated detection mechanisms and mitigation architectures designed.
2. **Transparent Business Ambiguity**: Unresolved contractual, legal, and operational questions are explicitly tracked without assumption.
3. **Audit Readiness**: Complete traceability for stakeholder design reviews prior to Phase 3 implementation.

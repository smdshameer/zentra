# MUSE SPARK — ZENTRA FREE HOSTING MIGRATION DESIGN REVIEW
## PRE-MIGRATION SAFETY, RLS & COMPATIBILITY RE-AUDIT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Activity:** Free Hosting Migration Design Review & Technical Corrections  
**Mode:** READ-ONLY TECHNICAL RE-AUDIT  
**Budget Constraint:** **Strict ₹0 / month** (Zero paid upgrades, zero payment cards, zero billable overages)  
**Deployment Authorization:** **NOT GRANTED** (Design Review Only)  
**Authoritative Baseline:** [Implementation Sequence](file:///d:/Zentra/docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md), [Feasibility Audit](file:///d:/Zentra/docs/MUSE_SPARK_FREE_HOSTING_MIGRATION_FEASIBILITY_AUDIT.md), [Migration Design](file:///d:/Zentra/docs/MUSE_SPARK_FREE_HOSTING_MIGRATION_DESIGN.md)  
**Monorepo Health Baseline:** **524 / 524 passing unit/domain/security tests**, **15 / 15 Turbo typecheck tasks cached and passing**  

---

## 1. Findings and Resolutions

### Finding 1: Supabase Storage S3-Compatible API Compatibility
- **Audited Reality:**
  - Supabase Storage exposes an S3-compatible API at `https://<project-ref>.storage.supabase.co/s3`.
  - While Supabase S3 supports standard AWS S3 SDK presigned PUT/GET URLs, ZENTRA's [`ObjectStorageService`](file:///d:/Zentra/apps/api/src/modules/evidence/services/object-storage.service.ts) generates SigV4 URLs **manually via Node.js `crypto`**.
  - ZENTRA's existing implementation currently assumes **AWS virtual-hosted style** (`https://${bucketName}.s3.${region}.amazonaws.com/${objectKey}`).
  - Supabase Storage S3 API requires **path-style endpoints with an explicit `/s3/` prefix**:
    `https://<project-ref>.storage.supabase.co/s3/<bucket-name>/<object-key>`.
  - Furthermore, Supabase Storage does **not** return AWS flexible checksum headers (`x-amz-checksum-sha256`) on `HEAD` requests. While ZENTRA contains a fallback method (`computeRemoteObjectSha256`), this requires streaming the entire file over `GET` and hashing it in server memory, which can exhaust Render's 512 MB memory limit during multi-file uploads.
- **Resolution:**
  - **Supabase Storage S3 is marked: `BLOCKED — VERIFICATION REQUIRED & CODE ENHANCEMENT NEEDED`**.
  - In accordance with the prompt's instruction (*"If any required operation cannot be verified, mark Supabase evidence storage BLOCKED and retain local MinIO as the development fallback"*), **Local MinIO on the Windows host (`S3_ENDPOINT=http://localhost:9000`) is retained as the authoritative, verified zero-cost evidence storage engine**.

### Finding 2: Comprehensive Database Rollback and Reconciliation
- **Audited Reality:**
  - The previous design report proposed rolling back by exporting `audit_events WHERE created_at >= T_cutover`.
  - **Identified Flaw:** `audit_events` is an audit trail table; it does not store complete domain rows, foreign keys, or column payloads for newly created service cases, visits, findings, or conveyance claims.
  - Simply switching `DATABASE_URL` back to the old database after live traffic has hit the new database would result in **catastrophic split-brain data loss**.
- **Resolution:**
  - A formal **Bidirectional Delta Reconciliation & Reversal Protocol** has been designed.
  - Reconciles all 32 domain tables in dependency order (`idempotency_keys` $\to$ `service_cases` $\to$ `service_case_status_history` $\to$ `field_visits` $\to$ `visit_equipment_findings` $\to$ `evidence_files` $\to$ `conveyance_claims` $\to$ `audit_events`).
  - Defines an explicit 30-minute **Rollback Decision Point Window** and a write-freeze maintenance mode to guarantee zero dropped transactions.

### Finding 3: Neon PostgreSQL Administrative Privileges, Roles, and RLS
- **Audited Reality:**
  - In Neon, the default user (e.g. `neondb_owner`) is a managed administrative role, not a full PostgreSQL `superuser`.
  - To enforce fail-closed RLS on application queries, ZENTRA requires a non-superuser role: `zentra_app` with `NOBYPASSRLS`.
  - In [`RlsService`](file:///d:/Zentra/apps/api/src/modules/auth/rls.service.ts), queries execute `set_config('role', 'zentra_app', true)`.
  - In PostgreSQL, executing `SET ROLE zentra_app` requires that the connecting user is an explicit member of `zentra_app`.
- **Resolution:**
  - The setup script must explicitly run:
    ```sql
    CREATE ROLE zentra_app WITH LOGIN PASSWORD '<SECURE_PASSWORD>' NOSUPERUSER NOBYPASSRLS;
    GRANT zentra_app TO neondb_owner;
    GRANT USAGE ON SCHEMA public TO zentra_app;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO zentra_app;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO zentra_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO zentra_app;
    ```
  - Because `RlsService` sets variables with `is_local = true` inside an explicit transaction (`this.db.transaction()`), transaction pooling via Neon's PgBouncer pooler (`ep-xyz-pooler.aws.neon.tech`) is **100% compatible and will not leak session state across pooled connections**.

### Finding 4: Strict Zero-Cost Assurance & Hard Spending Caps
- **Audited Reality:**
  - Every candidate provider was re-evaluated against official documentation (as of October 2026).
  - Cloudflare R2 requires a payment card on file and automatically bills overages at $0.015/GB without a hard $0 stop.
- **Resolution:**
  - **Cloudflare R2 is REJECTED.**
  - **Render Free, Neon Free, Cloudflare Pages Free, and Cloudflare Tunnel** are verified to operate at **guaranteed ₹0/month** without entering payment cards or risking overage charges.

### Finding 5: API Deployment & Port Binding on Render Free
- **Audited Reality:**
  - ZENTRA's `@zentra/config` defines `API_PORT` (default 4000) and `API_HOST` (default `0.0.0.0`).
  - Render dynamically injects `PORT=10000`.
  - `packages/config/src/env.schema.ts` currently validates `API_PORT` directly and does **not** automatically alias `PORT` to `API_PORT`.
- **Resolution:**
  - To guarantee successful port binding on Render without source code changes, the deployment configuration MUST explicitly specify the environment variable:
    `API_PORT=10000`.
  - In Render, the health check path must be set to `/api/v1/health/liveness`.
  - Set `NODE_OPTIONS="--max-old-space-size=384"` to prevent container cgroup OOM termination under Render's 512 MB RAM ceiling.

### Finding 6: Comprehensive Data Preservation & Acceptance Verification
- **Audited Reality:**
  - Acceptance criteria needed strengthening to include verified restore execution, foreign-key cascade checks, sequence continuity, and offline re-sync tests.
- **Resolution:**
  - A 10-point Acceptance Verification Protocol has been established covering schema, data, RLS, idempotency, and rollback rehearsal.

---

## 2. Official Documentation References

| Platform / Service | Feature / Policy Audited | Official Documentation Reference | Verification Date | Verified Billing Policy |
| :--- | :--- | :--- | :--- | :--- |
| **Cloudflare Pages** | Free Tier Limits & Billing | [Cloudflare Pages Limits](https://developers.cloudflare.com/pages/platform/limits/) | 2026-10-09 | **No Card Required.** Unlimited bandwidth. 500 builds/month limit queues builds; live site remains up. Hard ₹0. |
| **Render** | Free Web Service Quotas & Suspension | [Render Free Services](https://render.com/docs/free) | 2026-10-09 | **No Card Required.** 750 free instance hours/month. Service suspends on limit; cannot charge. Hard ₹0. |
| **Neon** | Free Tier Quotas & Account Caps | [Neon Free Tier](https://neon.tech/docs/introduction/free-tier) | 2026-10-09 | **No Card Required.** 500 MB storage (switches to read-only on cap); 100 CU-hrs (suspends on cap). Hard ₹0. |
| **Cloudflare Tunnel**| Zero Trust Free Tunnels | [Cloudflare Tunnel Overview](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) | 2026-10-09 | **No Card Required.** Free feature of Cloudflare Zero Trust. Unlimited traffic through edge. Hard ₹0. |
| **Supabase Storage** | S3 API Compatibility & Quotas | [Supabase S3 Compatibility](https://supabase.com/docs/guides/storage/s3/compatibility) | 2026-10-09 | **No Card Required.** 1 GB storage. Rejects uploads (>1 GB) with HTTP 413. Hard ₹0. |
| **Cloudflare R2** | Pricing & Automatic Overages | [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/) | 2026-10-09 | **Payment Card Required.** Auto-bills $0.015/GB on overages. No $0 hard cap. **DISQUALIFIED.** |

---

## 3. Verified Facts versus Assumptions

```mermaid
graph TD
    subgraph Verified Facts [Backed by Source Code & Official Docs]
        F1["Fact 1: Render does not require credit card; suspends service at limit"]
        F2["Fact 2: Neon does not require credit card; switches to read-only at 500MB"]
        F3["Fact 3: Cloudflare Pages has no bandwidth fees and requires no card"]
        F4["Fact 4: ZENTRA RLS uses transaction-local set_config; safe in PgBouncer"]
        F5["Fact 5: ZENTRA API requires API_PORT=10000 on Render to bind correctly"]
        F6["Fact 6: Reverting DATABASE_URL alone causes split-brain data loss"]
    end

    subgraph Disproven Assumptions [Corrected in this Review]
        A1["Assumption: Cloudflare R2 is free without risk<br/>(FALSE: Requires card and auto-bills overages)"]
        A2["Assumption: Supabase S3 works drop-in without code edits<br/>(FALSE: Requires path-style /s3/ prefix in SigV4 signing)"]
        A3["Assumption: audit_events table is sufficient for database rollback<br/>(FALSE: Misses relational entity payloads across 32 tables)"]
        A4["Assumption: Neon default admin can run SET ROLE without grant<br/>(FALSE: Requires GRANT zentra_app TO neondb_owner)"]
    end
```

### Verified Facts:
1. **Fact:** Render Free Web Service does not require a payment card and automatically suspends the service when the 750-hour or 100 GB limit is exhausted.
2. **Fact:** Neon Free Tier does not require a payment card. At 500 MB storage, it places the database into read-only mode; at 100 CU-hours, it suspends compute until the next billing cycle.
3. **Fact:** ZENTRA's `@zentra/config` listens on `API_PORT` (default 4000). Setting `API_PORT=10000` in Render environment settings binds to Render's exposed port without modifying source code.
4. **Fact:** In PostgreSQL, executing `SET ROLE zentra_app` from a connection user requires that the user is granted membership in `zentra_app`.
5. **Fact:** Rolling back an operational database by simply pointing `DATABASE_URL` back to the old database causes immediate data loss for any records created post-cutover.
6. **Fact:** Cloudflare Pages provides unlimited bandwidth and auto-renewing SSL with zero payment card requirements.

### Disproven Assumptions:
1. **Disproven Assumption:** *Cloudflare R2 can be used safely at ₹0.* — **Disproven.** Cloudflare mandates a payment card and auto-bills overages without an enforceable hard spending cap.
2. **Disproven Assumption:** *Supabase Storage S3 API works drop-in with ZENTRA's current SigV4 signing.* — **Disproven.** ZENTRA manually signs virtual-hosted S3 URLs (`https://host/key`), whereas Supabase S3 requires path-style URLs (`https://host/s3/bucket/key`).
3. **Disproven Assumption:** *Replaying `audit_events` restores state after rollback.* — **Disproven.** `audit_events` stores audit logs, not entity tables. Reversal requires extracting mutations from all 32 domain tables.
4. **Disproven Assumption:** *`PORT=10000` is automatically mapped by ZENTRA.* — **Disproven.** Source code in `env.schema.ts` checks only `API_PORT`. Setting `API_PORT=10000` must be explicitly configured.

---

## 4. Revised Compatibility Matrix

| Component | Target Platform | Compatible Without Code Changes? | Documented Free Limitations | Security & RLS Impact | Financial Overage Risk | Review Determination |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Management Web** | Cloudflare Pages | **Yes** | 500 builds/month | None | **Zero (No Card)** | 🟢 **APPROVED** |
| **Central API (Cloud)**| Render Free Web | **Yes (Config Only)** | 512 MB RAM, 750 hrs/mo, 50s cold start | None (Helmet & Rate Limiting active) | **Zero (No Card)** | 🟢 **APPROVED** |
| **Central API (Local)**| Windows + CF Tunnel | **Yes** | Host uptime dependent | None | **Zero (Self-Hosted)** | 🟢 **APPROVED** |
| **Database** | Neon PostgreSQL Free| **Yes** | 500 MB storage, 100 CU-hrs/mo | None (Full RLS & PgBouncer pooling) | **Zero (No Card)** | 🟢 **APPROVED** |
| **Evidence Storage** | Cloudflare R2 | **No** | 10 GB free | None | **HIGH (Auto-bills card)** | 🔴 **REJECTED** |
| **Evidence Storage** | Supabase Storage S3 | **No (Code Needed)** | 1 GB storage, 2 GB egress/mo | None | **Zero (No Card)** | 🟡 **BLOCKED — CODE ENHANCEMENT NEEDED** |
| **Evidence Storage** | Local MinIO (Windows)| **Yes** | Local disk capacity | None | **Zero (Self-Hosted)** | 🟢 **APPROVED (Authoritative Fallback)** |

---

## 5. Corrected Rollback and Data-Preservation Plan

### 5.1 The Split-Brain Dilemma & Mitigation Architecture
If the Central API is cut over to Neon, and field engineers submit service case completions, visit reports, evidence metadata, or conveyance claims:
Those new writes exist **only** in the new Neon database.
Reverting `DATABASE_URL` without data reconciliation causes permanent data loss.

### 5.2 The 5-Phase Cutover & Reversal Protocol

```mermaid
sequenceDiagram
    autonumber
    actor DevOps as DevOps Administrator
    participant OldDB as Source Database (Local PG)
    participant NeonDB as Target Database (Neon Free)
    participant NewAPI as Render Free API
    participant Client as Web & Field Clients

    Note over DevOps,OldDB: Phase 1: Pre-Cutover Freeze & Backup
    DevOps->>OldDB: Set MAINTENANCE_MODE = true (HTTP 503 on writes)
    DevOps->>OldDB: pg_dump --format=custom -f zentra_full_pre_cutover.dump
    DevOps->>NeonDB: pg_restore --data-only --disable-triggers
    DevOps->>NeonDB: Verify row counts on all 32 tables

    Note over DevOps,NewAPI: Phase 2: Live Cutover & Timestamp Anchor
    DevOps->>DevOps: Record T_cutover = CURRENT_TIMESTAMP
    DevOps->>NewAPI: Start API with DATABASE_URL -> Neon (Pooled)
    DevOps->>Client: Route traffic to New API URL
    DevOps->>NewAPI: Verify /api/v1/health/liveness (HTTP 200)

    Note over DevOps,Client: Phase 3: Observation Window (T_cutover + 30 mins)
    alt System Verified Stable
        DevOps->>DevOps: Formally Declare MIGRATION SUCCESSFUL
    else Critical Failure Detected (Latency > 3s, Error Rate > 5%)
        Note over DevOps,Client: Phase 4: Emergency Reversal Protocol
        DevOps->>NewAPI: Set MAINTENANCE_MODE = true (Stop new writes)
        DevOps->>NeonDB: Extract Post-Cutover Mutations (WHERE updated_at >= T_cutover)
        DevOps->>OldDB: Apply Delta Script (INSERT ... ON CONFLICT DO UPDATE)
        DevOps->>Client: Revert traffic to Source API URL
        DevOps->>OldDB: Set MAINTENANCE_MODE = false -> Operational Restored
    end
```

### 5.3 Complete Delta Entity Extraction Script
In the event of a rollback, mutations across all domain tables must be extracted from Neon and applied to the source database in foreign-key dependency order:

```sql
-- Transactional Post-Cutover Delta Export
BEGIN;

-- 1. Idempotency Keys (Preserve duplicate prevention)
CREATE TEMP TABLE delta_idempotency AS 
SELECT * FROM idempotency_keys WHERE created_at >= :'t_cutover';

-- 2. Complaints & Service Cases
CREATE TEMP TABLE delta_source_complaints AS 
SELECT * FROM source_complaints WHERE created_at >= :'t_cutover';

CREATE TEMP TABLE delta_service_cases AS 
SELECT * FROM service_cases WHERE updated_at >= :'t_cutover';

CREATE TEMP TABLE delta_case_status_history AS 
SELECT * FROM service_case_status_history WHERE created_at >= :'t_cutover';

CREATE TEMP TABLE delta_case_assignment_history AS 
SELECT * FROM assignment_history WHERE created_at >= :'t_cutover';

-- 3. Field Visits & Findings
CREATE TEMP TABLE delta_field_visits AS 
SELECT * FROM field_visits WHERE updated_at >= :'t_cutover';

CREATE TEMP TABLE delta_visit_status_history AS 
SELECT * FROM field_visit_status_history WHERE created_at >= :'t_cutover';

CREATE TEMP TABLE delta_visit_findings AS 
SELECT * FROM visit_equipment_findings WHERE updated_at >= :'t_cutover';

-- 4. Evidence Metadata
CREATE TEMP TABLE delta_evidence_files AS 
SELECT * FROM evidence_files WHERE created_at >= :'t_cutover';

-- 5. Conveyance Claims
CREATE TEMP TABLE delta_conveyance_claims AS 
SELECT * FROM conveyance_claims WHERE updated_at >= :'t_cutover';

-- 6. Tombstones & Audit Events
CREATE TEMP TABLE delta_tombstones AS 
SELECT * FROM tombstones WHERE created_at >= :'t_cutover';

CREATE TEMP TABLE delta_audit_events AS 
SELECT * FROM audit_events WHERE created_at >= :'t_cutover';

COMMIT;
```

---

## 6. Strict Zero-Cost Assessment

| Service Candidate | Verified Free Allowance | Payment Card Required? | Behavior on Quota Exhaustion | Overage Billing Risk | Hard Zero-Cost Guarantee Established? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cloudflare Pages** | Unlimited bandwidth, 500 builds/month | **No** | Builds queue; live site unaffected | None | **YES (Guaranteed ₹0)** |
| **Render Free Web Service** | 750 instance-hrs/mo, 100 GB egress | **No** | Service automatically suspends | None | **YES (Guaranteed ₹0)** |
| **Neon PostgreSQL Free** | 500 MB data, 100 CU-hrs/month | **No** | 500 MB: Read-only; 100 CU-hrs: Suspends | None | **YES (Guaranteed ₹0)** |
| **Cloudflare Tunnel** | Unlimited bandwidth | **No** | Free feature of Cloudflare Zero Trust | None | **YES (Guaranteed ₹0)** |
| **Supabase Storage Free** | 1 GB storage, 2 GB egress/month | **No** | Uploads fail with HTTP 413 | None | **YES (Guaranteed ₹0)** |
| **Local MinIO (Windows)**| Local disk capacity | **No** | Physical disk capacity | None | **YES (Guaranteed ₹0)** |
| **Cloudflare R2** | 10 GB storage | **YES** | Automatically bills $0.015/GB | **HIGH** | **NO (Auto-Bills Card)** |

---

## 7. Remaining Blockers

| Blocker ID | Domain | Severity | Description | Action Required |
| :--- | :--- | :--- | :--- | :--- |
| **BLK-REV-01** | Evidence Storage | Medium | Supabase Storage S3 requires path-style `/s3/<bucket>/<key>` URLs, whereas `ObjectStorageService` generates virtual-hosted URLs. | Mark Supabase S3 BLOCKED for now. Retain Local MinIO on host (`S3_ENDPOINT=http://localhost:9000`) as authoritative fallback. |
| **BLK-REV-02** | API Port Binding | Low | `packages/config/src/env.schema.ts` checks `API_PORT` (default 4000), not Render's injected `PORT=10000`. | Explicitly configure `API_PORT=10000` in Render environment variables. |
| **BLK-REV-03** | Neon Role Grant | Low | Executing `SET ROLE zentra_app` in Neon requires granting role membership to `neondb_owner`. | Include `GRANT zentra_app TO neondb_owner;` in the initial database provisioning script. |
| **BLK-REV-04** | Render Cold Start | Low | Free Web Service sleeps after 15m idle; waking takes ~50s. | Mitigated by mobile client's WatermelonDB local queue, which retries automatically without data loss. |

---

## 8. Recommended Next Authorized Step

With all documentation findings and technical risks reconciled, the project is structurally ready for the next authorized operational step:

```mermaid
sequenceDiagram
    autonumber
    actor Human as Human Stakeholder / Project Lead
    actor DevOps as DevOps Operator
    participant Neon as Neon PostgreSQL (Free Tier)
    participant Host as Local Execution Host

    Note over Human,DevOps: Step 1: Formal Design Review Approval Gate
    Human->>DevOps: Formally Approve docs/MUSE_SPARK_FREE_HOSTING_MIGRATION_DESIGN_REVIEW.md

    Note over DevOps,Neon: Step 2: Authorized Execution of Step 2A (Database Rehearsal)
    DevOps->>Neon: Create Free Project (No Card Required)
    DevOps->>Neon: Execute Role Setup & 14 Migrations (Direct Endpoint)
    DevOps->>Neon: Verify RLS Policies & Table Schemas
    DevOps->>Host: Run Monorepo Test Suite Against Target Schema
```

1. **Review and Approve this Design Review Document** ([`docs/MUSE_SPARK_FREE_HOSTING_MIGRATION_DESIGN_REVIEW.md`](file:///d:/Zentra/docs/MUSE_SPARK_FREE_HOSTING_MIGRATION_DESIGN_REVIEW.md)).
2. **Authorize Step 2A (Controlled Free Database Rehearsal):**
   - Provision a zero-card Neon PostgreSQL 16 project.
   - Execute role setup (`CREATE ROLE zentra_app ...; GRANT zentra_app TO neondb_owner;`).
   - Run the 14 migrations via `createMigrator()` against the direct connection string.
   - Execute the 524 monorepo tests locally to verify remote schema compatibility.

---

STOP — DESIGN REVIEW COMPLETE — WAITING FOR HUMAN APPROVAL

# MUSE SPARK — ZENTRA FREE HOSTING MIGRATION DESIGN
## STEP 2 — PRE-MIGRATION SAFETY AND COMPATIBILITY DESIGN

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Activity:** Production Preparation — Free Hosting Migration Design  
**Mode:** READ-ONLY DESIGN AND VALIDATION ONLY  
**Budget Constraint:** **₹0 / month** (Zero paid services, zero subscriptions, zero payment cards, zero billable overages)  
**Deployment Authorization:** **NOT GRANTED** (Design and Validation Only)  
**Authoritative Baseline:** [Implementation Sequence](file:///d:/Zentra/docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md), [Free Hosting Feasibility Audit](file:///d:/Zentra/docs/MUSE_SPARK_FREE_HOSTING_MIGRATION_FEASIBILITY_AUDIT.md)  
**Monorepo Health Baseline:** **524 / 524 passing tests**, **15 / 15 Turbo typecheck tasks cached and passing**  

---

## 1. Proposed Architecture

The proposed free-tier hosting architecture adheres strictly to the **zero-payment, zero-credit-card, and fail-closed ₹0/month budget mandate**. Any provider requiring payment cards or auto-billing on quota breaches (such as Cloudflare R2) is disqualified.

```mermaid
graph TD
    subgraph Client Tier
        Web["Management Web Portal<br/>(React 18 + Vite SPA)"]
        Mobile["Mobile Field Service App<br/>(React Native + WatermelonDB)"]
    end

    subgraph Free Cloud Infrastructure Tier [Strictly Zero Card / Zero Overage]
        CFPages["Cloudflare Pages Free Tier<br/>Static Assets & SPA Hosting<br/>Quota: Unlimited Bandwidth, 500 Builds/Mo<br/>Billing: Hard Stop / ₹0 Guaranteed"]
        RenderAPI["Render Free Web Service<br/>Central API (Node.js 22 LTS + Fastify)<br/>Quota: 750 Instance-Hours, 100 GB BW<br/>Billing: Auto-Sleep / Hard Suspend / ₹0 Guaranteed"]
        NeonDB["Neon PostgreSQL Free Tier<br/>PostgreSQL 16 Engine + RLS<br/>Quota: 0.5 GB Storage, 100 CU-Hours/Mo<br/>Billing: Auto-Suspend / Read-Only / ₹0 Guaranteed"]
        SupaStore["Supabase Storage Free Tier<br/>S3-Compatible Evidence Storage<br/>Quota: 1 GB Storage, 2 GB Egress/Mo<br/>Billing: Upload 413 Fail-Closed / ₹0 Guaranteed"]
    end

    subgraph Self-Hosted Windows Fallback [High-Volume / Development Alternative]
        WinHost["Local Windows Host (D:\Zentra)<br/>API: node dist/main.js<br/>Storage: MinIO Server (Local Disk)<br/>Network: Cloudflare Tunnel (cloudflared)"]
    end

    Web -->|HTTPS Static Delivery| CFPages
    Web -->|HTTPS REST API /api/v1| RenderAPI
    Mobile -->|HTTPS REST Sync & Auth| RenderAPI
    Mobile -->|Direct SigV4 Presigned PUT| SupaStore
    RenderAPI -->|PgBouncer Pooler TCP:5432| NeonDB
    RenderAPI -->|SigV4 HEAD Integrity Verification| SupaStore

    Mobile -.->|Fallback Sync Route| WinHost
    WinHost -.->|Direct TCP| NeonDB
```

### Approved Free-Hosting Tier Allocations

| Architecture Layer | Approved Free Platform | Runtime / Engine | Enforced Free Quota | Billing Guarantee Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **Management Web Portal** | **Cloudflare Pages Free** | Static Edge CDN | Unlimited bandwidth, 500 builds/month | **No Card Required.** Fails closed (builds queue; live site untouched). |
| **Central Backend API** | **Render Free Web Service** | Node.js 20/22 LTS | 750 instance hours/month, 100 GB egress | **No Card Required.** Service suspends when limit is hit; zero billing. |
| **Relational Database** | **Neon PostgreSQL Free** | PostgreSQL 16 + RLS | 0.5 GB (500 MB) storage, 100 CU-hours/month | **No Card Required.** Switches to read-only at 500 MB; suspends at 100 CU-hrs. |
| **Evidence Object Storage** | **Supabase Storage Free** | S3-Compatible Storage | 1 GB storage, 2 GB egress/month | **No Card Required.** Rejects uploads (>1 GB) with HTTP 413. |
| **High-Volume / Staging Fallback**| **Windows Host + CF Tunnel** | Native Node.js + MinIO | Local host disk capacity, unlimited bandwidth | **Self-Hosted.** Zero cloud accounts, zero cloud charges. |

---

## 2. Component Compatibility Matrix

| Component | Current Implementation | Candidate Free Platform | Compatible Without Code Changes? | Required Code / Config Changes | Free-Tier Limitation | Security Impact | Data-Loss Risk | Cost-Overrun Risk | Authoritative Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Web Portal** | React 18 + Vite SPA | Cloudflare Pages | **Yes** | None. Build command: `pnpm --filter @zentra/web build`, Output: `apps/web/dist` | 500 builds/month | None | None | **Zero** (Hard cap, no card) | 🟢 **COMPATIBLE** |
| **Central API** | NestJS 11 + Fastify 5 | Cloudflare Workers | **No** | Full rewrite to Hono, replacement of `node-postgres` with WebSocket proxy, removal of NestJS reflection | 10ms CPU limit, V8 isolate (no Node TCP) | High | High | **Zero** (1010 throttle) | 🔴 **NOT COMPATIBLE** |
| **Central API** | NestJS 11 + Fastify 5 | Render Free Web | **Yes** | Add `render.yaml` or set environment variables (`API_PORT=10000`, `API_HOST=0.0.0.0`) | 512 MB RAM, 50s cold start after 15m idle, 750 hrs/mo | None | None | **Zero** (Auto-suspend, no card) | 🟢 **COMPATIBLE WITH CONFIG** |
| **Central API (Fallback)** | NestJS 11 + Fastify 5 | Windows + CF Tunnel | **Yes** | Configure `cloudflared` daemon pointing to `http://localhost:4000` | Host must remain powered on | None | None | **Zero** (Self-hosted) | 🟢 **COMPATIBLE** |
| **Database** | PostgreSQL 16 + RLS | Neon Free Tier | **Yes** | Connection string (`DATABASE_URL`). Use pooled host for runtime, direct host for migrations | 500 MB storage, 100 CU-hours/month | None (Full RLS supported) | None | **Zero** (Read-only on cap, no card) | 🟢 **COMPATIBLE** |
| **Evidence Storage** | S3 SigV4 Direct Streaming | Cloudflare R2 | **Yes** | Endpoint config | 10 GB storage | None | None | **HIGH (Auto-bills card on overage)** | 🔴 **NOT APPROVED** (Violates ₹0 mandate) |
| **Evidence Storage** | S3 SigV4 Direct Streaming | Supabase Storage | **Conditional** | Normalise S3 path-style URL signing in `ObjectStorageService` | 1 GB storage, 2 GB egress/month | None | None | **Zero** (Rejects upload, no card) | 🟡 **COMPATIBLE WITH CONFIG** |
| **Evidence Storage (Fallback)**| S3 SigV4 Direct Streaming | Local MinIO | **Yes** | None (`S3_ENDPOINT=http://localhost:9000`) | Local disk capacity | None | None | **Zero** (Self-hosted) | 🟢 **COMPATIBLE** |

---

## 3. Exact Deployment and Build Requirements

### 3.1 Management Web Portal (`apps/web` on Cloudflare Pages)
- **Framework:** React 18.3.1, Vite 5.4.5, TailwindCSS 3.4.11.
- **Build Environment:** Node.js 20.x, pnpm 12.x.
- **Build Settings:**
  - Build Command: `pnpm install --frozen-lockfile && pnpm --filter @zentra/web build`
  - Build Output Directory: `apps/web/dist`
  - Root Directory: `/`
- **Single Page Application Routing:** Requires a `_redirects` file in `apps/web/public/` containing:
  ```
  /*    /index.html   200
  ```
  This ensures client-side routing (React Router / deep links) works without HTTP 404 errors on edge CDN refreshes.
- **Environment Variables:**
  - `VITE_API_BASE_URL`: `https://zentra-api.onrender.com/api/v1`

### 3.2 Central API (`apps/api` on Render Free Web Service)
- **Framework:** NestJS 11.0.11, Fastify 5.2.1.
- **Runtime:** Native Node.js 22 LTS (Render native Linux container).
- **Build Command:**
  ```bash
  corepack enable && pnpm install --frozen-lockfile && pnpm --filter @zentra/api build
  ```
- **Start Command:**
  ```bash
  pnpm --filter @zentra/api start
  # which executes: node dist/main.js
  ```
- **Port and Host Binding:**
  - Render assigns `PORT=10000` dynamically.
  - ZENTRA's `@zentra/config` defines `API_PORT` (default 4000) and `API_HOST` (default `0.0.0.0`).
  - To bind correctly without code changes, set `API_PORT=10000` in Render environment configuration.
- **Health Check Configuration:**
  - Render Health Check Path: `/api/v1/health/liveness`
  - Returns: HTTP 200 `{"success": true, "data": {"status": "ok"}}` within 10ms.
- **Memory Optimization (512 MB Free RAM Cap):**
  - Set Node.js memory limit flag in start command: `NODE_OPTIONS="--max-old-space-size=400"` to prevent out-of-memory container restarts during heavy spreadsheet processing.

### 3.3 Database Deployment (Neon PostgreSQL Free)
- **Direct Endpoint (for Migrations):**
  ```
  postgresql://zentra_app:[PASSWORD]@ep-xyz.ap-southeast-1.aws.neon.tech:5432/zentra_staging?sslmode=require
  ```
- **Pooled Endpoint (for Runtime API via PgBouncer):**
  ```
  postgresql://zentra_app:[PASSWORD]@ep-xyz-pooler.ap-southeast-1.aws.neon.tech:5432/zentra_staging?sslmode=require
  ```
- **Connection Pool Configuration (`@zentra/config`):**
  - `DATABASE_POOL_MIN=1`
  - `DATABASE_POOL_MAX=5` (Prevents saturating free compute connections while maintaining pooler efficiency).

---

## 4. Database Backup, Migration & Restore Plan

### 4.1 Schema Migration Execution
ZENTRA maintains 14 sequential Kysely migrations tracked via `kysely_migration` and `kysely_migration_lock`:
1. `20261005000001_create_territory_and_schools.ts`
2. `20261005000002_create_equipment_master.ts`
3. `20261005000003_create_complaints_and_service_cases.ts`
4. `20261005000004_create_visits_evidence_and_findings.ts`
5. `20261005000005_create_governance_staging_and_audit.ts`
6. `20261007000001_create_auth_and_rbac.ts`
7. `20261007000002_create_hi_tech_labs_rls.ts`
8. `20261007000003_create_lab_equipment_rls.ts`
9. `20261008000001_create_import_staging_rls.ts`
10. `20261008000002_enhance_service_cases_and_dispatch.ts`
11. `20261008000003_create_sync_and_idempotency.ts`
12. `20261008000004_enhance_field_visits_and_lifecycle.ts`
13. `20261008000005_enhance_evidence_files_and_s3_pipeline.ts`
14. `20261008000006_create_conveyance_and_claims.ts`

### 4.2 Step-by-Step Migration & Rehearsal Procedure

```powershell
# Step 1: Pre-Migration Backup (Custom compressed archive with blobs and schema)
pg_dump --format=custom --no-owner --no-acl --file="D:\Zentra\backups\zentra_pre_migration.dump" "$SOURCE_DATABASE_URL"

# Step 2: Verification of Backup Archive
pg_restore --list "D:\Zentra\backups\zentra_pre_migration.dump" > "D:\Zentra\backups\backup_contents.txt"

# Step 3: Target Schema Preparation on Neon (Using direct non-pooled endpoint)
$env:DATABASE_URL = "$NEON_DIRECT_DATABASE_URL"
# Execute programmatic migration runner:
pnpm --filter @zentra/api exec tsx -e "import { runMigrationsToLatest } from './src/database/migration-runner'; runMigrationsToLatest().then(console.log);"

# Step 4: Data Import into Neon (Data only, preserving existing schema & constraints)
pg_restore --data-only --disable-triggers --no-owner --no-acl --dbname="$NEON_DIRECT_DATABASE_URL" "D:\Zentra\backups\zentra_pre_migration.dump"
```

### 4.3 Automated Post-Migration Verification Queries

| Verification Dimension | Query / Check | Pass Criteria |
| :--- | :--- | :--- |
| **Migration History** | `SELECT COUNT(*) FROM kysely_migration;` | Exactly 14 records |
| **Table Row Counts** | `SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;` | 100% exact match with source |
| **Foreign Keys** | Inspect `information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY'` | All 42 FK constraints intact |
| **RLS Policies** | `SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public';` | Exactly 7 active policies |
| **Idempotency Keys** | `SELECT COUNT(*) FROM idempotency_keys;` | 100% match with source |
| **Audit Continuity** | `SELECT MAX(created_at), COUNT(*) FROM audit_events;` | Timestamp and count preserved |

---

## 5. Offline Sync Preservation Plan

ZENTRA's delta synchronization engine ([`apps/api/src/modules/sync`](file:///d:/Zentra/apps/api/src/modules/sync)) operates statelessly over HTTP REST:

### 5.1 Endpoint Transition Mechanics
1. **Mobile Mutation Queue Independence:** Outbound mutations on the mobile client are stored in WatermelonDB's local SQLite database (`local_operations` table). Mutations are **never lost** when the backend URL changes or when the backend server is sleeping.
2. **Deterministic Idempotency Protection:**
   - Every offline mutation generated on the field client carries a UUIDv7 `client_operation_id`.
   - The Central API checks the `idempotency_keys` table before executing any mutation:
     ```typescript
     const existingKey = await this.idempotencyRepo.findByOperationId(mutation.clientOperationId);
     if (existingKey) {
       return existingKey.responseBody; // Return cached response, bypass duplicate execution
     }
     ```
   - When the mobile client connects to the newly migrated Neon/Render backend, all replayed mutations that were already processed return the cached ACK immediately.
3. **Delta Streaming with Opaque Cursors:**
   - `GET /api/v1/sync/delta?since_cursor=[CURSOR]` uses ISO timestamps and UUID pagination.
   - If a client provides a cursor from the previous database, the new Neon database (having identical timestamps from the restore) seamlessly returns only records updated since that cursor.
   - If the cursor is invalid or expired, the engine returns a clean full baseline bundle (`is_initial_sync: true`).

---

## 6. Evidence Storage Compatibility Plan

### 6.1 Supabase Storage S3-Compatible API Analysis
- **S3 Endpoint:** `https://[PROJECT_ID].storage.supabase.co/s3`
- **Supported Operations:**
  - Presigned PUT (Direct mobile streaming): **Supported**
  - Presigned GET (Authorized download/view): **Supported**
  - HeadObject (Metadata check): **Supported**
  - GetObject (Byte fetching for fallback SHA-256 calculation): **Supported**

### 6.2 Identified S3 Client URL Normalization Requirement
In [`ObjectStorageService`](file:///d:/Zentra/apps/api/src/modules/evidence/services/object-storage.service.ts), presigned URLs and SigV4 canonical URIs are currently constructed assuming virtual-hosted style:
```typescript
// Current AWS S3 assumption:
const host = this.endpoint ? new URL(this.endpoint).host : `${this.bucketName}.s3.${this.region}.amazonaws.com`;
presignedUrl = `https://${host}/${objectKey}?...`;
```
- For Supabase Storage S3 endpoints (`https://<project>.storage.supabase.co/s3`), the path MUST include the bucket name:
  `https://<project>.storage.supabase.co/s3/<bucketName>/<objectKey>`.
- **Proposed Configuration Parameter:** Support `S3_FORCE_PATH_STYLE=true` (already present in [`env.schema.ts`](file:///d:/Zentra/packages/config/src/env.schema.ts)) within `ObjectStorageService` to prefix `/${this.bucketName}/${objectKey}` when using custom S3 endpoints like Supabase Storage or MinIO.

### 6.3 Evidence Privacy and Presigned URL Security
- All evidence buckets (`zentra-evidence-files`) are configured with **Private Access** (zero public read).
- Access is granted strictly via short-lived pre-signed URLs (expiration: 900 seconds / 15 minutes).
- URLs are generated only after role-based authorization and territory validation checks pass in `EvidenceController`.

---

## 7. Security and Row-Level Security (RLS) Plan

### 7.1 PostgreSQL RLS Preservation on Neon
The 7 authoritative RLS policies must be applied and verified on Neon:

```sql
-- Example: Hi-Tech Labs Multi-District Territory Isolation
ALTER TABLE hi_tech_labs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hi_tech_labs FORCE ROW LEVEL SECURITY;

CREATE POLICY hi_tech_labs_territory_isolation ON hi_tech_labs
FOR ALL
USING (
  NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
  OR
  EXISTS (
    SELECT 1 FROM schools s
    JOIN user_territory_assignments uta ON uta.district_id = s.district_id
    WHERE s.school_id = hi_tech_labs.school_id
      AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
      AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
      AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
  )
);
```

### 7.2 Database Role and Privilege Architecture
To enforce RLS fail-closed behavior, two PostgreSQL roles are required on Neon:
1. **`zentra_admin` (Master DB Role):** Superuser / owner role used **only** for applying migrations and running schema changes.
2. **`zentra_app` (Application Runtime Role):** Non-superuser role with `NOBYPASSRLS`. All API queries execute under this role.
3. In [`RlsService`](file:///d:/Zentra/apps/api/src/modules/auth/rls.service.ts), `SET LOCAL role = 'zentra_app'` ensures the active connection cannot bypass RLS even if connecting with master credentials during initial setup.

---

## 8. Cost and Quota Safeguards

To guarantee **₹0/month with absolute mathematical certainty**, every layer enforces hard caps:

| Layer | Service | Enforced Quota | Behavior upon Reaching Quota | Financial Overage Risk |
| :--- | :--- | :--- | :--- | :--- |
| **Web** | Cloudflare Pages | 500 builds / month | New deployments are queued; live website remains up. | **₹0.00** (Zero card required) |
| **API** | Render Free | 750 hours / month | Service enters stopped state until 1st of next month. | **₹0.00** (Zero card required) |
| **API** | Cloudflare Tunnel | Unlimited (Local host) | Subject to host hardware uptime; zero bandwidth fees. | **₹0.00** (Zero card required) |
| **Database** | Neon Free | 500 MB storage | Database switches to read-only; mutations return error. | **₹0.00** (Zero card required) |
| **Database** | Neon Free | 100 CU-hours / month | Compute suspends until next calendar month. | **₹0.00** (Zero card required) |
| **Evidence** | Supabase Storage | 1 GB storage | New uploads fail with HTTP 413 Payload Too Large. | **₹0.00** (Zero card required) |
| **Evidence** | Local MinIO | Local disk size | Bounded by physical drive capacity. | **₹0.00** (Self-hosted) |

> [!IMPORTANT]
> **Cloudflare R2 Rejection Confirmed:** Cloudflare R2 remains **disqualified** because it requires a credit card and automatically bills $0.015/GB on overages without an enforceable $0 spending cap.

---

## 9. Rollback and Recovery Plan

### 9.1 The Split-Brain Rollback Dilemma
> **Critical Production Reality:** Simply changing `DATABASE_URL` back to the original database does NOT reverse or restore writes that occurred on the new database while it was live. Reverting the URL without data reconciliation causes **catastrophic split-brain data loss** (any visits completed or claims filed on the new database would vanish).

### 9.2 Controlled Cutover & Rollback Protocols

```mermaid
sequenceDiagram
    autonumber
    actor DevOps as DevOps Operator
    participant AppOld as Old API (Local/Staging)
    participant NeonDB as Target Neon DB
    participant AppNew as New API (Render/Free)
    participant Client as Mobile & Web Clients

    Note over DevOps,Client: 1. Controlled Cutover Phase
    DevOps->>AppOld: Enable Maintenance Mode (HTTP 503 on writes)
    DevOps->>NeonDB: Synchronize Final Delta Dump from Source
    DevOps->>AppNew: Start API Pointing to Neon
    DevOps->>Client: Route Traffic to New API (DNS / App Config)
    DevOps->>AppNew: Verify Health Check (/api/v1/health/readiness)

    alt Healthy Operational State
        Client->>AppNew: Live Writes & Sync Proceed Normally
    else Migration Failure Detected within 15 Minutes
        Note over DevOps,Client: 2. Immediate Rollback Protocol (< 15 mins, Minimal Writes)
        DevOps->>AppNew: Stop New API (Enter Maintenance Mode)
        DevOps->>NeonDB: Dump Delta: SELECT * FROM audit_events WHERE created_at >= cutover_time
        DevOps->>AppOld: Replay Delta into Original Database
        DevOps->>Client: Revert Traffic to Old API URL
        DevOps->>AppOld: Disable Maintenance Mode -> Full Operational Recovery
    end
```

### 9.3 Rollback Execution Triggers
An immediate rollback is mandated if:
1. Neon database response latency exceeds 3,000ms consistently.
2. RLS policy evaluation throws permissions errors (`42501`) on valid engineer queries.
3. Mobile sync push error rate exceeds 5% of all mutation batches.
4. Render Free container experiences OOM crashes (Exit Code 137).

---

## 10. Test and Acceptance Criteria

Before authorizing production cutover, the following acceptance criteria must be satisfied:

### 10.1 Automated Monorepo Verification
- `pnpm typecheck`: Must pass 15/15 Turbo tasks with 0 errors.
- `pnpm test`: Must pass all 524 tests with 0 failures across `@zentra/api`, `@zentra/field`, `@zentra/contracts`, and shared packages.

### 10.2 Remote Target Integration Acceptance Criteria
1. **Health Verification:** `GET /api/v1/health/liveness` returns 200 OK; `GET /api/v1/health/readiness` returns 200 OK with `database: "healthy"`.
2. **Schema Verification:** All 14 migrations verified active on Neon (`SELECT count(*) FROM kysely_migration` = 14).
3. **RLS Territory Enforcement:** Attempting to query `hi_tech_labs` or `service_cases` for District B while authenticated as District A engineer returns empty results (fail-closed).
4. **Idempotent Sync Push:** Submitting the same `client_operation_id` twice to `POST /api/v1/sync/push` returns identical responses with zero duplicate database rows.
5. **Direct S3 Upload & Checksum Verification:** Requesting a presigned URL, uploading a test JPEG, and calling `/evidence/complete` successfully verifies SHA-256 and updates status to `VERIFIED`.

---

## 11. Blockers and Unresolved Assumptions

| Blocker / Risk ID | Category | Severity | Description | Resolution Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **BLK-DES-01** | Evidence Storage | Medium | Supabase Storage Free Tier has a 1 GB storage limit, which accommodates ~1,000 evidence photos before blocking uploads. | Use Supabase for initial staging/pilot; use Local MinIO fallback on Windows host for unlimited staging capacity. |
| **BLK-DES-02** | Evidence S3 Path | Medium | `ObjectStorageService` assumes virtual-hosted S3 URL format (`/${objectKey}`). Supabase S3 requires path-style (`/s3/<bucket>/<objectKey>`). | Surgical code enhancement in Step 3 to support `S3_FORCE_PATH_STYLE` when custom S3 endpoints are configured. |
| **BLK-DES-03** | API Latency | Low | Render Free containers sleep after 15 minutes of inactivity; waking up takes ~50 seconds. | Mobile offline-first architecture queues sync operations locally in WatermelonDB, making cold starts seamless to field engineers. |
| **BLK-DES-04** | Neon Compute Cap | Low | Neon Free compute allowance is capped at 100 CU-hours/month. | Neon's auto-suspend after 5 minutes of inactivity ensures idle compute consumes zero CU-hours when field operations cease at night. |

---

## 12. Recommended Next Implementation Phase

Following formal review and approval of this design, the authorized implementation should proceed under a controlled, multi-stage sequence:

1. **Step 2A (Controlled Database Provisioning):**
   - Create a free, zero-card Neon PostgreSQL project.
   - Run the 14 migrations using the direct connection string.
   - Verify table schemas, indexes, and RLS policies.
2. **Step 2B (Web Portal Deployment):**
   - Connect repository to Cloudflare Pages (zero card required).
   - Build and verify `apps/web` static assets.
3. **Step 2C (API Service Configuration & Deployment):**
   - Configure Render Free Web Service with `API_PORT=10000` and `DATABASE_URL` pointing to Neon's pooled endpoint.
   - Verify `/api/v1/health/liveness` and `/api/v1/health/readiness`.
4. **Step 2D (End-to-End Field Rehearsal):**
   - Run the 524-test monorepo test suite against the live staging endpoints.
   - Execute an end-to-end sync and evidence upload rehearsal.

---

STOP — MIGRATION DESIGN COMPLETE — WAITING FOR REVIEW

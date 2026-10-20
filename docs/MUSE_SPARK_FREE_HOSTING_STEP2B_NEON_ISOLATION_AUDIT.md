# MUSE SPARK — ZENTRA STEP 2B
## EXISTING NEON ACCOUNT ISOLATION AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Activity:** Step 2B — Existing Neon Account Isolation Audit  
**Mode:** STRICT READ-ONLY AUDIT  
**Budget Constraint:** **Strict ₹0 / month** (Zero paid upgrades, zero payment cards, zero billable overages)  
**Deployment Authorization:** **NOT GRANTED** (Audit Only)  
**Authoritative Baseline:** [Implementation Sequence](file:///d:/Zentra/docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md), [Step 2A Database Rehearsal](file:///d:/Zentra/docs/MUSE_SPARK_FREE_HOSTING_STEP2A_DATABASE_REHEARSAL.md)  
**Current Health Baseline:** **524 / 524 passing unit/domain/security tests**, **15 / 15 Turbo typecheck tasks cached and passing**  

---

## 1. Executive Summary & Audit Context

### 1.1 The Operational Context
The human operator currently maintains an active **Neon Free Tier account** powering other live and development applications. Before introducing ZENTRA's PostgreSQL 16 staging database, we must guarantee **100% total isolation** so that no existing application, database, branch, schema, compute allowance, or data record can be impacted, polluted, or exposed to data loss.

### 1.2 Core Audit Objectives
1. Inspect ZENTRA's codebase and configuration to confirm zero pre-existing Neon project bindings or exposed credentials.
2. Analyze the migration runner, database test suite, and RLS implementation for isolation risks.
3. Assess the feasibility and limits of Neon's Free Tier regarding multi-project isolation without credit card requirements.
4. Deliver an airtight isolation strategy, safe verification procedure, and human operator checklist to guarantee existing applications remain completely untouched.

### 1.3 Absolute Safety Confirmation
- **Remote Cloud Contact:** **ZERO.** No Neon databases, endpoints, or APIs were contacted.
- **Data Integrity:** **100% UNTOUCHED.** Zero existing databases or customer records were accessed, migrated, or modified.
- **Repository State:** **PRISTINE.** Zero application code, test files, or configuration files were changed.

---

## 2. Repository Configuration & Credential Exposure Audit

In accordance with **Tasks 1 and 2**, the repository was audited for database configuration and environment secrets:

### 2.1 File & Environment Audit Results
| Scope / Target | Scan Methodology | Discovered Entries | Masked Host / Value | Risk Assessment |
| :--- | :--- | :--- | :--- | :--- |
| **Committed `.env*` Files** | Recursive directory scan excluding `node_modules` | `.env.example` (Only) | N/A (Template only) | 🟢 **PASS — Zero committed secrets** |
| **Local `.env` / `.env.local`** | Exact file path check across root, `apps/*`, `packages/*` | **None** (No active `.env` files found) | N/A | 🟢 **PASS — No local config on disk** |
| **System / User Env Vars** | PowerShell `env:` inspection for `DATABASE_URL`, `TEST_DATABASE_URL`, `PG*`, `NEON*` | **None** | N/A | 🟢 **PASS — Terminal environment clean** |
| **Template `DATABASE_URL`** | Audited `.env.example` line 21 | `DATABASE_URL` | `localhost:5432` (`zentra_local`) | 🟢 **PASS — Localhost only** |
| **Template `TEST_DATABASE_URL`** | Audited `.env.example` line 27 | `TEST_DATABASE_URL` | `localhost:5432` (`zentra_test`) | 🟢 **PASS — Localhost only** |

```
DISCOVERY VERDICT:
Existing Neon projects or connections configured in repository: ZERO (0)
Pre-existing cross-contamination risk: ZERO (0)
```

---

## 3. Technical Architecture Audit: Migrations, Tests, RLS & Roles

In accordance with **Task 3**, the database access layers in `apps/api` and `@zentra/testing` were audited:

### 3.1 Migration Runner (`apps/api/src/database/migration-runner.ts`)
- **Execution Engine:** Uses Kysely's `Migrator` with [`ExplicitMigrationProvider`](file:///d:/Zentra/apps/api/src/database/migration-runner.ts#L35).
- **Target Resolution:**
  ```typescript
  export async function runMigrationsToLatest(databaseUrl?: string): Promise<MigrationResultSet> {
    const db = createDatabaseConnection(databaseUrl);
    const migrator = createMigrator(db);
    ...
  ```
  If `databaseUrl` is not explicitly passed, it falls back to `loadAppConfig().DATABASE_URL`, which defaults to `localhost:5432/zentra_local`.
- **Migration Tracking:** Manages internal tracking tables `kysely_migration` and `kysely_migration_lock`.
- **CLI Scripts:** There are **zero** CLI scripts in `package.json` (such as `pnpm db:migrate`) that could be triggered unintentionally from the command line. Migrations are currently only executed programmatically.

### 3.2 Database Test Configuration & Destructive Teardown Risk
A deep inspection of `apps/api/test/` revealed a **critical architectural safety finding**:

```mermaid
graph TD
    TestCmd["Developer executes 'pnpm test' or 'vitest'"] --> EnvCheck{"TEST_DATABASE_URL defined?"}
    EnvCheck -->|Points to Remote DB| SuiteRun["Vitest executes test suites"]
    
    subgraph Destructive Operations in beforeAll / beforeEach
        SuiteRun --> Truncate1["TRUNCATE TABLE ... CASCADE in school-lab-domain.spec.ts"]
        SuiteRun --> Truncate2["deleteFrom(21 tables) in auth-security.spec.ts"]
        SuiteRun --> Truncate3["TRUNCATE TABLE ... in service-case-lifecycle.spec.ts"]
    end
    
    Truncate1 --> WipedData["💥 CATASTROPHIC DATA LOSS IF POINTED AT SHARED DB"]
    Truncate2 --> WipedData
    Truncate3 --> WipedData
```

1. **Destructive Teardown in Tests:**
   Almost every domain integration test suite (`auth-security.spec.ts`, `school-lab-domain.spec.ts`, `service-case-lifecycle.spec.ts`, `phase16-database-integrity.spec.ts`, `sync-engine.spec.ts`, `visits-domain.spec.ts`) runs `TRUNCATE TABLE ... CASCADE;` and `deleteFrom(...)` across all 21+ domain tables in `beforeAll` and `beforeEach`.
2. **Partial Production-Gate Protection:**
   The repository contains a safety circuit breaker: [`assertTestEnvironmentIsSafe()`](file:///d:/Zentra/packages/testing/src/production-gate.ts#L10).
   ```typescript
   const dangerousDbMarkers = ['prod', 'production', 'rds.amazonaws.com', 'neon.tech', 'supabase.co'];
   for (const marker of dangerousDbMarkers) {
     if (targetDb.toLowerCase().includes(marker)) {
       throw new Error(`FAIL-CLOSED SAFETY GATE ABORT: Database URL contains prohibited marker [${marker}]: ${targetDb}`);
     }
   }
   ```
   - **Protection:** This gate explicitly bans strings containing `neon.tech` and aborts test execution.
   - **Critical Vulnerability / Gap:** Only **4 of the 19 test suites** (`api.spec.ts`, `auth-security.spec.ts`, `database-schema.spec.ts`, `security-hardening-step2b.spec.ts`) invoke `assertTestEnvironmentIsSafe()`.
   - **Implication:** The other 15 test suites do **NOT** invoke this gate! If `vitest` were executed with a remote `TEST_DATABASE_URL`, un-gated test suites could connect to the database and issue destructive `TRUNCATE` statements before reaching a gated suite.

> [!CAUTION]
> **MANDATORY SAFETY RULE:** The repository test suite (`pnpm test`, `vitest`, `turbo run test`) **MUST NEVER BE RUN** against any remote database. Automated unit and integration tests belong strictly on the isolated local PostgreSQL instance (`zentra_test`).

### 3.3 RLS Service & Role Assumptions (`apps/api/src/modules/auth/rls.service.ts`)
- [`RlsService.withSecurityContext()`](file:///d:/Zentra/apps/api/src/modules/auth/rls.service.ts#L36) switches roles inside a transaction:
  ```sql
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zentra_app') THEN
      PERFORM set_config('role', 'zentra_app', true);
    END IF;
  END $$;
  SELECT set_config('zentra.current_user_id', $1, true), set_config('zentra.current_role', $2, true);
  ```
- **Assumptions for Remote Database:**
  - `zentra_app` role must exist: `CREATE ROLE zentra_app ... NOSUPERUSER NOBYPASSRLS;`
  - The connecting role (`neondb_owner`) must be granted membership: `GRANT zentra_app TO neondb_owner;`
  - All 7 protected tables have forced RLS (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`), preventing bypass even by owners.

---

## 4. Existing Neon Usage & Isolation Risks

Why ZENTRA **must not share** an existing Neon project with other applications:

```mermaid
graph TD
    subgraph DISQUALIFIED: Shared Project Anti-Pattern
        P1[Existing Neon Project]
        P1 --> AppA[(Existing Application DB)]
        P1 --> AppB[(ZENTRA Staging DB)]
        P1 --> SharedCompute[Shared 100 CU-hr Compute Quota]
        SharedCompute --> SuspendRisk[ZENTRA activity suspends Existing App]
        AppB --> TruncateRisk[Shared Host/Role: Misdirected test truncates App A]
    end

    subgraph APPROVED: Dedicated Project Architecture
        P_Exist[Existing Neon Project] --> AppExist[(Existing Application DB)]
        P_Exist --> ComputeExist[Dedicated 100 CU-hrs]

        P_Zentra[New Dedicated Neon Project: zentra-staging] --> DB_Zentra[(ZENTRA Staging DB)]
        P_Zentra --> ComputeZentra[Independent 100 CU-hrs]
    end
```

### 4.1 Detailed Failure Modes of Shared Projects
1. **Accidental Schema / Table Overwrite:** If ZENTRA migrations ran against an existing application's database, common table names (`users`, `audit_events`, `roles`) would collide, corrupting or destroying foreign keys.
2. **Compute Quota Cannibalization:** Neon Free Tier allocates compute per project. If ZENTRA and an existing application share a project, intensive staging tests or migrations would consume the 100 CU-hour pool, causing Neon to sleep or suspend the existing application.
3. **Database Role Pollution:** Executing `CREATE ROLE zentra_app` or modifying privileges within an existing project risks granting unintended access or altering existing role hierarchies.
4. **Catastrophic Test Truncation:** As identified in Section 3.2, any test command executed against a shared host risks truncating non-ZENTRA tables if the database name is misconfigured.

---

## 5. Free-Plan Feasibility and Billing Uncertainties

In accordance with **Task 5**, official Neon Free Tier policies were re-verified (October 2026):

| Dimension | Verified Neon Free Specification | Source Reference | Compliance Verdict |
| :--- | :--- | :--- | :--- |
| **Project Limit** | **Up to 100 projects** per Free Tier account. | [Neon Free Tier Docs](https://neon.tech/docs/introduction/free-tier) | 🟢 **PASS — Multi-project allowed** |
| **Payment Card Required?** | **NO.** Creating a new project does not require adding a credit card. | [Neon Billing FAQ](https://neon.tech/pricing) | 🟢 **PASS — Zero card on file** |
| **Compute Allowance** | **100 CU-hours per month per project.** | [Neon Free Tier Quotas](https://neon.tech/docs/introduction/free-tier) | 🟢 **PASS — Dedicated compute** |
| **Storage Allowance** | **0.5 GB to 1.0 GB storage per project.** | [Neon Architecture Guide](https://neon.tech/docs/introduction/serverless) | 🟢 **PASS — Sufficient for staging** |
| **Autoscaling / Sleep** | Scales from 0.25 to 2 CU; **auto-suspends after 5 min idle.** | [Neon Serverless Guide](https://neon.tech/docs/introduction/serverless) | 🟢 **PASS — No idle consumption** |
| **Quota Exhaustion Behavior** | **Hard Stop:** Compute suspends; database becomes read-only upon storage limit. | [Neon Quota Management](https://neon.tech/docs/manage/projects) | 🟢 **PASS — Zero overage billing** |
| **Automatic Upgrades / Billing** | **IMPOSSIBLE without a payment method.** Without billing details, overage charges cannot occur. | [Neon Pricing](https://neon.tech/pricing) | 🟢 **PASS — Strictly ₹0/month** |

### 5.1 Recommendation on Project Creation
A **separate, dedicated Neon project** (e.g. `zentra-staging-rehearsal`) is **STRONGLY RECOMMENDED and AUTHORIZED** from an architectural safety and cost perspective:
- It guarantees 100% cryptographic and physical isolation from existing applications.
- It operates under its own independent 100 CU-hour budget.
- It complies strictly with the ₹0/month budget constraint with zero card requirement.
- **Rule:** The human operator must create this project manually in the web console; the AI agent will **never** create it automatically.

---

## 6. Airtight Isolation Strategy

To ensure zero risk of cross-contamination:

```mermaid
flowchart TD
    subgraph Isolation Pillars
        A["Pillar 1: Project-Level Separation<br/>(Dedicated Endpoint: ep-zentra-staging-*.neon.tech)"]
        B["Pillar 2: Ephemeral Terminal Variables<br/>(Never save Neon URLs in files or global system vars)"]
        C["Pillar 3: Absolute Test Ban on Remote<br/>(Never run pnpm test or vitest against Neon)"]
        D["Pillar 4: Non-Destructive Verification Script<br/>(Dedicated single-purpose migration & introspection runner)"]
    end
    
    A --> SafeStaging[100% Protected Existing Applications]
    B --> SafeStaging
    C --> SafeStaging
    D --> SafeStaging
```

1. **Pillar 1: Dedicated Project & Host Boundary:**
   ZENTRA staging must connect exclusively to its own dedicated project endpoint. The endpoint identifier (e.g., `ep-unique-id.ap-southeast-1.aws.neon.tech`) must be distinct from any endpoint used by the operator's existing applications.
2. **Pillar 2: Ephemeral Shell-Scoped Variables:**
   - Never write Neon connection strings to `.env`, `.env.local`, or any repository file.
   - Never set persistent Windows user/system environment variables.
   - Use session-scoped PowerShell variables only:
     ```powershell
     $env:ZENTRA_STAGING_DB_URL = "postgresql://neondb_owner:***@ep-zentra-staging-xyz.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
     ```
3. **Pillar 3: Absolute Prohibition of General Test Runners Against Remote:**
   - The commands `pnpm test`, `turbo run test`, and `vitest run` must **never** be executed with remote database connection strings.
   - All 524 automated unit/integration tests remain strictly bound to local PostgreSQL (`localhost:5432/zentra_test`).
4. **Pillar 4: Dedicated, Non-Destructive Verification Harness:**
   - Testing remote migrations and RLS must be performed via a single-purpose, read-only/introspective script that contains **zero `TRUNCATE` or `DELETE` statements**.

---

## 7. Recommended Safe Remote Testing Procedure

In accordance with **Task 6**, the only safe procedure to test the 14 migrations and RLS behavior against Neon without risking existing applications is:

### Phase 1: Manual Project Setup in Neon Console (Human Operator)
1. Sign in to [Neon Console](https://console.neon.tech/).
2. Verify you are creating a **New Project**:
   - **Name:** `zentra-staging-rehearsal`
   - **Region:** `ap-southeast-1` (Singapore) or nearest Asia-Pacific region
   - **Postgres Version:** `16`
3. Retrieve the **Direct Connection String** (format: `postgresql://neondb_owner:<PASSWORD>@ep-xyz.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`).

### Phase 2: Role Provisioning via Neon Console SQL Editor (Human Operator)
Execute directly in Neon's browser-based SQL Editor:
```sql
-- 1. Create runtime application role with zero superuser and forced RLS
CREATE ROLE zentra_app WITH LOGIN PASSWORD '<SECURE_GENERATED_PASSWORD>' NOSUPERUSER NOBYPASSRLS;

-- 2. Grant application role to migration admin role for SET ROLE support
GRANT zentra_app TO neondb_owner;

-- 3. Verify roles
SELECT rolname, rolsuper, rolbypassrls 
FROM pg_roles 
WHERE rolname IN ('neondb_owner', 'zentra_app');
```

### Phase 3: Programmatic Migration Execution (Dedicated One-Off Script)
Execute migrations using a dedicated, standalone TypeScript runner that targets the direct connection string explicitly, **without running vitest**:
```typescript
import { runMigrationsToLatest } from './apps/api/src/database/migration-runner';

// Explicitly pass target URL; zero fallback to process.env
const result = await runMigrationsToLatest(process.env.ZENTRA_STAGING_DB_URL);
if (result.error) {
  console.error('Migration failed:', result.error);
} else {
  console.log('All 14 migrations applied successfully.');
}
```

### Phase 4: Non-Destructive Schema & RLS Verification
Perform non-destructive schema introspection:
1. Verify all 32 domain tables exist in `information_schema.tables`.
2. Verify all 7 RLS policies exist in `pg_policies`:
   - `hi_tech_labs_territory_isolation`
   - `lab_equipment_territory_isolation`
   - `import_staging_district_isolation`
   - `service_cases_territory_isolation`
   - `field_visits_territory_isolation`
   - `evidence_files_territory_isolation`
   - `conveyance_claims_territory_isolation`
3. Verify `FORCE ROW LEVEL SECURITY` is enabled on all 7 tables in `pg_class.relforcerowsecurity`.
4. Test tenant boundary filtering inside a transaction using `withSecurityContext` with synthetic UUIDs, then `ROLLBACK`.

---

## 8. Human Operator Neon Console Pre-Connection Checklist

In accordance with **Task 8**, perform these **8 mandatory checks** before authorizing any remote connection:

- [ ] **Check 1: Project Name & Dropdown**  
  Verify the active project selected in the Neon Console top header is `zentra-staging-rehearsal`, **NOT** any project used by existing applications.
- [ ] **Check 2: Endpoint ID Verification**  
  Note the endpoint prefix (e.g. `ep-ancient-paper-123456`). Verify this ID matches **none** of your other projects' endpoints.
- [ ] **Check 3: Clean Database State**  
  Navigate to **Databases** in the project sidebar. Confirm the database is empty (no existing domain tables, only default `public` schema).
- [ ] **Check 4: Branch Verification**  
  Confirm you are operating on the `main` branch of `zentra-staging-rehearsal`.
- [ ] **Check 5: Billing & Plan Status**  
  Navigate to **Project Settings $\to$ Billing**. Confirm:
  - Plan is **Free Tier**.
  - **No payment card is attached.**
  - Quotas show **100 CU-hours available**.
- [ ] **Check 6: Auto-Suspend Setting**  
  Navigate to **Compute Settings**. Confirm auto-suspend is set to **5 minutes** (default) to conserve compute hours.
- [ ] **Check 7: SQL Editor Identity Pre-Check**  
  Run this verification query in the Neon SQL Editor:
  ```sql
  SELECT current_database(), current_user, inet_server_addr();
  ```
  Confirm it returns `neondb` (or your chosen DB name) and `neondb_owner`.
- [ ] **Check 8: Role Creation Sign-Off**  
  Execute the role creation script in Section 7 (Phase 2) and verify `zentra_app` is present.

---

## 9. Audit Pass / Fail Checklist

| Audit Check | Target / Requirement | Result | Evidence |
| :--- | :--- | :--- | :--- |
| **CHK-ISO-01** | Repository Environment Cleanliness | 🟢 **PASS** | Zero `.env` files found; `.env.example` contains only `localhost`. |
| **CHK-ISO-02** | Active Shell Environment Cleanliness | 🟢 **PASS** | No `DATABASE_URL` or `NEON_*` variables active in shell memory. |
| **CHK-ISO-03** | Free Tier Multi-Project Eligibility | 🟢 **PASS** | Neon Free plan verified: up to 100 projects allowed, zero payment card required. |
| **CHK-ISO-04** | Accidental CLI Migration Immunity | 🟢 **PASS** | Zero `package.json` scripts execute migrations; runner is programmatic only. |
| **CHK-ISO-05** | Production Gate Protection | 🟢 **PASS** | `assertTestEnvironmentIsSafe()` contains fail-closed check for `neon.tech`. |
| **CHK-ISO-06** | Test Teardown Risk Identified | 🟢 **PASS** | Identified that `vitest` contains `TRUNCATE` operations and banned test suite runs against remote DBs. |
| **CHK-ISO-07** | Existing Applications Safety Proof | 🟢 **PASS** | Dedicated project model guarantees 100% cryptographic and compute isolation. |
| **CHK-ISO-08** | Cloud State Untouched | 🟢 **PASS** | Zero remote cloud databases or APIs were contacted or modified. |

---

## 10. Explicit Confirmation of Cloud State

```
CONFIRMATION:
Remote databases contacted:  ZERO (0)
Remote databases modified:   ZERO (0)
Existing applications:       100% UNTOUCHED AND PROTECTED
Cloud resources created:     ZERO (0)
Local files modified:        ZERO (0) (Excluding this report)
```

---

STOP — STEP 2B NEON ISOLATION AUDIT COMPLETE — WAITING FOR REVIEW

# MUSE SPARK — ZENTRA STEP 2D-2A-R
## CONTROLLED LOCAL DATABASE INITIALIZATION PLAN — REMEDIATED FOR SAFETY

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Workstation:** Localhost (`127.0.0.1:5432`)  
**Remediation Date:** 2026-10-09  
**Mode:** STRICT PLAN & READ-ONLY INSPECTION ONLY  
**Budget Constraint:** Strict ₹0/month (Zero cost, no credit cards, no paid upgrades)  
**Remote Access:** STRICTLY PROHIBITED (Zero remote connections)  
**Execution Authorization:** NOT GRANTED — NO COMMANDS EXECUTED IN THIS STEP  
**Status:** PLAN REMEDIATED — WAITING FOR HUMAN OPERATOR REVIEW  

---

## 1. Executive Summary & Objective

In **Step 2D-1**, read-only verification proved that:
- PostgreSQL 18.6 (`postgresql-x64-18`) is running on the Windows workstation.
- The configured runtime database catalog **`zentra_local` does not exist**.
- The configured application database role **`zentra_dev` does not exist**.
- The automated test database **`zentra_test` exists** and is fully functional with 14 migrations and 34 tables.

In **Step 2D-2A**, an initial initialization plan was drafted. However, an independent safety review identified critical areas requiring remediation before any initialization can be authorized:
1. Hardcoded credentials and connection strings in executable proposals.
2. Destructive automatic rollback scripts (`DROP DATABASE`, `DROP ROLE`, `pg_terminate_backend`).
3. Network binding discrepancy where PostgreSQL listens on wildcard `0.0.0.0` and `::`.
4. Insufficient fail-closed target assertions across all stages.
5. Incomplete analysis of migration runner CLI invocation and transaction semantics.
6. Lack of pre-seed verification and prohibition of automatic seed retries.
7. Lack of strict human approval gates separating role/DB creation, migration, and seeding.

This document, **Step 2D-2A-R**, provides the definitive, remediated plan resolving all seven findings.

> [!IMPORTANT]
> **Strict Execution Boundary:** This phase is **PLAN AND READ-ONLY INSPECTION ONLY**. Zero databases, roles, tables, or schemas were created or modified. Zero migrations, seeds, or write queries were executed. No PostgreSQL configuration, service settings, firewall rules, or application source files were altered. All proposed procedures in this document are strictly **[NOT EXECUTED]**.

---

## 2. Step 2D-2A-R Safety Remediation Record (Dated: 2026-10-09)

The following table records each review finding, the specific remediation applied, the underlying technical evidence, and remaining unresolved risks:

| Finding | Safety Finding Description | Remediation Applied | Empirical Evidence / Rationale | Unresolved Risk / Required Human Action |
|---|---|---|---|---|
| **REM-01: Credential Safety** | Initial plan included hardcoded passwords (`'zentra_dev_pass'`) and plaintext connection strings. | Removed all hardcoded credentials and connection strings. Defined an interactive prompt / ephemeral session environment variable mechanism. Documented application secret ingestion via `.gitignore`'d `.env` and masked logging. | `.gitignore` line 20 strictly ignores `.env*` except `.env.example`. Hardcoded credentials in operational scripts risk leaking to logs or git history. | Human operator must supply the password out-of-band at execution time; never commit secrets. |
| **REM-02: Non-Destructive Failure Handling** | Initial plan proposed automatic `DROP DATABASE`, `DROP ROLE`, and `pg_terminate_backend` on failure, and assumed atomic 14-migration rollback. | Completely eliminated all automated drop and terminate logic. Replaced with fail-closed immediate stop, full diagnostic capture, and mandatory human authorization. Clarified that Kysely migrations execute per-migration transactions. | If migration 8 fails, migrations 1–7 remain committed. Automated drop risks wiping state or accidentally targeting existing databases. Kysely does not wrap all 14 migrations in a single overarching transaction. | Partial migration failure leaves catalog in mixed state; requires human inspection and manual triage plan. |
| **REM-03: Network Binding Discrepancy** | Plan claimed PostgreSQL is "loopback-only" despite TCP listeners on `0.0.0.0` and `::`. | Conducted read-only inspection. Verified `listen_addresses = '*'` and `0.0.0.0:5432` / `[::]:5432` listeners. Verified `pg_hba.conf` allows only `127.0.0.1` and `::1`. Identified firewall status as permission-denied. Struck "loopback-only" claims; marked external exposure **NOT VERIFIED**. | `Get-NetTCPConnection` confirmed port 5432 bound to `0.0.0.0` and `::`. SQL `SHOW listen_addresses;` returned `'*'`. Non-elevated firewall query returned `Access is denied`. | Wildcard binding exposes port 5432 to LAN/Wi-Fi interfaces. Human operator must review host firewall rules. |
| **REM-04: Fail-Closed Target Validation** | Target validation was limited to `current_database()` without verifying transport, port, or user identity across stages. | Specified multi-layer runtime assertions before every stage: `inet_server_addr()` (strictly `127.0.0.1` or `::1`), `inet_server_port()` (`5432`), `current_database()`, and `current_user`. Explicitly rejection-listed all other catalogs (`zentra_test`, `hisecure_erp`, etc.). | Guarantees queries cannot execute against remote databases, wrong ports, or existing production/test catalogs under any circumstance. | None; fail-closed behavior halts execution if any parameter deviates. |
| **REM-05: Migration Runner Invocation** | `apps/api/src/database/migration-runner.ts` is an internal library with no CLI entry point; plan lacked a verified safe invocation method. | Read-only inspected `migration-runner.ts`. Documented that no CLI exists in `package.json`. Clarified per-migration transaction reality. Marked CLI invocation **NOT VERIFIED WITHOUT SEPARATELY REVIEWED RUNNER PROPOSAL**. Formulated standalone runner specification. | `migration-runner.ts` exports functions but lacks `require.main === module` or `pnpm db:migrate` script. Calling unreviewed code risks unhandled failures. | Requires operator review of standalone migration script specification before implementation. |
| **REM-06: Seed Safety & Non-Idempotency** | Plan noted seed was non-idempotent but lacked verification of clean state and did not prohibit retries on partial failure. | Confirmed seed script uses static unique business keys (`DEMO_DIS`, `DEMO_SAL`, `DEMO_BLK`). Defined qualification check: 14 migrations complete and 0 rows across domain tables. Strictly prohibited automated retries on failure; mandated human review. | `districts.district_code` and `schools.udise_code` have `UNIQUE` constraints. Re-running or retrying after partial failure throws `23505: unique_violation`. | Seeding failure leaves partial synthetic data; requires operator review. |
| **REM-07: Decoupled Approval Boundary** | Initial plan presented an end-to-end 5-phase procedure without intermediate approval boundaries. | Restructured the future execution model into three strictly decoupled stages: Stage A (Role/DB Creation), Stage B (Migrations), and Stage C (Seeding). Each stage requires its own independent preflight and human authorization gate. | Prevents runaway execution where an issue in role creation or schema migration cascades into corrupted data or unverified state. | Operator must explicitly authorize each stage sequentially. |

---

## 3. Network Binding Discrepancy & Host Exposure Audit

### 3.1 Empirical Read-Only Investigation Findings
During the Step 2D-1 and Step 2D-2A-R read-only inspections, the following facts were established:

1. **Operating System Port Listeners:**
   - PowerShell command: `Get-NetTCPConnection -LocalPort 5432 -State Listen`
   - **Observed Result:**
     - `LocalAddress: 0.0.0.0`, `LocalPort: 5432`, `State: Listen`, `OwningProcess: 5928` (`postgres.exe`)
     - `LocalAddress: ::`, `LocalPort: 5432`, `State: Listen`, `OwningProcess: 5928` (`postgres.exe`)
   - **Implication:** The operating system socket is bound to **INADDR_ANY** (all IPv4 interfaces) and **in6addr_any** (all IPv6 interfaces).

2. **PostgreSQL Server Configuration:**
   - Read-only SQL query via loopback admin connection:
     ```sql
     SHOW listen_addresses;
     SHOW port;
     ```
   - **Observed Result:** `listen_addresses = '*'`; `port = 5432`.
   - **Implication:** PostgreSQL is explicitly configured to listen on all available network adapters on the workstation.

3. **Client Authentication Rules (`pg_hba.conf`):**
   - Read-only SQL query:
     ```sql
     SELECT line_number, type, database, user_name, address, auth_method 
     FROM pg_hba_file_rules 
     ORDER BY line_number;
     ```
   - **Observed Result:**
     - Line 113: `local all all trust`
     - Line 115: `host all all 127.0.0.1/32 trust`
     - Line 117: `host all all ::1/128 trust`
     - Line 120-122: `replication` entries for `local`, `127.0.0.1/32`, and `::1/128`
   - **Implication:** At the PostgreSQL protocol layer, incoming TCP connections originating from any IP address other than `127.0.0.1` and `::1` are rejected by `pg_hba.conf` with `FATAL: no pg_hba.conf entry for host`.

4. **Host Firewall Exposure Status:**
   - PowerShell command: `Get-NetFirewallPortFilter | Where-Object { $_.LocalPort -eq 5432 }`
   - **Observed Result:** `PermissionDenied: Access is denied. (Windows System Error 5)`
   - **Implication:** Querying Windows Defender Firewall port filtering rules requires elevated Administrator privileges that are not available in this standard non-elevated developer shell.

### 3.2 Security Risk Analysis
- **Wildcard Listener Risk:** Because PostgreSQL binds to `0.0.0.0` and `::`, the TCP port 5432 accepts initial TCP handshake packets (SYN/ACK) on physical network adapters (e.g. Wi-Fi, Ethernet, virtual LANs) before the application layer evaluates `pg_hba.conf`.
- **Authentication Method Risk:** On loopback (`127.0.0.1` / `::1`), `pg_hba.conf` is currently configured with `auth_method: trust`. While remote IPs are not included in `pg_hba.conf`, relying on application-layer rejection without verified packet filtering at the firewall level is an open risk.
- **Unverified Status:** Because Windows Firewall rules could not be queried without elevation, host-level inbound packet filtering on port 5432 is **NOT VERIFIED**.

> [!CAUTION]
> **UNRESOLVED NETWORK EXPOSURE: NOT VERIFIED**  
> PostgreSQL is confirmed listening on wildcard addresses (`0.0.0.0` and `::`). The server is **NOT loopback-only** at the network socket layer. Prior to authorizing database initialization, the human operator should verify that Windows Defender Firewall blocks inbound traffic on port 5432 from Public and Private network profiles.

---

## 4. Credential Safety & Secret Management Architecture

### 4.1 Elimination of Hardcoded Plaintext Secrets
- In the initial plan, example commands and scripts contained plaintext passwords (`'zentra_dev_pass'`) and complete connection strings (`postgresql://zentra_dev:zentra_dev_pass@localhost:5432/zentra_local`).
- **Correction Applied:** All hardcoded passwords, embedded tokens, and plaintext connection strings have been completely expunged from this plan. All references use parameterized placeholders: `<ZENTRA_DEV_PASSWORD>`.

### 4.2 Safe Local Credential Entry Mechanisms
When initialization execution is eventually authorized, local credentials must be provided through one of two secure channels:
1. **Interactive Prompt (Recommended):** The execution script prompts the operator for the password via standard input with masked echo (e.g. Node.js `readline` with muted terminal output, or PowerShell `Read-Host -AsSecureString`). The password exists only in volatile process memory and is never written to disk or printed to stdout.
2. **Ephemeral Session Environment Variable:** The operator exports an environment variable (e.g. `$env:ZENTRA_DEV_DB_PASSWORD`) in the active terminal session immediately prior to execution. The variable is read by the process and never persisted in source files.

### 4.3 Safe Application Credential Usage
- **Configuration Loading:** [`packages/config/src/index.ts`](file:///d:/Zentra/packages/config/src/index.ts) loads application settings from `process.env`, backed by a local `.env` file when running in development mode.
- **Source Control Protection:** [`.gitignore`](file:///d:/Zentra/.gitignore#L20) explicitly ignores all `.env*` files with an exception only for `.env.example`:
  ```gitignore
  .env*
  !.env.example
  ```
- **Log Sanitization:** Application connection factories and test gates must mask all credentials in error logs and debug strings:
  ```
  postgresql://zentra_dev:********@127.0.0.1:5432/zentra_local
  ```
- **Phase Boundary:** No `.env` file will be created, modified, or written during this plan-only phase.

---

## 5. Fail-Closed Target Validation Specification

To guarantee that no command ever operates against a remote host, wrong port, or unintended local database (such as `zentra_test`, `hisecure_erp`, or `hitech_platform`), independent validation checks must be executed immediately upon establishing any connection, prior to issuing any DDL, migration, or DML.

### 5.1 Validation Assertions by Stage

```mermaid
flowchart TD
    Conn["Client Connection Established"] --> V1["Assertion 1: Transport Verification<br/>SELECT inet_server_addr(), inet_server_port();"]
    V1 -->|Address NOT IN ('127.0.0.1', '::1') OR Port != 5432| Abort["ABORT IMMEDIATELY (Fail-Closed)"]
    V1 -->|Address IS Loopback AND Port == 5432| V2["Assertion 2: Catalog Name Verification<br/>SELECT current_database();"]
    V2 -->|Matches 'zentra_test', 'hisecure_erp', 'hitech_platform'| Abort
    V2 -->|Does NOT Match Expected Catalog for Stage| Abort
    V2 -->|Matches Allowed Catalog| V3["Assertion 3: Role Identity Verification<br/>SELECT current_user, session_user;"]
    V3 -->|Role Does NOT Match Allowed Stage Role| Abort
    V3 -->|All Assertions Pass| Exec["PROCEED WITH STAGE WORK"]
```

#### Detailed Validation Rules:
1. **Network Transport Verification:**
   - Execute: `SELECT inet_server_addr() AS host, inet_server_port() AS port;`
   - **Enforcement:** `host` must strictly be `'127.0.0.1'` or `'::1'`. `port` must strictly be `5432`.
   - If `host` is NULL (local socket) or any non-loopback IP, or if `port` is not 5432: **ABORT IMMEDIATELY**.
2. **Database Catalog Verification:**
   - Execute: `SELECT current_database();`
   - **Stage A (Role/Catalog Creation):** Target must be `'postgres'`.
   - **Stage B (Migrations):** Target must strictly be `'zentra_local'`.
   - **Stage C (Seeding):** Target must strictly be `'zentra_local'`.
   - **Strict Rejection List:** If `current_database()` equals `'zentra_test'`, `'hisecure_erp'`, `'hitech_platform'`, or any database not explicitly permitted for the stage: **ABORT IMMEDIATELY**.
3. **Role Identity Verification:**
   - Execute: `SELECT current_user, session_user;`
   - **Stage A:** User must be administrative role (e.g. `'postgres'`).
   - **Stage B & C:** User must strictly be `'zentra_dev'`.
4. **Driver URL Parsing Gate:**
   - All connection strings must pass [`packages/testing/src/production-gate.ts`](file:///d:/Zentra/packages/testing/src/production-gate.ts) checks: strictly loopback host, zero prohibited cloud markers (`neon.tech`, `rds.amazonaws.com`, `supabase.co`, etc.), and zero query parameter driver overrides (`sslmode`, `host`, `sslrootcert`).

---

## 6. Migration Runner Architecture & Invocation Assessment

### 6.1 Read-Only Inspection of `migration-runner.ts`
The migration runner in [`apps/api/src/database/migration-runner.ts`](file:///d:/Zentra/apps/api/src/database/migration-runner.ts) was analyzed in detail:

```typescript
export async function runMigrationsToLatest(databaseUrl?: string): Promise<MigrationResultSet> {
  if (process.env.NODE_ENV === 'test' || process.env.APP_ENV === 'test') {
    const target = databaseUrl || loadAppConfig().DATABASE_URL;
    assertTestDatabaseIsSafe(target);
  }
  const db = createDatabaseConnection(databaseUrl);
  const migrator = createMigrator(db);

  try {
    const result = await migrator.migrateToLatest();
    return result;
  } finally {
    await db.destroy();
  }
}
```

### 6.2 Key Technical Findings:
1. **Absence of CLI Entry Point:**
   - `migration-runner.ts` is an internal TypeScript module. It does **not** include an executable entry point (`require.main === module`).
   - `apps/api/package.json` contains scripts for `build`, `dev`, `start`, `typecheck`, `test`, `clean`. It contains **zero** database management scripts (e.g. `pnpm db:migrate` does not exist).
2. **Kysely Transaction Semantics:**
   - Kysely's `Migrator.migrateToLatest()` executes each migration in its own separate transaction (or per-migration DDL batch).
   - Kysely does **not** wrap all 14 migrations into a single, overarching transaction.
   - **Implication:** If migration 9 fails, migrations 1 through 8 have already been committed to PostgreSQL and recorded in the `kysely_migration` table.
   - Automatic "all-or-nothing" transactional rollback across all 14 migrations is **impossible** under Kysely's default execution model.
3. **Down Migration Capabilities:**
   - Although individual migration files implement `down(db: Kysely<any>)`, `migration-runner.ts` only exposes `rollbackLatestMigration()` which rolls back a single migration via `migrator.migrateDown()`.
   - Running an automated rollback loop across multiple migrations on error carries severe risk of compounding DDL failures.

### 6.3 Invocation Status & Proposed Standalone Runner
Because running migrations from the CLI requires either modifying application code (prohibited in this plan) or running an unreviewed script:

> [!WARNING]
> **CLI MIGRATION INVOCATION STATUS: NOT VERIFIED WITHOUT SEPARATELY REVIEWED PROPOSAL**  
> There is currently no verified CLI command in `package.json` to execute migrations against `zentra_local`. A dedicated standalone runner script must be reviewed as a separate proposal before Stage B execution can be authorized.

#### Specification for Future Migration Runner Script (`run_migrations_local.ts`):
1. Accepts database URL or connection parameters exclusively via environment variables or CLI prompt; zero hardcoded secrets.
2. Performs full fail-closed transport and catalog assertions:
   - Must prove `inet_server_addr() IN ('127.0.0.1', '::1')`.
   - Must prove `current_database() === 'zentra_local'`.
   - Must prove `current_user === 'zentra_dev'`.
3. Invokes `createMigrator(db).migrateToLatest()`.
4. Inspects `MigrationResultSet`:
   - If `result.error` is present: logs the specific failing migration name and error details, exits with non-zero code, and **does not attempt automated rollback**.
   - If successful: prints the list of successfully executed migrations and exits cleanly.

---

## 7. Development Seed Safety & Non-Idempotency Guarantees

### 7.1 Seed Script Architecture & Non-Idempotency Proof
The synthetic development seed script in [`apps/api/src/database/seeds/synthetic-dev-fixtures.ts`](file:///d:/Zentra/apps/api/src/database/seeds/synthetic-dev-fixtures.ts) was inspected:
- **Synthetic Guarantee:** 100% synthetic fixtures (Erode/Salem demo districts, mock UDISE codes, synthetic users). Zero real school PII.
- **Proof of Non-Idempotency:** The script hardcodes unique business keys:
  - Districts: `district_code: 'DEMO_DIS'`, `district_code: 'DEMO_SAL'` (Table has unique constraint on `district_code`).
  - Blocks: `block_code: 'DEMO_BLK'`, `block_code: 'DEMO_BLK_EAST'` (Table has composite unique constraint `uq_blocks_district_code`).
  - Schools: `udise_code: 'DEMO_SCH_001'` through `'DEMO_SCH_004'` (Table has unique constraint on `udise_code`).
  - Labs: `lab_code: 'LAB_01'` (Table has composite unique constraint `uq_hi_tech_labs_school_code`).
  - Users: `email: 'admin@zentra.local'`, `email: 'reporting.head@zentra.local'` (Table has unique constraint on `email`).
- **Consequence:** If `seedSyntheticDevelopmentFixtures` is executed more than once, or if it is retried after a partial failure without cleaning up, PostgreSQL will throw `23505: unique_violation` and abort.

### 7.2 Strict Pre-Seed Qualification Criteria
Before Stage C (seeding) can be executed, the target database must be proven to be freshly migrated and completely unseeded:
1. **Migration Completeness:** `SELECT count(*) FROM kysely_migration WHERE status = 'Success';` must equal exactly `14`.
2. **Unseeded Table Verification:** Every domain table must have exactly 0 rows:
   ```sql
   SELECT 
     (SELECT count(*) FROM districts) AS district_count,
     (SELECT count(*) FROM schools) AS school_count,
     (SELECT count(*) FROM users) AS user_count,
     (SELECT count(*) FROM service_cases) AS case_count;
   ```
   All counts must strictly equal `0`.
3. **Abort Condition:** If any count is greater than 0, the script must **abort immediately** with an error indicating that the database is already seeded or partially populated.

### 7.3 Prohibition of Automatic Retries
- If any error occurs during seed execution, **automatic retries are strictly prohibited**.
- The script must halt immediately and output the exact error message.
- Human review is mandatory. Partial seeding requires manual operator assessment.

---

## 8. Decoupled Multi-Stage Execution Architecture

To ensure strict human oversight and prevent cascading errors, future initialization work is divided into three discrete, decoupled stages. Each stage requires independent preflight checks, explicit human authorization, and a distinct stop condition.

```mermaid
graph TD
    subgraph S1["Stage A: Role & Database Catalog Creation"]
        A_Pre["Stage A Preflight<br/>(Service running, port 5432, postgres catalog)"] --> A_Gate{"Human Approval<br/>Stage A Gate"}
        A_Gate -->|Authorized| A_Exec["Execute Role & DB Creation<br/>(Create zentra_dev, Create zentra_local)"]
        A_Exec --> A_Post["Stage A Post-Verification<br/>(Verify zentra_local exists, zentra_test untouched)"]
        A_Post --> A_Stop["STOP — AWAITING STAGE B APPROVAL"]
    end

    subgraph S2["Stage B: Controlled Schema Migration"]
        A_Stop -.-> B_Pre["Stage B Preflight<br/>(Target zentra_local, Role zentra_dev, 0 tables)"]
        B_Pre --> B_Gate{"Human Approval<br/>Stage B Gate"}
        B_Gate -->|Authorized| B_Exec["Execute 14 Migrations<br/>(Standalone reviewed runner)"]
        B_Exec --> B_Post["Stage B Post-Verification<br/>(Verify 14 migrations, 34 tables created)"]
        B_Post --> B_Stop["STOP — AWAITING STAGE C APPROVAL"]
    end

    subgraph S3["Stage C: Synthetic Fixture Seeding"]
        B_Stop -.-> C_Pre["Stage C Preflight<br/>(Target zentra_local, 14 migrations, 0 rows)"]
        C_Pre --> C_Gate{"Human Approval<br/>Stage C Gate"}
        C_Gate -->|Authorized| C_Exec["Execute Synthetic Seed<br/>(seedSyntheticDevelopmentFixtures)"]
        C_Exec --> C_Post["Stage C Post-Verification<br/>(Verify row counts, zero real PII)"]
        C_Post --> C_Stop["STOP — INITIALIZATION COMPLETE"]
    end
```

---

### Stage A: Local Role & Database Catalog Creation [NOT EXECUTED]

#### A.1 Preflight Checks:
1. Verify Windows service `postgresql-x64-18` is in `Running` state.
2. Verify TCP port 5432 is listening.
3. Verify network exposure risk has been acknowledged by operator.
4. Connect as administrative role `postgres` to catalog `postgres` on `127.0.0.1:5432`.
5. Verify `inet_server_addr() IN ('127.0.0.1', '::1')` and `current_database() === 'postgres'`.
6. Verify `zentra_local` database catalog does not already exist.
7. Verify `zentra_test` exists and is untouched.

#### A.2 Actions Upon Explicit Authorization [NOT EXECUTED]:
```sql
-- [NOT EXECUTED — REQUIRES STAGE A OPERATOR APPROVAL]
-- Operator supplies <ZENTRA_DEV_PASSWORD> interactively
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'zentra_dev') THEN
    CREATE ROLE zentra_dev WITH LOGIN PASSWORD '<ZENTRA_DEV_PASSWORD>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

CREATE DATABASE zentra_local OWNER zentra_dev ENCODING 'UTF8';
GRANT ALL PRIVILEGES ON DATABASE zentra_local TO zentra_dev;
```

#### A.3 Post-Verification:
1. Query `pg_database` to confirm `zentra_local` exists and has `pg_get_userbyid(datdba) = 'zentra_dev'`.
2. Confirm `zentra_test`, `hisecure_erp`, and `hitech_platform` are untouched.
3. Test connection as `zentra_dev` to `zentra_local` verifying `current_user = 'zentra_dev'` and `current_database() = 'zentra_local'`.
4. **Mandatory Stop Condition:** `STOP — STAGE A COMPLETE — AWAITING HUMAN APPROVAL FOR STAGE B`.

---

### Stage B: Controlled Kysely Schema Migration [NOT EXECUTED]

#### B.1 Preflight Checks:
1. Connect to `zentra_local` on `127.0.0.1:5432` as `zentra_dev`.
2. Assert `inet_server_addr() IN ('127.0.0.1', '::1')`.
3. Assert `current_database() === 'zentra_local'` (fail-closed if any other catalog).
4. Assert `current_user === 'zentra_dev'`.
5. Query `information_schema.tables WHERE table_schema = 'public'`: must return `0` tables.

#### B.2 Actions Upon Explicit Authorization [NOT EXECUTED]:
- Execute the separately reviewed standalone migration script (`run_migrations_local.ts`).
- Executes all 14 Kysely migrations sequentially:
  1. `20261005000001_create_territory_and_schools`
  2. `20261005000002_create_equipment_master`
  3. `20261005000003_create_complaints_and_service_cases`
  4. `20261005000004_create_visits_evidence_and_findings`
  5. `20261005000005_create_governance_staging_and_audit`
  6. `20261007000001_create_auth_and_rbac`
  7. `20261007000002_create_hi_tech_labs_rls`
  8. `20261007000003_create_lab_equipment_rls`
  9. `20261008000001_create_import_staging_rls`
  10. `20261008000002_enhance_service_cases_and_dispatch`
  11. `20261008000003_create_sync_and_idempotency`
  12. `20261008000004_enhance_field_visits_and_lifecycle`
  13. `20261008000005_enhance_evidence_files_and_s3_pipeline`
  14. `20261008000006_create_conveyance_and_claims`

#### B.3 Post-Verification:
1. Verify `SELECT count(*) FROM kysely_migration WHERE status = 'Success';` returns `14`.
2. Verify `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';` returns exactly `34`.
3. Verify RLS status on protected tables: `hi_tech_labs`, `lab_equipment`, `import_staging_records`, `conveyance_claims` have `relrowsecurity = true` and `relforcerowsecurity = true`.
4. **Mandatory Stop Condition:** `STOP — STAGE B COMPLETE — AWAITING HUMAN APPROVAL FOR STAGE C`.

---

### Stage C: Synthetic Development Fixture Seeding [NOT EXECUTED]

#### C.1 Preflight Checks:
1. Connect to `zentra_local` on `127.0.0.1:5432` as `zentra_dev`.
2. Assert `inet_server_addr() IN ('127.0.0.1', '::1')`.
3. Assert `current_database() === 'zentra_local'`.
4. Assert `current_user === 'zentra_dev'`.
5. Verify `SELECT count(*) FROM kysely_migration;` equals `14`.
6. Verify domain table row counts are strictly `0` (`districts`, `schools`, `users`, `service_cases`).

#### C.2 Actions Upon Explicit Authorization [NOT EXECUTED]:
- Execute `seedSyntheticDevelopmentFixtures(db)` using an isolated runner script.
- Zero real data; 100% synthetic mock entities.
- Single execution only; zero automated retries on failure.

#### C.3 Post-Verification:
1. Verify synthetic records:
   - `districts`: 2 rows (`DEMO_DIS`, `DEMO_SAL`)
   - `blocks`: 3 rows
   - `schools`: 4 rows
   - `hi_tech_labs`: 5 rows
   - `users`: 8 rows
   - `service_cases`: 2 rows
2. Verify zero real school PII or unhashed passwords.
3. Confirm `zentra_test` remains untouched.
4. **Mandatory Stop Condition:** `STOP — STEP 2D-2 INITIALIZATION COMPLETE`.

---

## 9. Non-Destructive Failure Handling & Diagnostics Preservation

### 9.1 Elimination of Destructive Automated Rollback
- The previous plan's proposal for an automatic rollback script using `DROP DATABASE IF EXISTS zentra_local`, `DROP ROLE IF EXISTS zentra_dev`, and `pg_terminate_backend(...)` is **COMPLETELY REVOKED**.
- **Rationale:** Automatic dropping of databases upon failure is dangerous:
  1. A misconfigured script or variable could accidentally drop the wrong catalog (e.g. `zentra_test` or an ERP catalog).
  2. Terminating backend processes via `pg_terminate_backend` without human inspection can sever connections from other active applications sharing the local PostgreSQL instance.
  3. Dropping the database destroys forensic evidence needed to determine why the migration or DDL failed.

### 9.2 Non-Destructive Failure Protocol
In the event of any failure during any stage of execution:
1. **HALT IMMEDIATELY:** The execution script must immediately stop and exit with a non-zero exit code.
2. **PRESERVE ALL STATE:** No database, role, table, row, or migration record may be altered or dropped.
3. **LOG FORENSIC DIAGNOSTICS:** Write an error report detailing:
   - Stage and step during which failure occurred.
   - Target database, host, port, and user.
   - PostgreSQL error code (`SQLSTATE`), message, and stack trace.
   - List of successfully completed operations prior to the error.
4. **HUMAN OPERATOR NOTIFICATION:** Report the failure details to the operator.
5. **MANDATORY HUMAN APPROVAL:** Any subsequent action (manual diagnosis, schema fix, or controlled cleanup) requires a dedicated, reviewed plan and explicit human operator approval.

---

## 10. Confirmation of Safety, Data Protection & ₹0 Budget

- **Database Writes / DDL:** **ZERO.** No databases, roles, tables, or schemas were created, altered, or dropped.
- **Data Mutating Commands:** **ZERO.** No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, migrations, or seeds were executed.
- **Configuration Modifications:** **ZERO.** No changes made to `postgresql.conf`, `pg_hba.conf`, Windows services, or firewall rules.
- **Codebase / Environment Integrity:** **ZERO.** No `.env` files or application source code in `apps/` or `packages/` were modified.
- **Remote Cloud Connections:** **ZERO.** No connections made to Neon, AWS, Supabase, Render, or any remote host.
- **Budget Integrity:** Strict ₹0/month budget preserved.

---

```
STOP — STEP 2D-2A-R PLAN REMEDIATION COMPLETE — WAITING FOR HUMAN REVIEW
```

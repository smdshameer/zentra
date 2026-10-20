# MUSE SPARK — ZENTRA STEP 2D-0
## READ-ONLY DATABASE LOCATION DISCOVERY AUDIT REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Target Repository:** `D:\Zentra`  
**Inspection Date:** 2026-10-09  
**Mode:** STRICT READ-ONLY INSPECTION  
**Budget Constraint:** Strict ₹0/month (Zero cost, no credit cards, no paid upgrades)  
**Remote Database Access:** STRICTLY PROHIBITED (Zero remote connections made)  
**Deployment Authorization:** NOT GRANTED  
**Audit Status:** COMPLETE — READY FOR HUMAN REVIEW  

---

## 1. Executive Summary & Objective

In accordance with Step 2D-0, an exhaustive read-only inspection was performed across the ZENTRA codebase, configuration schemas, infrastructure definitions, documentation, and host service metadata to determine where ZENTRA's PostgreSQL database is configured to run.

### Key Discoveries:
1. **Configured Runtime Database:** Statically configured as **`localhost:5432`** targeting database **`zentra_local`** via defaults in [`packages/config/src/env.schema.ts`](file:///d:/Zentra/packages/config/src/env.schema.ts#L22-L25).
2. **Configured Test Database:** Statically configured as **`localhost:5432`** targeting database **`zentra_test`** across all 19 test suites in [`apps/api/test/`](file:///d:/Zentra/apps/api/test/) and enforced by [`packages/testing/src/production-gate.ts`](file:///d:/Zentra/packages/testing/src/production-gate.ts#L13-L20).
3. **Local Host Database Engine:** A native Windows service named **`postgresql-x64-18` (PostgreSQL 18.6)** is currently installed and running on the host workstation.
4. **Docker Containerization Status:** **ABSENT.** No `docker-compose.yml`, `compose.yml`, or `Dockerfile` exists anywhere in the repository. The Docker CLI is not installed on the host. The comment in `.env.example` referencing `infra/docker` is stale and aspirational.
5. **Remote Cloud Providers:**
   - **AWS RDS:** Declared in Terraform template [`infra/terraform/staging/rds.tf`](file:///d:/Zentra/infra/terraform/staging/rds.tf) for staging (`zentra_staging`), but completely unprovisioned (0 Terraform state, 0 AWS resources).
   - **Neon Free PostgreSQL:** Documented in design reports ([`docs/MUSE_SPARK_FREE_HOSTING_*.md`](file:///d:/Zentra/docs/)) as the candidate zero-cost staging host, but has **zero** connection strings, project IDs, or credentials configured in repository code or environment variables.
6. **Active Shell Environment:** Clean. Zero database-related environment variables (`DATABASE_URL`, `TEST_DATABASE_URL`, `PG*`, `NEON*`) are set. Zero `.env` files exist on disk (only `.env.example` template).

---

## 2. Inventory of Files Inspected & Findings

A recursive scan was conducted across the repository (excluding `node_modules`, `.git`, `.turbo`, and build output directories). The following files were inspected:

| File Path | Category | Relevant Findings |
|---|---|---|
| [`package.json`](file:///d:/Zentra/package.json) | Workspace Configuration | Monorepo root. Defines Turbo scripts (`build`, `dev`, `lint`, `typecheck`, `test`). **Zero** database startup, migration, or container scripts exist at root. |
| [`pnpm-workspace.yaml`](file:///d:/Zentra/pnpm-workspace.yaml) | Package Workspace | Declares `apps/*` and `packages/*`. No standalone database or container package. |
| [`apps/api/package.json`](file:///d:/Zentra/apps/api/package.json) | API Service Config | Defines scripts (`build`, `dev`, `start`, `typecheck`, `test`, `clean`). No `db:migrate`, `db:seed`, or db setup scripts. |
| `README.md` / `README*` | Documentation | **NOT FOUND** across the repository. Architectural documentation is located in `docs/`. |
| Local DB Scripts (`*.sh`, `*.bat`, `*.ps1`, `scripts/`) | Operational Tooling | **NOT FOUND** across the repository. No startup, wrapper, or teardown scripts exist. |
| `docker-compose.yml`, `compose.yml`, `Dockerfile` | Container Orchestration | **NOT FOUND** across the repository. No container definitions exist. |
| [`.env.example`](file:///d:/Zentra/.env.example) | Configuration Template | Documents `DATABASE_URL=postgresql://zentra_dev:zentra_dev_pass@localhost:5432/zentra_local` and `TEST_DATABASE_URL=postgresql://zentra_test:zentra_test_pass@localhost:5432/zentra_test`. Line 20 contains a stale comment referencing `(infra/docker)`. |
| `.env`, `.env.local`, `.env.staging` | Active Config Files | **NOT FOUND** across the repository. No active runtime environment files exist on disk. |
| [`packages/config/src/env.schema.ts`](file:///d:/Zentra/packages/config/src/env.schema.ts) | Core Configuration Schema | Zod schema defining application configuration. Hardcodes runtime default `DATABASE_URL` to `postgresql://zentra_dev:zentra_dev_pass@localhost:5432/zentra_local`. |
| [`packages/config/src/index.ts`](file:///d:/Zentra/packages/config/src/index.ts) | Configuration Loader | Exports `loadAppConfig()`, which parses `process.env` against `envSchema`. |
| [`apps/api/src/database/database.connection.ts`](file:///d:/Zentra/apps/api/src/database/database.connection.ts) | DB Connection Factory | Resolves connection string from `customUrl || config.DATABASE_URL`. Passes to `new Pool({ connectionString })`. In test mode, enforces `assertTestDatabaseIsSafe(connectionString)`. |
| [`apps/api/src/database/migration-runner.ts`](file:///d:/Zentra/apps/api/src/database/migration-runner.ts) | Migration Engine | Programmatically executes 14 Kysely migrations using `ExplicitMigrationProvider`. Resolves target to `databaseUrl || loadAppConfig().DATABASE_URL`. |
| [`apps/api/src/database/database.module.ts`](file:///d:/Zentra/apps/api/src/database/database.module.ts) | NestJS DB Module | Provides `DATABASE_CONNECTION` factory token using `createDatabaseConnection()`. |
| [`apps/api/src/database/seeds/synthetic-dev-fixtures.ts`](file:///d:/Zentra/apps/api/src/database/seeds/synthetic-dev-fixtures.ts) | Database Seeds | 100% synthetic development fixtures. Zero references to real school PII or external databases. |
| [`apps/api/src/main.ts`](file:///d:/Zentra/apps/api/src/main.ts) | Central API Bootstrap | Bootstraps NestJS + Fastify. Relies on `loadAppConfig()` to read configuration defaults. |
| [`packages/testing/src/production-gate.ts`](file:///d:/Zentra/packages/testing/src/production-gate.ts) | Safety Gate Library | Enforces `ALLOWED_LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]']` and `ALLOWED_TEST_DATABASES = ['zentra_test']`. Rejects remote hosts and cloud markers. |
| [`apps/api/test/*.spec.ts`](file:///d:/Zentra/apps/api/test/) (19 files) | Integration Test Suites | Every database-connected test file defaults `TEST_DB_URL` to `'postgresql://postgres:postgres@localhost:5432/zentra_test'`. |
| [`infra/terraform/staging/rds.tf`](file:///d:/Zentra/infra/terraform/staging/rds.tf) | Staging Infrastructure | Declares AWS RDS PostgreSQL 16.3 instance (`zentra-staging-db`, `db_name = "zentra_staging"`). Completely unprovisioned. |
| [`infra/terraform/staging/variables.tf`](file:///d:/Zentra/infra/terraform/staging/variables.tf) | Infrastructure Variables | Defines RDS sizing defaults (`db_instance_class = "db.t4g.micro"`, `db_allocated_storage = 20`). |
| [`docs/ZENTRA_ENVIRONMENT_STRATEGY.md`](file:///d:/Zentra/docs/ZENTRA_ENVIRONMENT_STRATEGY.md) | Architecture Spec | Documents 5 environments (`LOCAL`, `TEST`, `DEVELOPMENT`, `STAGING`, `PRODUCTION`). States `LOCAL` uses Local Docker (Postgres 16, MinIO), but Docker files were never scaffolded. |
| [`docs/ZENTRA_DATABASE_IMPLEMENTATION.md`](file:///d:/Zentra/docs/ZENTRA_DATABASE_IMPLEMENTATION.md) | Database Spec | Documents 21 relational tables, Kysely query builder, and states `PostgreSQL 16+ (Verified on 18.6 locally)`. |

---

## 3. Configured Database Host Classification & Evidence

### 3.1 Host Classification
- **Primary Runtime Classification:** **`localhost` (TCP Loopback / IPv4 `127.0.0.1` / Port `5432`)**
- **Test Runner Classification:** **`localhost` (TCP Loopback / IPv4 `127.0.0.1` / Port `5432`)**
- **Public / Remote Network Host:** **NONE CONFIGURED.** Zero public IPs, cloud hostnames, or private WAN hostnames are bound in application runtime code.

### 3.2 Evidence Details
1. **Runtime Fallback (`@zentra/config`):**
   ```typescript
   DATABASE_URL: z
     .string()
     .min(1, 'DATABASE_URL cannot be empty')
     .default('postgresql://zentra_dev:zentra_dev_pass@localhost:5432/zentra_local'),
   ```
   *Static Proof:* Defined in [`packages/config/src/env.schema.ts`](file:///d:/Zentra/packages/config/src/env.schema.ts#L22-L25).
2. **Test Fallback (`@zentra/api` test suites):**
   ```typescript
   const TEST_DB_URL =
     process.env.TEST_DATABASE_URL ||
     'postgresql://postgres:postgres@localhost:5432/zentra_test';
   ```
   *Static Proof:* Implemented across all 19 test suites in `apps/api/test/` (e.g. [`database-schema.spec.ts`](file:///d:/Zentra/apps/api/test/database-schema.spec.ts#L17)).

---

## 4. Local PostgreSQL Service vs. Docker Assessment

### 4.1 Host Windows Service Status
An inspection of the Windows Service Control Manager on the host was executed via PowerShell `Get-Service`:
- **Service Name:** `postgresql-x64-18`
- **Display Name:** `postgresql-x64-18 - PostgreSQL Server 18`
- **Status:** **`Running`**
- **Conclusion:** A native local PostgreSQL server (version 18.6) is installed and active directly on the Windows development workstation.

### 4.2 Docker Configuration Status
A recursive filesystem search and command check was conducted:
- `docker-compose.yml`: **NOT FOUND**
- `compose.yml`: **NOT FOUND**
- `Dockerfile`: **NOT FOUND**
- `infra/docker/` directory: **NOT FOUND** (`Test-Path "infra/docker"` $\to$ `False`)
- `docker` CLI: **NOT INSTALLED** (`Get-Command docker` $\to$ command not found)
- Docker Windows Service: **NOT PRESENT** (`Get-Service "*docker*"` $\to$ empty)
- **Conclusion:** Docker is completely absent from both the repository and the host operating system. The local developer experience relies entirely on native PostgreSQL.

---

## 5. Remote Database Provider Configuration Assessment

### 5.1 Amazon RDS for PostgreSQL
- **Reference Location:** [`infra/terraform/staging/rds.tf`](file:///d:/Zentra/infra/terraform/staging/rds.tf)
- **Target Engine:** PostgreSQL 16.3 (`db.t4g.micro`, Multi-AZ, `zentra_staging`)
- **Operational Status:** **UNPROVISIONED.** The staging Terraform directory contains zero state files (`terraform.tfstate`), zero local providers (`.terraform/`), and AWS credentials are unconfigured on the host (verified in Step 2C-D-PRE-1).

### 5.2 Neon Serverless PostgreSQL
- **Reference Location:**
  - Evaluated in [`docs/MUSE_SPARK_FREE_HOSTING_MIGRATION_FEASIBILITY_AUDIT.md`](file:///d:/Zentra/docs/MUSE_SPARK_FREE_HOSTING_MIGRATION_FEASIBILITY_AUDIT.md)
  - Evaluated in [`docs/MUSE_SPARK_FREE_HOSTING_STEP2B_NEON_ISOLATION_AUDIT.md`](file:///d:/Zentra/docs/MUSE_SPARK_FREE_HOSTING_STEP2B_NEON_ISOLATION_AUDIT.md)
  - Listed as a `PROHIBITED_REMOTE_MARKER` in [`packages/testing/src/production-gate.ts`](file:///d:/Zentra/packages/testing/src/production-gate.ts#L25)
- **Operational Status:** **NOT CONFIGURED.**
  - There are zero active Neon project identifiers, direct connection strings (`ep-*.neon.tech`), pooled connection strings, or Neon API keys in any file or environment variable.
  - The human operator possesses an existing Neon account used for other projects, but ZENTRA is strictly isolated from it.

---

## 6. Proveability of Active Runtime Database Location

Can the active runtime database location actually be proven from the available evidence?

- **Static Configuration Target: PROVEN.**
  It is proven beyond doubt that the codebase defaults to `localhost:5432` with database catalog `zentra_local`.
- **Database Catalog Existence & Schema State: UNPROVEN.**
  Because database client execution (`psql`, network socket connections, queries) is strictly prohibited in this discovery audit, it cannot be proven from static files alone whether:
  1. The database catalog `zentra_local` actually exists inside the native PostgreSQL service.
  2. The Kysely schema migrations have been applied to `zentra_local`.
  3. The database user `zentra_dev` with password `zentra_dev_pass` exists in the local PostgreSQL instance.

---

## 7. Stale, Conflicting, or Ambiguous Configuration Findings

1. **Stale Docker Documentation:**
   [`.env.example`](file:///d:/Zentra/.env.example#L20) states: `# Local default connects to Dockerized Postgres (infra/docker)`. Similarly, [`docs/ZENTRA_ENVIRONMENT_STRATEGY.md`](file:///d:/Zentra/docs/ZENTRA_ENVIRONMENT_STRATEGY.md#L23) refers to `Local Docker (PostgreSQL 16)`. In reality, Docker is neither installed nor configured; native PostgreSQL 18.6 is running instead.
2. **Missing Local Configuration File:**
   There is no `.env` or `.env.local` file on disk. When running outside of tests, the application relies entirely on hardcoded Zod defaults in `packages/config/src/env.schema.ts`.
3. **Dual Target Staging Ambiguity:**
   The repository contains Terraform manifests targeting paid AWS RDS staging infrastructure (`infra/terraform/staging/rds.tf`), alongside migration feasibility audits targeting ₹0/month Neon Free Tier hosting. Neither is active.

---

## 8. Forensic Certainty Matrix

| Dimension | Classification | Evidence & Rationale |
|---|---|---|
| **Default Runtime DB Host** | 🟢 **Confirmed by static evidence** | `packages/config/src/env.schema.ts` hardcodes `localhost:5432`. |
| **Default Runtime DB Name** | 🟢 **Confirmed by static evidence** | `packages/config/src/env.schema.ts` hardcodes `zentra_local`. |
| **Test Database Target** | 🟢 **Confirmed by static evidence** | All 19 API test suites hardcode `localhost:5432/zentra_test`. |
| **Local PostgreSQL Service** | 🟢 **Confirmed by static evidence** | Windows SCM confirms `postgresql-x64-18` is `Running`. |
| **Absence of Docker** | 🟢 **Confirmed by static evidence** | No docker files, no docker CLI, no docker service. |
| **Absence of Active Remote DB** | 🟢 **Confirmed by static evidence** | Shell env clean, zero remote connection strings in repository. |
| **Existence of `zentra_local` Catalog** | 🟡 **Inferred but not confirmed** | `zentra_test` was confirmed during test runs, but `zentra_local` has not been connected to. |
| **Credentials for `zentra_dev`** | 🟡 **Inferred but not confirmed** | Inferred from `.env.example` and `env.schema.ts`, but unverified against local DB roles. |
| **Operational Status of `zentra_local`** | 🔴 **Unknown** | Read-only restrictions prohibit connecting to verify tables or schema state. |

---

## 9. Recommended Next Step (Preserving Strict ₹0/Month Budget)

### Recommended Action: STEP 2D-1 — CONTROLLED LOCAL DATABASE VERIFICATION
Since the repository statically targets a local database (`localhost:5432/zentra_local`) and a native PostgreSQL service is already active on the host:

1. **Conduct a controlled local database audit** using an isolated local script or read-only CLI check.
2. Verify whether:
   - The native PostgreSQL service is listening on port 5432.
   - The database catalog `zentra_local` exists.
   - The user `zentra_dev` exists and can authenticate locally.
   - Any migrations have been applied to `zentra_local`.
3. **Strict Constraints Maintained:**
   - **Cost:** Exactly ₹0.
   - **Cloud Access:** Zero remote cloud connections; Neon and AWS remain untouched.
   - **Safety:** Do not alter any production database or existing applications sharing the host.

---

## 10. Confirmation of Safety & Compliance

- **Remote Database Access:** **ZERO.** No connections to Neon, AWS, Supabase, Render, or any remote host.
- **Database Client Execution:** **ZERO.** No `psql`, query clients, migrations, seeds, or integration tests were run.
- **Network Stack:** **ZERO.** No socket connections, DNS resolutions, or health probes were made.
- **Cloud State:** **ZERO.** No cloud resources created, updated, or deleted.
- **Codebase Integrity:** **UNTOUCHED.** No source code, `.env` files, or Docker configurations were created or altered.
- **Budget Integrity:** Strict ₹0/month budget preserved.

---

STOP — STEP 2D-0 DATABASE LOCATION DISCOVERY COMPLETE — WAITING FOR HUMAN REVIEW

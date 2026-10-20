# ZENTRA — Hi-Tech Lab Field Call Tracker & ITSM Platform

> **Enterprise-grade, mobile-first field service management (FSM) and IT service management (ITSM) platform for the maintenance, repair, and operational governance of ICT infrastructure across government school Hi-Tech Labs.**

---

## 1. Project Overview

**ZENTRA** is purpose-built to streamline the servicing, dispatch, field verification, and governance of digital classroom infrastructure (computing, networking, power, and audio-visual hardware) deployed across thousands of government high and higher secondary schools.

The platform addresses real-world operational challenges in public education infrastructure management:
- **Rural Field Operations:** Support for field engineers operating in coastal, delta, and remote blocks with zero or intermittent cellular connectivity.
- **Verifiable Proof Standards:** Strict verification requirements for every service visit, including GPS-validated coordinates, timestamped photographs, and school authority sign-offs.
- **SLA & Escalation Governance:** Automated service level agreement tracking, breach alerts, and transparent conveyance reimbursement workflows.

### Operational Surfaces
- **Implemented in Repository:**
  - **ZENTRA Core API (`apps/api`):** Transactional backend foundation built with NestJS and Fastify, featuring Kysely database access, PostgreSQL Row-Level Security (RLS), multi-tenant RBAC, and deterministic delta synchronization.
  - **ZENTRA Field Mobile (`apps/field`):** Unconditional local-first mobile client built with React Native and Expo CNG, powered by WatermelonDB on SQLite, persistent operation queues, and accuracy-gated GPS camera services.
  - **ZENTRA Web Portal (`apps/web`):** Management web interface built with React, Vite, and Tailwind CSS (currently housing the Phase 15 Conveyance Claims review prototype).
  - **Shared Domain Packages (`packages/*`):** Seven shared packages providing canonical TypeScript types, Zod contracts, validation primitives, environment schemas, and testing safety guards.
  - **Staging Infrastructure (`infra/terraform/staging`):** Declarative AWS Terraform suite targeting VPC, RDS PostgreSQL, ECS Fargate, S3, Secrets Manager, and CloudWatch.
- **Planned / Under Development:**
  - Full API integration for ZENTRA Web (wiring mock conveyance views to live backend endpoints).
  - Expanded web administrative interfaces for service case dispatch and school lab inventory dossiers.
  - Automated GitHub Actions continuous integration pipeline (`.github/workflows/ci.yml`).

---

## 2. Current Architecture

ZENTRA is structured as an integrated multi-surface monorepo:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FIELD OPERATIONAL SURFACE                       │
│                                                                        │
│   ZENTRA Field (Mobile Client)                                         │
│   • React Native 0.76 + Expo 52 (Continuous Native Generation)         │
│   • Local SQLite Database (WatermelonDB)                               │
│   • Offline Mutation Queue (UUIDv7 Client Operation IDs)               │
│   • Hardware-Gated GPS Location (<= 50m) & Camera Services             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Bidirectional Delta Sync / REST
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         CORE BACKEND SERVICES                          │
│                                                                        │
│   ZENTRA Core API & Worker (NestJS 11 + Fastify 5)                     │
│   • Fastify Helmet Security Headers & Tiered Rate Limiting             │
│   • Kysely Query Builder over PostgreSQL 16 Pool                       │
│   • PostgreSQL Row-Level Security (RLS) Context Enforcement            │
│   • Domain-Owned Conflict Arbitration & Server Idempotency Keys        │
│   • Presigned S3/MinIO Binary Media Pipeline (SHA-256 Verified)        │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │                                 │
                   ▼                                 ▼
┌────────────────────────────────────┐ ┌─────────────────────────────────┐
│        DATA & STORAGE LAYER        │ │       MANAGEMENT SURFACE        │
│                                    │ │                                 │
│  • PostgreSQL 16 (Authoritative RLS)│ │  ZENTRA Web (Vite + React 18)   │
│  • S3 / MinIO Object Storage       │ │  • Supervisor Approval Portal   │
│  • PG-Boss Background Worker       │ │  • Financial Aggregations       │
└────────────────────────────────────┘ └─────────────────────────────────┘
```

---

## 3. Repository Structure

```
D:\Zentra/
├── apps/
│   ├── api/             # Central REST & Sync Backend (NestJS 11 + Fastify 5 + Kysely)
│   ├── field/           # Mobile Field Engineer App (React Native 0.76 + Expo 52 + WatermelonDB)
│   └── web/             # Management & Conveyance Web Portal (React 18 + Vite 5 + Tailwind CSS)
├── packages/
│   ├── config/          # Zod-validated environment configuration and immutable constants
│   ├── contracts/       # Canonical API request/response contracts and Zod DTOs
│   ├── shared/          # Pure shared utilities (Haversine GPS, UUIDv7, IST date formatting)
│   ├── testing/         # Shared test mocks and fail-closed test database safety gate
│   ├── tooling/         # Shared TypeScript compiler configurations (TSConfig presets)
│   ├── types/           # Canonical TypeScript domain models, branded IDs, and API envelopes
│   └── validation/      # Reusable validation primitives (UDISE school codes, Indian phones)
├── infra/
│   └── terraform/
│       └── staging/     # AWS Terraform infrastructure definitions (VPC, RDS, ECS, S3)
├── docs/                # Canonical system architecture, data models, and specifications
├── package.json         # Root monorepo workspace configuration
├── pnpm-workspace.yaml  # pnpm workspace definition
└── turbo.json           # Turborepo task pipeline orchestration
```

---

## 4. Technology Stack

All technologies listed below are verified from active workspace manifests and configuration files:

| Layer | Technologies |
| :--- | :--- |
| **Monorepo Engine** | [pnpm](https://pnpm.io/) 12.9.1 workspaces, [Turborepo](https://turbo.build/) 2.1.2 |
| **Language** | [TypeScript](https://www.typescriptlang.org/) 5.5.4 (Strict mode enabled across all packages) |
| **Backend API** | [NestJS](https://nestjs.com/) 11.0, [Fastify](https://fastify.dev/) 5.2, [@fastify/helmet](https://github.com/fastify/fastify-helmet) 13.1, [@fastify/rate-limit](https://github.com/fastify/fastify-rate-limit) 11.2 |
| **Database & ORM** | [PostgreSQL](https://www.postgresql.org/) 16+, [Kysely](https://kysely.dev/) 0.27.4, `pg` 8.13.0, PostgreSQL Row-Level Security (RLS) |
| **Mobile Client** | [React Native](https://reactnative.dev/) 0.76.9, [Expo](https://expo.dev/) 52.0 CNG, [WatermelonDB](https://watermelondb.dev/) 0.28.0 (SQLite), Expo Camera, Expo Location, Expo SecureStore |
| **Web Portal** | [React](https://react.dev/) 18.3.1, [Vite](https://vitejs.dev/) 5.4.5, [Tailwind CSS](https://tailwindcss.com/) 3.4.11 |
| **Validation & Schema** | [Zod](https://zod.dev/) 3.23.8 |
| **Testing** | [Vitest](https://vitest.dev/) 2.1.1 across all packages |
| **Code Quality** | [ESLint](https://eslint.org/) 8.57, [Prettier](https://prettier.io/) 3.3.3 |
| **Cloud Infrastructure**| [Terraform](https://www.terraform.io/) targeting AWS (VPC, RDS PostgreSQL, ECS Fargate, S3, Secrets Manager, CloudWatch) |

---

## 5. Prerequisites

Before setting up the repository locally, ensure the following tools are installed:

- **Node.js:** `v20.12.0+` LTS or `v22.x` LTS.
- **pnpm:** `v12.9.1` (configured via `"packageManager": "pnpm@12.9.1"` in root `package.json`). If using Corepack, enable via `corepack enable`.
- **Docker & Docker Compose:** Required to run local PostgreSQL 16 and MinIO S3 object storage containers.
- **Android Development Tools (Optional, for mobile native builds):** Android Studio with Android SDK Platform 34+, Java 17+ (JDK), and an Android Virtual Device (AVD) or physical test device.

---

## 6. Installation and Setup

### 1. Clone the Repository
```bash
git clone https://github.com/smdshameer/zentra.git
cd zentra
```

### 2. Install Monorepo Dependencies
```bash
pnpm install
```

### 3. Configure Local Environment Variables
Create your local environment configuration by copying the verified template:
```bash
cp .env.example .env.local
```

Review `.env.local` to configure safe local defaults:
- `API_PORT`: Default is `4000`.
- `API_HOST`: Default is `0.0.0.0`.
- `DATABASE_URL`: `postgresql://zentra_dev:zentra_dev_pass@localhost:5432/zentra_local`
- `TEST_DATABASE_URL`: `postgresql://zentra_test:zentra_test_pass@localhost:5432/zentra_test`
- `S3_ENDPOINT`: `http://localhost:9000` (Local MinIO)
- `CORS_ORIGIN`: `http://localhost:3000,http://localhost:5173`

> [!CAUTION]
> Never commit `.env` or `.env.local` files containing real production credentials. Keep all secret keys, passwords, and tokens out of version control.

---

## 7. Development Commands

ZENTRA uses Turborepo to coordinate tasks across all workspace packages.

### Root Workspace Commands

| Command | Action |
| :--- | :--- |
| `pnpm dev` | Start development servers across all packages concurrently |
| `pnpm build` | Compile all shared packages and applications in dependency order |
| `pnpm typecheck` | Run TypeScript type checks (`tsc --noEmit`) across all workspaces |
| `pnpm lint` | Execute ESLint across all workspaces |
| `pnpm test` | Run all Vitest test suites across the monorepo |
| `pnpm format` | Check formatting compliance using Prettier |
| `pnpm format:fix` | Automatically apply Prettier formatting |
| `pnpm clean` | Remove build artifacts (`dist/`, `.turbo/`, `*.tsbuildinfo`) |

### Surface-Specific Filtered Commands

```bash
# Start backend API in watch mode
pnpm dev:api

# Start web management portal
pnpm dev:web

# Start mobile Expo development server
pnpm dev:field

# Run targeted test suites
pnpm test:api
pnpm test:web
pnpm test:contracts
```

---

## 8. Testing and Safety Architecture

ZENTRA includes 53 automated test suites across backend, mobile, web, and shared packages using **Vitest**:
- `apps/api/test/`: 22 test suites covering authentication, RLS multi-district boundaries, service case state machines, sync engines, and database schemas.
- `apps/field/test/`: 26 test suites covering offline queues, WatermelonDB SQLite models, hardware adapters (camera/location), and delta sync protocols.
- `apps/web/test/`: 2 test suites covering conveyance components and web rendering.
- `packages/*/test/`: Subsystem unit tests for config, contracts, shared calculations, and test safety gates.

### Fail-Closed Test Database Safety Gate
To prevent accidental test runs from touching staging or production databases, `packages/testing/src/production-gate.ts` enforces `assertTestDatabaseIsSafe`:
- Any connection string pointing to remote hosts (e.g., `rds.amazonaws.com`, `neon.tech`, `supabase.co`) immediately terminates the test runner process.
- Database tests are restricted exclusively to `localhost` / `127.0.0.1` targeting the dedicated test database (`zentra_test`).
- Credential strings are scrubbed to prevent password leakage in console logs.

> [!NOTE]
> Creating this `README.md` is a documentation-only step. No test suites or database operations were executed during this gate.

---

## 9. Database and Synchronization

### Authoritative Database Architecture (`apps/api`)
- **Engine:** PostgreSQL 16+ managed via Kysely query builder.
- **Migrations:** 14 programmatic TypeScript migrations located in `apps/api/src/database/migrations/`:
  - `20261005000001_create_territory_and_schools.ts`
  - `20261005000002_create_equipment_master.ts`
  - `20261005000003_create_complaints_and_service_cases.ts`
  - `20261005000004_create_visits_evidence_and_findings.ts`
  - `20261005000005_create_governance_staging_and_audit.ts`
  - `20261007000001_create_auth_and_rbac.ts`
  - `20261007000002_create_hi_tech_labs_rls.ts`
  - `20261007000003_create_lab_equipment_rls.ts`
  - `20261008000001_create_import_staging_rls.ts`
  - `20261008000002_enhance_service_cases_and_dispatch.ts`
  - `20261008000003_create_sync_and_idempotency.ts`
  - `20261008000004_enhance_field_visits_and_lifecycle.ts`
  - `20261008000005_enhance_evidence_files_and_s3_pipeline.ts`
  - `20261008000006_create_conveyance_and_claims.ts`
- **Security:** Multi-district Row-Level Security (RLS) policies dynamically evaluated based on authenticated session context.

### Delta Synchronization Protocol (`apps/field` & `apps/api`)
- **Granular Row-Level Deltas:** Anti-pattern prohibition against whole-dataset JSON replacements.
- **Deterministic Conflict Resolution:** Domain-owned conflict rules arbitrated by server logic.
- **Idempotency:** Client mutations generate time-ordered UUIDv7 `client_operation_id` keys, checked against server-side `idempotency_keys`.
- **Decoupled Binary Pipeline:** Relational data mutations sync independently of large binary media files (JPEG photos, PDF work orders).

---

## 10. Infrastructure and Deployment

Declarative cloud infrastructure is located in `infra/terraform/staging/`:
- **AWS Provider:** Targets `ap-south-1` (Mumbai).
- **Core Components:**
  - Dedicated VPC with public and private isolated subnets (`vpc.tf`).
  - Multi-AZ Amazon RDS PostgreSQL 16 instance (`rds.tf`).
  - Amazon S3 bucket with lifecycle transition policies for evidence photos (`s3.tf`).
  - Amazon ECS Fargate cluster and task definitions (`ecs.tf`).
  - AWS Secrets Manager integration for cryptographic token secrets (`secrets.tf`).
  - Amazon CloudWatch log groups, metrics, and alarms (`cloudwatch.tf`).

> [!IMPORTANT]
> The creation of this documentation does not trigger any deployment or infrastructure modification. All deployments require explicit operator review.

---

## 11. Security and Repository Hygiene

To safeguard platform integrity, the repository strictly enforces repository hygiene:
- **Never Commit Secrets:** Passwords, API tokens, JWT secrets, private keys, and production credentials must never be committed.
- **Ignored Verification Artifacts:**
  - `*.keystore`: Debug and release keystores are excluded from version control.
  - `artifacts/`: Generated runtime databases, test verification screenshots, and device evidence are strictly ignored.
  - Local environment files (`.env`, `.env.local`) are excluded by root `.gitignore`.
- **Synthetic Fixtures:** Development seed fixtures (`apps/api/src/database/seeds/synthetic-dev-fixtures.ts`) contain zero real school PII or government staff contacts.

---

## 12. Known Implementation Gaps

As of Stage 2-1 architecture discovery, the following gaps are documented:
1. **Web Portal Live API Integration:** `apps/web` currently runs as a standalone prototype using in-memory mock claims and users (`INITIAL_CLAIMS`, `USERS`). It is not yet wired to live `@zentra/api` HTTP endpoints.
2. **Automated CI Workflow:** Although designed in [docs/ZENTRA_CICD_BLUEPRINT.md](docs/ZENTRA_CICD_BLUEPRINT.md), `.github/workflows/ci.yml` is not yet implemented in the repository.
3. **Web Management Surface Scope:** `apps/web` currently focuses on conveyance workflows; service case queues, dispatch management, and school dossiers are planned for future gates.

---

## 13. Architecture and Specifications Reference

Detailed technical specifications are available in the [docs/](docs/) directory:

- [System Architecture Specification](docs/ZENTRA_ARCHITECTURE.md)
- [Mobile Architecture Specification](docs/ZENTRA_MOBILE_ARCHITECTURE.md)
- [Synchronization & Conflict Architecture](docs/ZENTRA_SYNC_ARCHITECTURE.md)
- [Database Implementation & Schema](docs/ZENTRA_DATABASE_IMPLEMENTATION.md)
- [Authentication & Session Architecture](docs/ZENTRA_AUTHENTICATION_ARCHITECTURE.md)
- [RBAC Authorization Matrix](docs/ZENTRA_RBAC_AUTHORIZATION_MATRIX.md)
- [Row-Level Security (RLS) Implementation](docs/ZENTRA_RLS_IMPLEMENTATION.md)
- [Security Architecture & Hardening](docs/ZENTRA_SECURITY_ARCHITECTURE.md)
- [CI/CD & Governance Blueprint](docs/ZENTRA_CICD_BLUEPRINT.md)
- [Testing Strategy & Circuit Breakers](docs/ZENTRA_TESTING_STRATEGY.md)
- [Environment Configuration Strategy](docs/ZENTRA_ENVIRONMENT_STRATEGY.md)

---

## 14. Contribution and Change Safety

When contributing to ZENTRA:
1. Work in small, isolated, independently reviewable gates.
2. Run `pnpm typecheck` and `pnpm lint` before submitting changes.
3. Never bypass the fail-closed test safety gate or commit secrets.
4. Maintain documentation integrity alongside code changes.

---

## 15. Current Project Status

- **Monorepo Baseline Commit:** `9919f04a0429953d59dbc81f63f1f35e7909c6d7`
- **Current HEAD Commit:** `c528b3f4a0bcdf33861bfc2527f8d67d04e665a0`
- **Remote Origin:** `https://github.com/smdshameer/zentra.git` (`master` branch tracking `origin/master`)
- **Stage:** Stage 2 — Core Platform Development & Architecture Validation
- **Tracked Files:** 617 baseline files verified
- **Current Gate:** Gate 2-2 — Foundation Hygiene: Canonical Root README

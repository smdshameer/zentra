# ZENTRA — Project Foundation & Repository Guide

**Document Status:** Complete & Authoritative  
**Phase:** Phase 3 — Project Foundation & Repository Initialization  
**Target Audience:** Engineering, DevOps, Architecture Reviewers  

---

## 1. Executive Overview

This document defines the operational architecture, workspace layout, shared libraries, application boundaries, and developer tooling established during **Phase 3: Project Foundation & Repository Initialization** for **ZENTRA — Hi-Tech Lab Field Service Management Platform**.

Phase 3 establishes an enterprise-grade, clean-slate monorepo designed strictly in alignment with:
- `docs/ZENTRA_PROJECT_REQUIREMENTS.md` (Phase 0)
- `docs/ZENTRA_ARCHITECTURE.md` (Phase 1)
- `docs/ZENTRA_REPOSITORY_ARCHITECTURE.md` (Phase 2)
- `docs/ZENTRA_TECHNOLOGY_FOUNDATION.md` (Phase 2)
- `docs/ZENTRA_ENVIRONMENT_STRATEGY.md` (Phase 2)
- `docs/ZENTRA_TESTING_STRATEGY.md` (Phase 2)

**Critical Architectural Invariant:**  
Phase 3 contains zero domain schema, zero business tables (no users, schools, cases, visits, equipment, or evidence), zero authentication logic, and zero connections to legacy databases (Field Call Tracker, Ai Ticket App) or live production infrastructure.

---

## 2. Monorepo Architecture & Workspace Layout

The repository utilizes **pnpm workspaces** orchestrated by **Turborepo (v2.11.7)** for deterministic caching, dependency deduplication, and topological build execution.

```
d:/Zentra/
├── .editorconfig                # Universal indentation & whitespace rules
├── .env.example                 # Validated environment template (zero real secrets)
├── .eslintrc.json               # Monorepo static analysis & hygiene
├── .gitignore                   # Enterprise gitignore (ignores builds, .env*, data)
├── .prettierignore              # Formatting exclusions (protects docs/**)
├── .prettierrc.json             # Deterministic formatting configuration
├── package.json                 # Monorepo root scripts & dev orchestration
├── pnpm-lock.yaml               # Immutable lockfile (frozen in CI)
├── pnpm-workspace.yaml          # Workspace declarations (apps/*, packages/*)
├── tsconfig.base.json           # Root TypeScript configuration (strict: true)
├── turbo.json                   # Turborepo task pipeline & cache boundaries
│
├── apps/
│   ├── api/                     # Backend API Service (NestJS 11 + Fastify + Kysely)
│   ├── field/                   # Mobile Client (React Native + Expo CNG)
│   └── web/                     # Web Portal (React 18 + Vite + TailwindCSS)
│
├── packages/
│   ├── config/                  # Validated environment & architectural constants
│   ├── contracts/               # Canonical API response envelopes & DTO shapes
│   ├── shared/                  # Common domain utilities (Haversine, IST dates, correlation ID)
│   ├── testing/                 # Test helpers & fail-closed production safety gate
│   ├── tooling/                 # Shared TypeScript configurations
│   ├── types/                   # Core primitive types, branded IDs, and error categories
│   └── validation/              # Zod validation schemas, sanitizers, and masks
│
└── docs/                        # Authoritative project architecture & MUSE SPARK reports
```

### Workspace Configuration (`pnpm-workspace.yaml`)
```yaml
packages:
  - 'apps/*'
  - 'packages/*'

onlyBuiltDependencies:
  - '@nestjs/core'
  - 'esbuild'
```

---

## 3. Shared Packages Layer

The `packages/` layer provides reusable, strictly typed libraries consumed across all three applications. Circular dependencies are forbidden.

### 3.1 `@zentra/tooling`
Provides shared, immutable TypeScript configurations inherited by projects:
- `tsconfig.node.json`: Targets Node.js (ES2022, CommonJS module resolution).
- `tsconfig.react.json`: Targets browser React 18 applications (ESNext, `jsx: react-jsx`).
- `tsconfig.react-native.json`: Targets Expo React Native (`jsx: react-native`).

### 3.2 `@zentra/types`
Defines primitive, branded, and structural types shared across backend and frontends:
- **Branded Types:** `UUIDv7`, `UDISECode`, `ISODateTimeString`.
- **System Enums / Unions:** `AppEnvironment` (`development`, `test`, `staging`, `production`), `ErrorCategory` (`VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `INTERNAL_ERROR`, `SYNC_CONFLICT`, `INTEGRATION_ERROR`).
- **Envelopes:** Generic `ApiResponse<T>`, `ApiErrorEnvelope`, `PaginationMeta`.

### 3.3 `@zentra/validation`
Provides Zod-based validation primitives and sanitization routines:
- **Regex Patterns:** Standard UUID (`UUID_REGEX`), Indian phone numbers (`PHONE_IN_REGEX`), 11-digit UDISE codes (`UDISE_REGEX`).
- **Sanitizers:** `sanitizeString(val)` strips malicious control characters while preserving alphanumeric and punctuation.
- **Privacy Masking:** `maskPhoneNumber(phone)` masks middle digits (e.g., `+91 98*** **321`) for privacy compliance.
- **Base Schemas:** `paginationQuerySchema`, `dateRangeSchema`, `geoCoordinateSchema`.

### 3.4 `@zentra/contracts`
Defines canonical API contract envelopes and future placeholder shapes:
- **`createSuccessResponse<T>(data, meta?)`**: Canonical wrapper returning `{ success: true, data, meta }`.
- **`createErrorResponse(code, message, category, details?)`**: Standardized error envelope.
- **Placeholders:** Contract boundaries established for `EvidenceUploadContract`, `ImportDiffContract`, and `SyncPullBatchContract` (ready for Phase 4+ implementation).

### 3.5 `@zentra/config`
Encapsulates runtime configuration loading and system constants:
- **`envSchema`:** Zod schema validating port numbers, hostnames, log levels, database URLs, and environment names.
- **`loadAppConfig()`:** Validates `process.env` against `envSchema`, throwing informative configuration errors if required variables are missing or malformed.
- **Architectural Constants:**
  - `API_PREFIX`: `/api/v1`
  - `DEFAULT_PAGE_SIZE`: `20`
  - `MAX_PAGE_SIZE`: `100`
  - `EVIDENCE_MAX_FILE_SIZE_BYTES`: `15 * 1024 * 1024` (15 MB)
  - `SLA_CRITICAL_HOURS`: `24`
  - `CORRELATION_ID_HEADER`: `x-correlation-id`

### 3.6 `@zentra/shared`
Shared domain calculation utilities:
- **`haversineDistanceMeters(lat1, lon1, lat2, lon2)`:** Great-circle distance between two GPS coordinates using the Haversine formula (Earth radius 6,371,000 m).
- **`formatUtcToIst(isoDate)`:** Converts UTC ISO timestamps to Indian Standard Time (IST, UTC+5:30) formatted string.
- **`generateCorrelationId()`:** Generates unique tracking IDs for request tracing.

### 3.7 `@zentra/testing`
Testing utilities and safety guards:
- **Fail-Closed Production Safety Gate (`assertTestEnvironmentIsSafe`):**
  A mandatory circuit breaker executed before any test run or database fixture setup. It evaluates `NODE_ENV` and `DATABASE_URL`. If `NODE_ENV === 'production'` or `DATABASE_URL` contains production hostnames (`prod`, `supabase.co`, `neon.tech`), it aborts execution immediately with an uncatchable fatal error.

---

## 4. Application Boundaries

### 4.1 `apps/api` (Backend Service)
- **Framework:** NestJS 11 + Fastify adapter (`@nestjs/platform-fastify`).
- **Global Path Prefix:** `/api/v1`
- **Global Middleware & Filters:**
  - `CorrelationIdInterceptor`: Inspects incoming `x-correlation-id` or generates a UUIDv7 correlation ID, appending it to Fastify response headers and request context.
  - `AllExceptionsFilter`: Formats all uncaught HTTP and runtime exceptions into the canonical `ApiErrorEnvelope` format with timestamp and correlation tracking.
  - `ZodValidationPipe`: Translates Zod parsing issues into structured 400 Bad Request responses.
- **Modules Implemented:**
  - `HealthModule`: Exposes `/health/liveness` (`{ status: "ok" }`) and `/health/readiness` (`{ status: "ok", services: ... }`).
  - `DatabaseModule`: Abstraction over Kysely and Postgres connection pool (`DatabaseConnection`), including a placeholder `MigrationRunner` designed for zero-downtime transactional schema management in Phase 4.

### 4.2 `apps/web` (Management Portal)
- **Framework:** React 18 + Vite 5 + TypeScript.
- **Styling:** TailwindCSS 3 with Zentra theme tokens (`zentra-primary: #0F172A`, `zentra-accent: #0284C7`, `zentra-surface: #F8FAFC`).
- **Resilience:** Top-level `ErrorBoundary` catching unhandled UI exceptions and rendering an accessible fallback card with diagnostic error details.
- **Status Shell:** Displays current runtime configuration, API prefix, and shared utility outputs.

### 4.3 `apps/field` (Mobile Client)
- **Framework:** React Native 0.76 + Expo SDK 52 (Continuous Native Generation - CNG).
- **App Identity:**
  - Name: `ZENTRA Field`
  - Slug: `zentra-field`
  - Bundle Identifier: `com.zentra.field.dev`
- **Resilience:** Root `ErrorBoundary` component with error logging and manual reload actions.
- **Startup Shell:** Displays application version, platform identifier, and verified utility imports.

---

## 5. TypeScript Configuration & Standards

The codebase enforces strict type safety without compromises:
- `strict: true`: Enabled across all packages and apps.
- `noImplicitAny: true`: Forbidden implicit any.
- `strictNullChecks: true`: Explicit null and undefined handling required.
- `noUnusedLocals: true` & `noUnusedParameters: true`: Clean code hygiene.
- `composite: true` & `declaration: true`: Incremental compilation and type declaration generation for monorepo packages.

---

## 6. Code Quality & Formatting

- **Prettier:** Enforces 2-space indentation, single quotes, trailing commas, and 100-character line lengths.
- **ESLint:** Configured at monorepo root to lint TypeScript source trees.
- **Protected Paths:** `.prettierignore` excludes `docs/**` to ensure authoritative architecture documents and MUSE SPARK reports remain untouched during automated formatting runs.

---

## 7. Testing Infrastructure

Unit and smoke testing are powered by **Vitest 2.1.9** integrated into Turborepo:

| Target Package / App | Test File | Tests Run | Result | Focus Area |
| :--- | :--- | :---: | :---: | :--- |
| `packages/shared` | `test/shared.spec.ts` | 5 | PASS | Haversine formula, IST formatter, correlation ID |
| `packages/config` | `test/config.spec.ts` | 3 | PASS | Schema validation, default fallback values, invalid values |
| `packages/contracts` | `test/contracts.spec.ts` | 3 | PASS | Success envelopes, error envelopes, pagination metadata |
| `packages/testing` | `test/production-gate.spec.ts` | 4 | PASS | Fail-closed circuit breaker against production credentials |
| `apps/field` | `test/field.spec.ts` | 3 | PASS | App shell sanity, contract consumption, config resolution |
| `apps/web` | `test/web.spec.ts` | 1 | PASS | Web shell initialization & shared package consumption |
| `apps/api` | `test/api.spec.ts` | 3 | PASS | NestJS DI compilation, liveness & readiness HTTP checks |
| **Total** | **7 test files** | **22 tests** | **100% PASS** | **Phase 3 Smoke & Unit Foundation** |

---

## 8. Development & Build Commands

All commands are executed from the repository root (`d:\Zentra`):

```bash
# Install dependencies according to lockfile
pnpm install --frozen-lockfile

# Run complete build pipeline across all packages and apps
pnpm run build

# Run type-checking across all 10 projects
pnpm run typecheck

# Execute unit and smoke test suite
pnpm run test

# Run ESLint across packages and applications
pnpm run lint

# Check formatting compliance with Prettier
pnpm run format

# Automatically format all source files (excluding docs)
pnpm run format:fix
```

---

## 9. Phase 4 Boundary & Governance Rules

The following strict boundaries must be preserved during transition to Phase 4:
1. **No Domain Schema in Phase 3:** All database tables (`users`, `schools`, `complaints`, `service_cases`, `visits`, `equipment`, etc.) belong to Phase 4.
2. **No Authentication in Phase 3:** JWT, session handling, password hashing, and RLS policies are scheduled for Phase 4.
3. **No External Connections:** No database instances (local Docker, Supabase, Neon) or cloud storage buckets should be provisioned or connected during Phase 3.
4. **Complete Isolation from Legacy:** Zero code or data from `Field Call Tracker` or `Ai Ticket App` may ever be imported into `ZENTRA`.

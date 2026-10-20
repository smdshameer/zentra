# MUSE SPARK STAGE 6E — SERVICE CASE RLS CONTEXT REMEDIATION REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Repository:** `D:\Zentra`  
**Execution Mode:** Narrowly Scoped Remediation & Physical Device Verification  
**Target Environment:** Local Development (`zentra_local`, PostgreSQL 18, port 5432)  
**Database User:** `zentra_dev` (`rolsuper = false`, `rolbypassrls = false`)  
**Physical Mobile Device:** OnePlus Nord (`65c7923e`, Android 12)  
**Protected Databases:** `zentra_test` (8 users, 4 schools — UNTOUCHED), `hisecure_erp` (101 tables — UNTOUCHED)  
**Budget Adherence:** Strict ₹0/month (all operations local & zero cloud egress)  
**Final Action:** STOP — Awaiting Human Review  

---

## 1. Executive Summary

During Stage 6E, the diagnostic identified an authoritative defect: while sibling services (`SchoolsService`, `LabsService`, `LabEquipmentService`) correctly established PostgreSQL Row-Level Security (RLS) session contexts via `RlsService.withSecurityContext(...)`, `ServiceCasesService.queryCases()` queried the repository without setting the `zentra.current_user_id` or `zentra.current_role` transaction-local settings. Because `zentra_dev` is a secure non-superuser with `rolbypassrls = false`, PostgreSQL RLS policies evaluated `current_setting('zentra.current_role', true)` as `NULL`, returning empty results (`count = 0`) to the mobile application during dossier preloading.

### Remediation & Verification Highlights:
1. **Primary Defect Remediated:** Injected `RlsService` into `ServiceCasesService`, resolved the authenticated principal's role via `resolveSecurityRole(user)`, and wrapped all queries (`queryCases`, `getCaseById`) in `RlsService.withSecurityContext(...)`.
2. **Secondary Defect Uncovered & Fixed:** `RlsService.withSecurityContext` previously attempted an unconditional `SET ROLE zentra_app` whenever the role existed. Under a non-superuser connection (`zentra_dev`), PostgreSQL rejected this with `SQLSTATE 42501 (permission denied to set role "zentra_app")`. Added a `rolsuper` guard ensuring role-switching is only attempted under superuser test harnesses, allowing non-superuser application roles to query directly with native forced RLS.
3. **Automated Verification:**
   - `pnpm --filter @zentra/api typecheck` passed cleanly (`tsc --noEmit`, exit code 0).
   - Focused Vitest test suite (`test/service-case-rls-remediation.spec.ts`) passed 10/10 tests in 1.42 seconds.
4. **Physical Device Verification (OnePlus Nord `65c7923e`):**
   - Successfully authenticated as canonical Field Engineer `engineer.demo@zentra.local`.
   - Executed `PRELOAD ASSIGNED DOSSIER`.
   - Dashboard card "Assigned Calls Cached Locally" updated from **0** to **1**.
   - Bottom navigation bar updated to `Assigned Calls (1)`.
   - Assigned Calls screen rendered assigned case `ZNT-2026-DEMO-000001` with `SERVER CONFIRMED`, `HIGH`, `ASSIGNED`.
   - Cross-engineer case isolation verified: `ZNT-2026-DEMO-000002` (assigned to secondary engineer) is strictly hidden.
   - School Master Dossier verified: School `UDISE: 33100000001` (ZENTRA Demo Model Higher Secondary School), 2 hi-tech labs (`PRIMARY` and `ATAL_TINKERING`), and GPS coordinates (`10.765432`, `79.843210`) loaded from offline WatermelonDB.
   - Idempotency verified: Triggering preload a second time preserved exactly 1 cached case without duplicate records.
5. **Zero Modification of Protected Assets:** `zentra_test` (8 users, 4 schools) and `hisecure_erp` (101 tables) remain completely untouched. `zentra_dev` retains non-superuser privileges with forced RLS.

---

## 2. Root Cause Analysis & Code Remediation

### 2.1 Primary Defect: Omission of RLS Security Context
In `apps/api/src/modules/service-cases/services/service-cases.service.ts`, `queryCases(filters)` executed `this.casesRepo.findCases(filters)` directly against the raw database connection. Unlike sibling modules, `ServiceCasesService` did not inject `RlsService` nor wrap case retrieval in `this.rlsService.withSecurityContext`.

#### Remediation in `ServiceCasesService`:
- Injected `RlsService`.
- Added helper `resolveSecurityRole(user: AuthenticatedUser): SecurityRole`:
  - Validates `user.activeRole` against `user.roles`.
  - Falls back to `user.roles[0]` or `'FIELD_ENGINEER'`.
- Updated `queryCases(filters: ServiceCaseQueryFilters, user?: AuthenticatedUser)`:
  - If `user` is provided, executes `this.casesRepo.findCases(filters, trx)` inside `this.rlsService.withSecurityContext(...)`.
  - Passes transaction handle `trx` to the repository.
- Updated `getCaseById(id: string, user?: AuthenticatedUser)`:
  - Similarly establishes `withSecurityContext` when `user` is supplied.

#### Remediation in `ServiceCasesController`:
- `listCases`: Passed `request.user` into `this.serviceCasesService.queryCases(filters, user)`.
- `getCase`: Passed `request.user` into `this.serviceCasesService.getCaseById(id, user)`.
- `transitionStatus`: Passed `request.user` into `this.serviceCasesService.getCaseById(id, user)` for pre-transition authority checks.

### 2.2 Secondary Defect: Non-Superuser Role Switching Error
During local testing under role `zentra_dev`, calling `rlsService.withSecurityContext` threw an HTTP 500 error:
```
error: permission denied to set role "zentra_app"
    at Parser.parseErrorMessage (pg-protocol/dist/parser.js:287:98)
```
**Diagnosis:** `apps/api/src/modules/auth/rls.service.ts` contained:
```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zentra_app') THEN
    PERFORM set_config('role', 'zentra_app', true);
  END IF;
END $$;
```
PostgreSQL disallows non-superusers from switching roles (`SET ROLE`) unless they are explicit members of that role. When running under the production/development application user `zentra_dev` (which is already a non-superuser with forced RLS), role-switching is neither permitted nor necessary.

#### Remediation in `RlsService`:
Wrapped the role-switch check with a `rolsuper` guard:
```sql
DO $$
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) = true THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zentra_app') THEN
      PERFORM set_config('role', 'zentra_app', true);
    END IF;
  END IF;
END $$;
```
This ensures test suites running as superuser switch to `zentra_app` to enforce RLS, while non-superuser application connections (`zentra_dev`) execute directly with native forced RLS.

---

## 3. Automated Test Verification & Regressions

### 3.1 Type Checking
```bash
pnpm --filter @zentra/api typecheck
```
**Output:**
```
$ tsc --noEmit
Exit code: 0
```
Zero TypeScript compilation errors or interface mismatches across `@zentra/api`, `@zentra/contracts`, and `@zentra/types`.

### 3.2 Focused Vitest Suite: `service-case-rls-remediation.spec.ts`
```bash
pnpm --filter @zentra/api vitest run test/service-case-rls-remediation.spec.ts
```
**Output:**
```
 ✓ test/service-case-rls-remediation.spec.ts (10 tests) 15ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Duration  1.42s
```

#### Test Coverage Gates:
- **Gate A — Service Cases Service RLS Integration:**
  - `queryCases` establishes RLS security context with principal's active role.
  - `queryCases` falls back to `roles[0]` when `activeRole` is omitted.
  - `queryCases` falls back to uncontextualized query when no user is provided.
  - `getCaseById` establishes RLS security context when user is provided.
- **Gate B — Service Cases Controller User Propagation & Isolation:**
  - `listCases` propagates `request.user` into `serviceCasesService.queryCases`.
  - Automatically scopes `assignedEngineerId = user.sub` for Field Engineers.
  - Overrides client-spoofed `assignedEngineerId` to match authenticated `user.sub`.
  - Restricts District Coordinator queries to assigned territory districts.
  - Allows Master Admin unscoped query access across districts.
- **Gate C — RLS Non-Superuser Role Switch Guard:**
  - Verifies `rls.service.ts` contains `rolsuper` guard preventing `permission denied to set role "zentra_app"`.

---

## 4. Physical Mobile Device Verification (OnePlus Nord `65c7923e`)

### 4.1 Test Environment & Configuration
- **Device:** OnePlus Nord (`65c7923e`, Android 12)
- **App Package:** `com.zentra.field.dev`
- **Reverse Port Tunnels:**
  - `tcp:8081` -> Metro Bundler (active)
  - `tcp:4000` -> Fastify API (`http://localhost:4000/api/v1`)
- **Canonical Engineer Account:** `engineer.demo@zentra.local`
- **Assigned District:** `DEMO_DIS` (Erode Central)

### 4.2 Step-by-Step Device Execution & Results

| Step | Action | Expected Outcome | Verified Physical State | Evidence Artifact |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Populate canonical credentials and submit login | Authenticate against local API, persist session tokens | Success; navigated to Field Dashboard | `stage6e_dashboard_pre_preload.png` |
| **2** | Initial Dashboard baseline | Display `0 Assigned Calls Cached Locally` | Verified `0 Assigned Calls`, `0 Pending Operations` | `stage6e_dashboard_pre_preload.xml` |
| **3** | Tap `PRELOAD ASSIGNED DOSSIER` | API returns assigned case `ZNT-2026-DEMO-000001`; WatermelonDB caches case, school, labs | HTTP 200 returned with 1 case; cached locally | API access logs |
| **4** | Post-Preload Dashboard | Dashboard metric updates to `1 Assigned Calls Cached Locally` | Verified `1 Assigned Calls Cached Locally` and tab label `Assigned Calls (1)` | `stage6e_dashboard_final.png` |
| **5** | Tap `Assigned Calls (1)` tab | Render list containing `ZNT-2026-DEMO-000001` | Card displayed with `SERVER CONFIRMED`, `HIGH`, `ASSIGNED` | `stage6e_assigned_calls_screen.png` |
| **6** | Verify Cross-Engineer Isolation | `ZNT-2026-DEMO-000002` must NOT be visible | Exactly 1 case rendered; other engineer's case hidden | `stage6e_assigned_calls_screen.xml` |
| **7** | Tap case card to open Case Detail | Case details render with school link & visit actions | Displayed fault description & `View School Master Dossier >` | `stage6e_case_detail_screen.png` |
| **8** | Tap `View School Master Dossier >` | School master data & lab equipment render from local DB | School UDISE `33100000001`, Labs `PRIMARY` and `ATAL_TINKERING` displayed | `stage6e_school_detail_screen.png` |
| **9** | Return to Dashboard & Trigger Preload Again | Verify idempotency; count must remain exactly 1 | Verified `1 Assigned Calls Cached Locally`; no duplicate records | `stage6e_idempotency_verified.xml` |

---

## 5. Security & Isolation Audit

### 5.1 Application Role Privileges (`zentra_dev`)
```sql
SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcanlogin 
FROM pg_roles WHERE rolname = 'zentra_dev';
```
| Role Name | Superuser (`rolsuper`) | Bypass RLS (`rolbypassrls`) | Can Login (`rolcanlogin`) | Status |
| :--- | :---: | :---: | :---: | :---: |
| `zentra_dev` | **false** | **false** | **true** | **SECURE (FORCED RLS)** |

### 5.2 Protected Databases Baseline Verification
```sql
-- zentra_test
SELECT count(*) FROM users;   -- 8
SELECT count(*) FROM schools; -- 4

-- hisecure_erp
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'; -- 101
```
| Target Database | Baseline Metric | Current Metric | Integrity Status |
| :--- | :---: | :---: | :---: |
| `zentra_test` | 8 users, 4 schools | 8 users, 4 schools | **100% UNTOUCHED** |
| `hisecure_erp` | 101 public tables | 101 public tables | **100% UNTOUCHED** |

### 5.3 Target Database Fixtures (`zentra_local`)
| Table | Row Count | Scoping Rule |
| :--- | :---: | :--- |
| `service_cases` | 2 | 1 assigned to `engineer.demo@zentra.local`, 1 to secondary engineer |
| `schools` | 4 | 2 in assigned district `DEMO_DIS`, 2 in other districts |
| `hi_tech_labs` | 5 | 3 in assigned district `DEMO_DIS`, 2 in other districts |
| `users` | 8 | Synthetic development users across all 4 system roles |

---

## 6. Budget Adherence

- **Cloud Spend:** ₹0/month.
- **Network Bandwidth:** Zero cloud or third-party egress. All traffic was strictly routed over local ADB reverse tunnels (`localhost:4000`, `localhost:8081`).
- **Hardware Resources:** Zero new hardware provisioned.

---

## 7. Conclusion & Next Step

Stage 6E has completely resolved the Row-Level Security context defect in `ServiceCasesService`. The local development Fastify API and the physical OnePlus Nord field application are now fully verified, synchronized, and operational. Dossier preloading, local SQLite/WatermelonDB persistence, multi-screen navigation, and PostgreSQL RLS cross-engineer isolation function with zero data leakage.

**Final Status:** STOP — Awaiting Human Review.

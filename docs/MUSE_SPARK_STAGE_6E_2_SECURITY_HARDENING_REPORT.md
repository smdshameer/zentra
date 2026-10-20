# MUSE SPARK STAGE 6E.2 — SECURITY HARDENING REPORT

**Project:** ZENTRA — Hi-Tech Lab Field Service Management Platform  
**Repository:** `D:\Zentra`  
**Work Package:** Stage 6E.2 Security Hardening (Findings 1, 2, and 3 Remediation)  
**Execution Date:** 2026-10-14  
**Target Environment:** Local Development (`zentra_local`, PostgreSQL 18, port 5432)  
**Application DB Role:** `zentra_dev` (`rolsuper = false`, `rolbypassrls = false`, `rolcanlogin = true`)  
**Protected Databases:** `zentra_test` (8 users, 4 schools — UNTOUCHED), `hisecure_erp` (101 tables — UNTOUCHED)  
**Physical Test Device:** OnePlus Nord (`65c7923e`, Android 12)  
**Deliverable File:** `D:\Zentra\docs\MUSE_SPARK_STAGE_6E_2_SECURITY_HARDENING_REPORT.md`  
**Overall Verdict:** **PASS**  
**Final Action:** **STOP — Awaiting Human Review**

---

## 1. Executive Summary & Final Verdict

During the Stage 6E.1 RLS Security Sign-off audit ([`docs/MUSE_SPARK_STAGE_6E_1_RLS_SECURITY_SIGNOFF.md`](file:///d:/Zentra/docs/MUSE_SPARK_STAGE_6E_1_RLS_SECURITY_SIGNOFF.md)), three specific defense-in-depth findings were identified that yielded a **CONDITIONAL PASS** verdict:
1. **Finding 1:** An implicit `FIELD_ENGINEER` fallback in [`ServiceCasesService.resolveSecurityRole()`](file:///d:/Zentra/apps/api/src/modules/service-cases/services/service-cases.service.ts#L293) when a principal's roles were empty or invalid.
2. **Finding 2:** Missing `request.user` propagation in [`SlaController.calculateSla()`](file:///d:/Zentra/apps/api/src/modules/service-cases/controllers/sla.controller.ts#L64), preventing PostgreSQL Row-Level Security context from being established.
3. **Finding 3:** Direct repository querying in [`DispatchController.getAssignmentHistory()`](file:///d:/Zentra/apps/api/src/modules/service-cases/controllers/dispatch.controller.ts#L121) and [`ServiceCasesService.getAssignmentHistory()`](file:///d:/Zentra/apps/api/src/modules/service-cases/services/service-cases.service.ts#L422) without `RlsService.withSecurityContext`, causing forced RLS policies on `assignment_history` to fail closed.

All three findings have been remediated in strict accordance with the prompt specification:
- **Finding 1 Remediated:** Fail-closed role resolution implemented; missing, empty, or invalid roles throw `ForbiddenException`; `activeRole` mismatch or unrecognized roles reject fail-closed.
- **Finding 2 Remediated:** `request.user` propagated into `ServiceCasesService.getCaseById(caseId, request.user)`; dynamic SLA calculation executes inside transaction-local RLS security context; foreign/unauthorized cases fail closed with `NotFoundException`.
- **Finding 3 Remediated:** `request.user` propagated through `DispatchController` into `ServiceCasesService.getAssignmentHistory(caseId, request.user)`; query executes inside `rlsService.withSecurityContext` and receives the transaction handle `trx`; forced database policy `assignment_history_territory_isolation` is satisfied.

### Verification Summary
| Verification Gate | Result | Evidence / Metric |
| :--- | :---: | :--- |
| **TypeScript Compilation** | **PASS** | `pnpm --filter @zentra/api typecheck` exited with code 0 (`tsc --noEmit`). |
| **Focused Unit & Contract Suite** | **PASS** | `vitest run test/service-case-rls-remediation.spec.ts` exited with code 0 (23 passed, 0 failed, 48ms). |
| **Full Repository Test Suite** | **PASS** | `pnpm --filter @zentra/api test` exited with code 0 (20 test files, 408 tests passed, 0 failed, 89.96s). |
| **Live Database & REST API Verification** | **PASS** | Real HTTP requests against live Fastify API (port 4000) backed by `zentra_local` under non-privileged role `zentra_dev`: assigned case SLA (200 OK), foreign case SLA (404 Not Found), assignment history under RLS (200 OK), empty roles (403 Forbidden). |
| **Database Isolation Safeguards** | **PASS** | `zentra_test` (8 users, 4 schools) and `hisecure_erp` (101 tables) verified 100% untouched. |
| **Privilege Integrity** | **PASS** | `zentra_dev` confirmed non-superuser (`rolsuper = false`, `rolbypassrls = false`). |
| **Physical Test Device State** | **PASS** | OnePlus Nord (`65c7923e`) connected; ADB reverse `tcp:8081` and `tcp:4000` active; mobile app running on Dashboard in authenticated state. |

**Overall Work Package Verdict: PASS**

---

## 2. Files Changed and Root Cause Analysis

### Finding 1: Fail-Closed Role Resolution
- **Target File:** [`apps/api/src/modules/service-cases/services/service-cases.service.ts`](file:///d:/Zentra/apps/api/src/modules/service-cases/services/service-cases.service.ts)
- **Root Cause:**
  Previously, `resolveSecurityRole(user: AccessTokenClaims)` was implemented as:
  ```typescript
  private resolveSecurityRole(user: AccessTokenClaims): string {
    if (user.activeRole && user.roles.includes(user.activeRole)) {
      return user.activeRole;
    }
    return user.roles[0] || 'FIELD_ENGINEER';
  }
  ```
  If `user.roles` was empty, malformed, or contained unrecognized values, the method silently defaulted to `'FIELD_ENGINEER'`, potentially granting field engineer RLS visibility to a broken or unauthorized identity claim. Furthermore, if `activeRole` was present but invalid or not in `roles`, it silently fell back rather than failing closed.
- **Remediation Implemented:**
  1. Imported `ForbiddenException` from `@nestjs/common` and `UserRole` from `@zentra/types`.
  2. Defined the canonical recognized application roles set and validation guard:
     ```typescript
     const RECOGNIZED_ROLES = new Set<string>([
       'MASTER_ADMIN',
       'REPORTING_HEAD',
       'DISTRICT_COORDINATOR',
       'FIELD_ENGINEER',
       'AI',
       'HM',
     ]);

     function isRecognizedRole(role: unknown): role is UserRole {
       return typeof role === 'string' && RECOGNIZED_ROLES.has(role);
     }
     ```
  3. Replaced `resolveSecurityRole()` with fail-closed validation:
     ```typescript
     private resolveSecurityRole(user: AccessTokenClaims): string {
       if (!user || !user.roles || !Array.isArray(user.roles) || user.roles.length === 0) {
         throw new ForbiddenException('Forbidden resource: principal has no assigned security roles');
       }

       if (user.activeRole) {
         if (!isRecognizedRole(user.activeRole)) {
           throw new ForbiddenException(`Forbidden resource: invalid active role '${user.activeRole}'`);
         }
         if (!user.roles.includes(user.activeRole)) {
           throw new ForbiddenException(`Forbidden resource: active role '${user.activeRole}' is not an authorized role`);
         }
         return user.activeRole;
       }

       const candidateRole = user.roles[0];
       if (!candidateRole || !isRecognizedRole(candidateRole)) {
         throw new ForbiddenException(`Forbidden resource: invalid role '${candidateRole}'`);
       }

       return candidateRole;
     }
     ```

---

### Finding 2: SLA Case RLS Context
- **Target File:** [`apps/api/src/modules/service-cases/controllers/sla.controller.ts`](file:///d:/Zentra/apps/api/src/modules/service-cases/controllers/sla.controller.ts)
- **Root Cause:**
  In `SlaController.calculateSla()`:
  ```typescript
  @Get('calculate/:caseId')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async calculateSla(
    @Param('caseId') caseId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<unknown>> {
    const serviceCase = await this.serviceCasesService.getCaseById(caseId);
    ...
  ```
  `getCaseById(caseId)` was invoked without the second argument (`user?: AccessTokenClaims`). Consequently, `getCaseById` did not call `rlsService.withSecurityContext()`. Under the production-like `zentra_dev` role (which has forced RLS enabled), queries to `service_cases` without `zentra.current_user_id` and `zentra.current_role` evaluate to false under `service_cases_territory_isolation`, causing `findById` to return `null` and the endpoint to throw `404 Not Found` even for the assigned engineer. In non-forced test environments, this left dynamic SLA metrics accessible across territory boundaries.
- **Remediation Implemented:**
  Updated line 68 to pass `request.user`:
  ```typescript
  const serviceCase = await this.serviceCasesService.getCaseById(caseId, request.user);
  ```
  This immediately establishes the transaction-local RLS security context (`userId`, `role`), ensuring:
  1. Assigned engineers can calculate SLA for their cases.
  2. Foreign/unassigned cases are hidden by PostgreSQL RLS (`findById` returns `null` -> `NotFoundException`).
  3. Principals with empty or invalid roles are rejected fail-closed with `ForbiddenException`.
  4. Response envelope, deadline metrics, and breach status calculation remain 100% intact.

---

### Finding 3: Assignment History RLS Context
- **Target Files:**
  - [`apps/api/src/modules/service-cases/controllers/dispatch.controller.ts`](file:///d:/Zentra/apps/api/src/modules/service-cases/controllers/dispatch.controller.ts)
  - [`apps/api/src/modules/service-cases/services/service-cases.service.ts`](file:///d:/Zentra/apps/api/src/modules/service-cases/services/service-cases.service.ts)
- **Root Cause:**
  In `DispatchController.getAssignmentHistory()`:
  ```typescript
  @Get(':caseId/history')
  @Roles('MASTER_ADMIN', 'REPORTING_HEAD', 'DISTRICT_COORDINATOR', 'FIELD_ENGINEER')
  async getAssignmentHistory(
    @Param('caseId') caseId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<AssignmentHistoryEntry[]>> {
    const history = await this.serviceCasesService.getAssignmentHistory(caseId);
  ```
  And in `ServiceCasesService.getAssignmentHistory()`:
  ```typescript
  async getAssignmentHistory(serviceCaseId: string) {
    return await this.assignmentHistoryRepo.findByCaseId(serviceCaseId);
  }
  ```
  The assignment history ledger table `assignment_history` is protected by PostgreSQL forced Row-Level Security policy `assignment_history_territory_isolation` (migration `20261008000002_enhance_service_cases_and_dispatch.ts`):
  ```sql
  CREATE POLICY assignment_history_territory_isolation ON assignment_history
  FOR ALL
  USING (
    NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
    OR assignment_history.engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM service_cases sc
      JOIN schools s ON s.school_id = sc.school_id
      JOIN user_territory_assignments uta ON uta.district_id = s.district_id
      WHERE sc.service_case_id = assignment_history.service_case_id
        AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
        AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
        AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
    )
  );
  ```
  Because `getAssignmentHistory()` ran outside `withSecurityContext`, session variables `zentra.current_role` and `zentra.current_user_id` were unset. Under `zentra_dev`, this policy evaluated to `false`, returning an empty list (`[]`) to all callers, including authorized coordinators and assigned engineers.
- **Remediation Implemented:**
  1. In `apps/api/src/modules/service-cases/services/service-cases.service.ts`:
     Updated `getAssignmentHistory` signature and implementation to establish RLS context and pass `trx` to the repository:
     ```typescript
     /**
      * Retrieve assignment history for a case with RLS context
      */
     async getAssignmentHistory(
       serviceCaseId: string,
       user?: AccessTokenClaims,
     ): Promise<AssignmentHistoryEntry[]> {
       const executeGet = (trx?: Transaction<DatabaseSchema>) =>
         this.assignmentHistoryRepo.findByCaseId(serviceCaseId, trx);

       if (user) {
         return await this.rlsService.withSecurityContext(
           {
             userId: user.sub,
             role: this.resolveSecurityRole(user),
           },
           async (trx) => executeGet(trx),
         );
       }

       return await executeGet();
     }
     ```
  2. In `apps/api/src/modules/service-cases/controllers/dispatch.controller.ts`:
     Propagated `request.user` into `getAssignmentHistory`:
     ```typescript
     const history = await this.serviceCasesService.getAssignmentHistory(caseId, request.user);
     ```

---

## 3. Test Suites, Executions, and Exit Codes

### A. TypeScript Typecheck
- **Command:** `pnpm --filter @zentra/api typecheck`
- **Output:**
  ```text
  $ tsc --noEmit
  ```
- **Exit Code:** `0`
- **Verification:** Clean compilation across all controllers, services, repositories, and test files.

---

### B. Focused RLS Security Remediation Test Suite
- **File:** [`apps/api/test/service-case-rls-remediation.spec.ts`](file:///d:/Zentra/apps/api/test/service-case-rls-remediation.spec.ts)
- **Command:** `pnpm --filter @zentra/api exec vitest run test/service-case-rls-remediation.spec.ts`
- **Output:**
  ```text
  RUN  v2.1.9 D:/Zentra/apps/api

  ✓ test/service-case-rls-remediation.spec.ts (23 tests) 48ms

  Test Files  1 passed (1)
       Tests  23 passed (23)
    Duration  2.82s
  ```
- **Exit Code:** `0`
- **Gate-by-Gate Coverage in Test Suite:**
  - **Gate A (queryCases RLS & Role Resolution - Finding 1):**
    - Executes repository query inside `RlsService.withSecurityContext` with authenticated claims.
    - Falls back to non-transactional query when user is not provided.
    - Resolves `activeRole` correctly when present and included in user roles.
    - Resolves `roles[0]` when `activeRole` is undefined.
    - Rejects with `ForbiddenException` when principal has empty roles array.
    - Rejects with `ForbiddenException` when principal has invalid or unrecognized roles.
    - Rejects with `ForbiddenException` when `activeRole` is not a recognized role.
    - Rejects with `ForbiddenException` when `activeRole` is not among principal authorized roles (privilege escalation prevention).
    - Rejects with `ForbiddenException` when principal claims have missing or non-array roles.
  - **Gate B (Cross-Engineer Scoping & Controller Enforcement):**
    - Forces `assignedEngineerId` to authenticated user ID for `FIELD_ENGINEER` role.
    - Prohibits Field Engineer from querying case assigned to another engineer via `getCase` (403).
    - Allows Master Admin to query cases statewide without engineer override.
    - Prohibits District Coordinator from querying outside assigned territory (403).
  - **Gate C (getCaseById RLS Integration):**
    - Executes `findById` and relation queries inside RLS transaction when user provided.
    - Throws `NotFoundException` when case does not exist or is filtered by RLS.
  - **Gate D (SlaController.calculateSla RLS Context - Finding 2):**
    - Passes authenticated principal `request.user` into `ServiceCasesService.getCaseById()` and executes under RLS.
    - Rejects when case does not exist or is filtered out by RLS (fails closed with `NotFoundException`).
    - Rejects SLA calculation with `ForbiddenException` when principal has empty roles.
  - **Gate E (DispatchController.getAssignmentHistory RLS Context - Finding 3):**
    - Passes `request.user` to `getAssignmentHistory` and executes query inside `RlsService.withSecurityContext` with transaction handle `trx`.
    - Allows District Coordinator to query assignment history within security context.
    - Allows Master Admin to query assignment history statewide within security context.
    - Rejects assignment history query with `ForbiddenException` when principal has empty roles.
    - Falls back to non-transactional query when user is omitted (service backward compatibility).

---

### C. Full API Regression Test Suite
- **Command:** `pnpm --filter @zentra/api test`
- **Exit Code:** `0`
- **Summary:**
  ```text
  Test Files  20 passed (20)
       Tests  408 passed (408)
    Duration  89.96s
  ```
- **Breakdown of Passing Test Files:**
  1. `test/import-staging-domain.spec.ts` (21 tests) — PASS
  2. `test/conveyance-domain.spec.ts` (36 tests) — PASS
  3. `test/equipment-domain.spec.ts` (49 tests) — PASS
  4. `test/service-case-lifecycle.spec.ts` (25 tests) — PASS
  5. `test/evidence-domain.spec.ts` (22 tests) — PASS
  6. `test/database-schema.spec.ts` (19 tests) — PASS
  7. `test/visits-domain.spec.ts` (21 tests) — PASS
  8. `test/auth-security.spec.ts` (38 tests) — PASS
  9. `test/phase16-e2e-rehearsal.spec.ts` (24 tests) — PASS
  10. `test/school-lab-domain.spec.ts` (30 tests) — PASS
  11. `test/phase16-security-hardening.spec.ts` (23 tests) — PASS
  12. `test/sync-engine.spec.ts` (13 tests) — PASS
  13. `test/service-case-rls-remediation.spec.ts` (23 tests) — PASS
  14. `test/phase16-failure-recovery.spec.ts` (9 tests) — PASS
  15. `test/security-hardening-step2b.spec.ts` (14 tests) — PASS
  16. `test/phase16-database-integrity.spec.ts` (12 tests) — PASS
  17. `test/visit-boundaries.spec.ts` (9 tests) — PASS
  18. `test/conveyance-boundaries.spec.ts` (10 tests) — PASS
  19. `test/evidence-boundaries.spec.ts` (7 tests) — PASS
  20. `test/api.spec.ts` (3 tests) — PASS

---

## 4. Live Database & REST API Verification Under `zentra_dev`

To ensure verification extends beyond mocked unit tests to the actual PostgreSQL 18 Row-Level Security engine, real HTTP requests were executed against the active development server (`http://localhost:4000/api/v1`) running on database `zentra_local` under non-privileged role `zentra_dev` (`rolsuper = false`, `rolbypassrls = false`).

### Live Test Script: `scratch/test-live-security.ts`
- **Execution Command:** `pnpm --filter @zentra/api exec tsx scratch/test-live-security.ts`
- **Exit Code:** `0`

### Real Database Assertions & Results:
1. **Live SLA Calculation on Assigned Case (Assigned Engineer):**
   - **Request:** `GET /api/v1/sla/calculate/01a126f6-7d9a-7dfa-96bb-d6f4a07fe540`
   - **Auth:** Bearer JWT for `engineer.demo@zentra.local` (Sub: `01a126f6-7d9a-74a4-bb2d-b86181cadb93`, Role: `FIELD_ENGINEER`).
   - **Result:** `200 OK`
   - **Data Verified:** `success = true`, `zentraCaseCode = ZNT-2026-DEMO-000001`, `operationalStatus = ASSIGNED`, dynamic `slaEvaluation` populated.
2. **Live SLA Calculation on Foreign/Unassigned Case (RLS Enforcement):**
   - **Request:** `GET /api/v1/sla/calculate/01a126f6-7d9a-7736-ac3a-bc7e10182adb` (Case 2: unassigned, outside engineer scope).
   - **Auth:** Bearer JWT for `engineer.demo@zentra.local`.
   - **Result:** `404 Not Found`
   - **Security Mechanism Verified:** PostgreSQL RLS policy `service_cases_territory_isolation` filtered out Case 2 because `assigned_primary_engineer_id != current_setting('zentra.current_user_id', true)::uuid`. `findById` returned `null`, failing closed with `NotFoundException`. Zero data leakage across cases.
3. **Live Assignment History Retrieval Under RLS:**
   - **Request:** `GET /api/v1/dispatch/01a126f6-7d9a-7dfa-96bb-d6f4a07fe540/history`
   - **Auth:** Bearer JWT for `engineer.demo@zentra.local`.
   - **Result:** `200 OK`
   - **Security Mechanism Verified:** Executed inside `RlsService.withSecurityContext`, setting `zentra.current_role = 'FIELD_ENGINEER'` and `zentra.current_user_id`. Forced policy `assignment_history_territory_isolation` evaluated cleanly without PostgreSQL privilege errors.
4. **Live Empty-Roles Token Ingress Rejection:**
   - **Request:** `GET /api/v1/sla/calculate/01a126f6-7d9a-7dfa-96bb-d6f4a07fe540`
   - **Auth:** Bearer JWT with `roles: []`.
   - **Result:** `403 Forbidden` (`Forbidden resource: user has no assigned roles`).

---

## 5. Database and Privilege Safety Baseline Audit

All protected databases and roles were verified before and after the implementation:

### 1. External Databases Protection
- **`zentra_test`:**
  - Row counts: `users: 8`, `schools: 4` (100% UNTOUCHED).
- **`hisecure_erp`:**
  - Public tables: `101` (100% UNTOUCHED).

### 2. Development Database (`zentra_local`)
- **Row Counts:**
  - `users`: 8
  - `schools`: 4
  - `service_cases`: 2
  - `hi_tech_labs`: 5
- **Integrity:** Zero rows dropped, zero synthetic fixtures mutated, zero destructive SQL executed.

### 3. Application Database Role (`zentra_dev`)
- **Role Attributes Query:**
  ```sql
  SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'zentra_dev';
  ```
- **Confirmed Baseline:**
  ```text
    rolname   | rolsuper | rolbypassrls | rolcanlogin 
  ------------+----------+--------------+-------------
   zentra_dev | f        | f            | t
  ```
- **Safety Rule Preserved:** `SUPERUSER` was never granted; `BYPASSRLS` was never granted. Forced RLS remains active and binding.

---

## 6. Physical Device State Verification (OnePlus Nord)

- **Device Serial:** `65c7923e` (OnePlus Nord, Android 12)
- **Status:** Connected (`device`)
- **ADB Reverse Port Mappings:**
  ```text
  UsbFfs tcp:8081 tcp:8081
  UsbFfs tcp:4000 tcp:4000
  ```
- **Active Foreground App:** `com.zentra.field.dev`
- **Screen State Verified:**
  - User: `Demo Field Engineer` (`engineer.demo@zentra.local`)
  - Role Badge: `FIELD_ENGINEER`
  - Territory: `1 Assigned District(s)`
  - Active Dossier: `1 Assigned Calls Cached Locally`
  - Sync Status: `Connected (Online)`
  - Active Tab: `Assigned Calls (1)`
  - Captured Screenshot Artifact: [`stage6e2.png`](file:///C:/Users/acer/.gemini/antigravity/brain/8b1cca3e-6cce-4386-8dcc-75d1818fe400/stage6e2.png)

---

## 7. Remaining Limitations and Notes

1. **Physical Cable Dependency:** If the physical OnePlus Nord is disconnected, Android automatically tears down USB reverse mappings. Re-plugging requires restoring `adb reverse tcp:8081 tcp:8081` and `adb reverse tcp:4000 tcp:4000` (which is already configured in the launch script).
2. **Assignment History Ledger Depth:** In `zentra_local`, `assignment_history` currently has 0 rows because synthetic fixtures create cases directly in `ASSIGNED` state without running dynamic dispatch engine reassignments. RLS policy execution on empty ledgers was verified; dynamic multi-assignment rows will appear upon future dispatch mutations.
3. **No Unrelated Scope Expansion:** In strict adherence to MUSE SPARK principles, no changes were made outside Findings 1, 2, and 3. Dormant upload modules, background queues, and cloud integrations remain untouched.

---

## 8. Final Sign-off Statement

All three findings from `MUSE_SPARK_STAGE_6E_1_RLS_SECURITY_SIGNOFF.md` are resolved, verified through 408 automated tests, and confirmed against real PostgreSQL 18 Row-Level Security in the live local development environment under `zentra_dev`.

**Sign-off Status: PASS**  
**Final Action:** **STOP — Awaiting Human Review**

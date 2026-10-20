# MUSE SPARK IMPLEMENTATION REPORT — PHASE 6
## ZENTRA — Hi-Tech Lab Field Service Management Platform
### Phase 6: School, Lab & Equipment Domain Foundation

---

## 1. Phase 6 Objective & Executive Summary
- **Status**: `IMPLEMENTED` | `TESTED` (with explicit deferred scope classifications)
- **Objective**: Establish the authoritative school and lab administrative domain foundation, territory hierarchy validation, UDISE code validation, multi-lab support per school, PostgreSQL kernel Row-Level Security (RLS) enforcement extension for hi-tech labs, and comprehensive RESTful domain APIs for ZENTRA.
- **Executive Summary**:
  Phase 6 transitions the core infrastructure of ZENTRA from authentication and security primitives into the operational domain layer. Building on the verified Phase 4 database foundation and Phase 5 RBAC/RLS security kernel, Phase 6 delivers:
  1. **Authoritative Territory & School Domain Module**: A complete NestJS module (`apps/api/src/modules/schools/`) encapsulating repository, service, and controller layers for Districts, Blocks, Schools, and Hi-Tech Labs.
  2. **Topological Hierarchy Integrity**: Strict mathematical tree validation (`District -> Block -> School -> Lab`). Rejects cross-district block assignments with HTTP 400 (`Hierarchy conflict`), preventing geographic anomalies.
  3. **Strict 11-Digit UDISE+ Validation**: Enforced via Zod schemas and PostgreSQL unique constraints (`uq_schools_udise_code`), rejecting short, long, non-numeric, or duplicate school identifiers. ZENTRA validates UDISE+ as an exactly 11-digit numeric school identifier. Semantic interpretation of individual digit positions is outside Phase 6 validation.
  4. **Multi-Lab Architectural Model (1:N)**: Completely eliminates the naive 1:1 school-lab assumption. Schools in Tamil Nadu can and do maintain multiple physical labs (e.g. Primary Computer Lab, ATAL Tinkering Hub, Language Lab). Uniqueness of `lab_code` is strictly scoped per school via composite unique constraint `uq_hi_tech_labs_school_code`, permitting code re-use across different schools while enforcing uniqueness within each school.
  5. **PostgreSQL Kernel RLS Extension for Hi-Tech Labs**: Delivered migration `20261007000002_create_hi_tech_labs_rls.ts` enabling and forcing RLS on `hi_tech_labs` via policy `hi_tech_labs_territory_isolation`. School RLS originated in Phase 5. Phase 6 extends kernel-level territory isolation to hi_tech_labs through its parent school relationship, ensuring fail-closed data isolation at the database engine level.
  6. **Multi-District RBAC & Scoping**:
     - `MASTER_ADMIN`: Statewide read and write access across all districts.
     - `REPORTING_HEAD`: Statewide read-only access for analytical dashboards; all mutations (`POST`, `PUT`, `DELETE`) are strictly rejected with HTTP 403 Forbidden.
     - `DISTRICT_COORDINATOR`: Read and write access strictly bounded to assigned territory districts; mutations outside assigned districts are rejected with HTTP 403 Forbidden.
     - `FIELD_ENGINEER`: Read access within assigned district; administrative mutations on schools/labs are rejected with HTTP 403 Forbidden.
     - `AI` / `HM`: Inspection and reporting roles; administrative mutations on schools/labs are rejected with HTTP 403 Forbidden.
  7. **District & Block Read Visibility**: District and Block master/reference metadata is globally readable to authenticated users. School and Lab operational records remain subject to territory/resource authorization and PostgreSQL RLS.
  8. **Historical Durability via Soft-Deletion**: Schools and labs are deactivated via `is_active = false`. No hard deletions occur, preserving historical service cases, equipment records, and audit events.
  9. **Administrative Audit Logging**: Audit event records are recorded in `audit_events` for `SCHOOL_CREATED`, `SCHOOL_UPDATED`, `SCHOOL_DEACTIVATED`, `LAB_CREATED`, `LAB_UPDATED`, and `LAB_DEACTIVATED`.
  10. **Equipment Domain Relationship**: Phase 4 equipment tables remain the existing database foundation. Phase 6 establishes the School/Lab administrative domain that later Phase 7 equipment functionality will attach to.
  11. **Comprehensive Integration Testing & Accounting**: Phase 6 added 30 dedicated school/lab domain integration tests (`apps/api/test/school-lab-domain.spec.ts`). Existing Phase 4 and Phase 5 regression suites were retained and also passed without modification (90/90 backend tests passing, 109/109 total tests passing across all 10 monorepo packages).

---

## 2. Scope Boundaries & Explicit Non-Goals
- **Status**: `IMPLEMENTED` (Strict Boundary Adherence Verified)
- **Included in Scope**:
  1. Migration `20261007000002_create_hi_tech_labs_rls.ts` extending RLS to `hi_tech_labs`.
  2. Shared TypeScript types (`District`, `Block`, `SchoolCategory`, `School`, `LabType`, `HiTechLab`, `SchoolWithLabs`, `SchoolQueryFilters`) in `@zentra/types`.
  3. Shared Zod contracts (`createSchoolSchema`, `updateSchoolSchema`, `createLabSchema`, `updateLabSchema`, `schoolQuerySchema`) in `@zentra/contracts`.
  4. Repository layer for Districts, Blocks, Schools, and Labs with typed Kysely query builders.
  5. Domain service layer (`TerritoryService`, `SchoolsService`, `LabsService`) with business rules, territory assertions, and audit logging.
  6. Controller layer (`DistrictsController`, `BlocksController`, `SchoolsController`, `LabsController`) with NestJS guards and correlation tracking.
  7. Synthetic development fixtures with multi-lab and multi-district school hierarchies (`synthetic-dev-fixtures.ts`).
  8. Integration test suite `apps/api/test/school-lab-domain.spec.ts` (30 tests).
- **Explicit Non-Goals (Deferred to Subsequent Phases)**:
  1. **Phase 7: Equipment Master & Dynamic Attribute Engine**: Custom attribute definitions, hardware telemetry parsers, and diagnostic schemas for UPS/batteries/generators are DEFERRED TO PHASE 7. Phase 4 equipment tables remain the existing database foundation. Phase 6 establishes the School/Lab administrative domain that later Phase 7 equipment functionality will attach to.
  2. **Phase 8: Staged Ingestion & Duplicate Classification Engine**: Excel/CSV complaint import staging, OCR ingestion pipeline, and fuzzy school matching are DEFERRED TO PHASE 8.
  3. **Phase 9: Service Case Lifecycle & Dispatch Engine**: Complaint deduplication, ticket dispatch, and engineer assignment state machines are DEFERRED TO PHASE 9.
  4. **Phase 10: Mobile Local-First Core**: WatermelonDB client schemas and mobile SQLite persistence are DEFERRED TO PHASE 10.
  5. **Phase 11: Mobile Hardware GPS & Camera Module**: Mobile EXIF geotagging and hardware camera integration are DEFERRED TO PHASE 11.
  6. **Phase 12: Bi-Directional Offline Sync Engine**: Pull/push delta sync algorithms and vector clock reconciliation are DEFERRED TO PHASE 12.
  7. **Phase 14: Evidence Pipeline & Direct S3 Streaming**: Presigned S3/MinIO binary uploads and hash verification are DEFERRED TO PHASE 14.
  8. **Phase 15: Conveyance Claims & Management Web Portal**: React admin dashboards and web conveyance claims are DEFERRED TO PHASE 15.

---

## 3. Authoritative Documents & Predecessor Traceability
- **Status**: `IMPLEMENTED`
- **Traceability Chain**:
  - `Phase 0`: `docs/ZENTRA_PROJECT_REQUIREMENTS.md` — Multi-tier territory structure (District, Block, School, Lab) and UDISE+ identifier mandate.
  - `Phase 1`: `docs/ZENTRA_ARCHITECTURE.md` & `docs/ZENTRA_DATA_MODEL.md` — 1:N School-to-Lab relationship, audit event trail, and territory scoping.
  - `Phase 2`: `docs/ZENTRA_TECHNOLOGY_FOUNDATION.md` & `docs/ZENTRA_DATABASE_IMPLEMENTATION_BLUEPRINT.md` — NestJS 11 + Fastify + Kysely standards.
  - `Phase 4`: `docs/ZENTRA_DATABASE_IMPLEMENTATION.md` — Existing database foundation for territory, schools, and equipment (`districts`, `blocks`, `schools`, `hi_tech_labs`, `oem_manufacturers`, `equipment_types`, and `lab_equipment`).
  - `Phase 5`: `docs/ZENTRA_AUTHENTICATION_ARCHITECTURE.md` & `docs/ZENTRA_RLS_IMPLEMENTATION.md` — School RLS origin, `RlsService` transaction context, `@Roles()`, `JwtAuthGuard`, `RolesGuard`, and `TerritoryGuard`.

---

## 4. Domain Model & Entity Architecture
- **Status**: `IMPLEMENTED` | `TESTED`
- **Entity Overview**:
  1. **District (`districts`)**:
     - Primary Key: `district_id` (UUIDv7)
     - Business Key: `district_code` (VARCHAR(10), UNIQUE, uppercase e.g. `DEMO_DIS`)
     - Attributes: `district_name`, `is_active`, timestamps.
  2. **Block (`blocks`)**:
     - Primary Key: `block_id` (UUIDv7)
     - Foreign Key: `district_id` -> `districts.district_id` (ON DELETE RESTRICT)
     - Business Key: `block_code` (VARCHAR(20)), unique per district (`uq_blocks_district_code`).
     - Attributes: `block_name`, `is_active`, timestamps.
  3. **School (`schools`)**:
     - Primary Key: `school_id` (UUIDv7)
     - Foreign Keys: `district_id` -> `districts.district_id`, `block_id` -> `blocks.block_id`
     - Business Key: `udise_code` (VARCHAR(11), UNIQUE, strictly 11 numeric digits).
     - Attributes: `school_name`, `school_category`, `base_pincode`, `is_special_zone`, `latitude`, `longitude`, `hm_name`, `hm_phone`, `ai_name`, `ai_phone`, `ai_emp_id`, `is_active`, timestamps.
  4. **Hi-Tech Lab (`hi_tech_labs`)**:
     - Primary Key: `lab_id` (UUIDv7)
     - Foreign Key: `school_id` -> `schools.school_id` (ON DELETE RESTRICT)
     - Composite Key: `(school_id, lab_code)` strictly UNIQUE (`uq_hi_tech_labs_school_code`).
     - Attributes: `lab_type` (PRIMARY, ATAL_TINKERING, LANGUAGE_LAB, etc.), `room_location`, `active_computers_count`, `commissioning_date`, `is_active`, timestamps.
  5. **Equipment Tables Distinction**:
     - Phase 4 equipment tables (`oem_manufacturers`, `equipment_types`, `lab_equipment`) remain the existing database foundation. Phase 6 establishes the School/Lab administrative domain that later Phase 7 equipment functionality will attach to.

---

## 5. Strict Multi-Lab Architectural Rule
- **Status**: `IMPLEMENTED` | `TESTED`
- **Rationale & Analysis**:
  A common failure in school management software is assuming that `1 School = 1 Lab`. In Tamil Nadu government schools (Higher Secondary and Model schools), many institutions host multiple laboratories:
  1. A primary computer lab installed under early ICT phases.
  2. An ATAL Tinkering Lab (ATL) installed under NITI Aayog initiatives.
  3. A dedicated Language Lab or Robotics Lab under recent modernization schemes.
- **Architectural Enforcement**:
  - `hi_tech_labs` maintains a foreign key `school_id` pointing to `schools.school_id`.
  - The unique constraint is composite: `UNIQUE (school_id, lab_code)`.
  - Adding a lab with code `DEMO-LAB-01` to a school that already has `DEMO-LAB-01` raises HTTP 409 Conflict.
  - Adding a lab with code `DEMO-LAB-01` to a *different* school succeeds cleanly.
  - Querying `GET /schools/:schoolId` returns the parent school metadata along with an array of all associated labs (`labs: HiTechLab[]`).

---

## 6. Territory Hierarchy & Topological Integrity
- **Status**: `IMPLEMENTED` | `TESTED`
- **Validation Rule**:
  Every school belongs to a District and a Block. A Block belongs to a District.
  Therefore, a school's `block_id` **MUST** belong to the school's `district_id`.
- **Enforcement Mechanism**:
  `TerritoryService.validateHierarchy(districtId, blockId)`:
  ```typescript
  async validateHierarchy(districtId: string, blockId: string): Promise<void> {
    const districtExists = await this.districtsRepo.exists(districtId);
    if (!districtExists) {
      throw new BadRequestException(`Invalid districtId: District '${districtId}' does not exist`);
    }

    const block = await this.blocksRepo.findById(blockId);
    if (!block) {
      throw new BadRequestException(`Invalid blockId: Block '${blockId}' does not exist`);
    }

    if (block.district_id !== districtId) {
      throw new BadRequestException(
        `Hierarchy conflict: Block '${blockId}' (${block.block_name}) does not belong to District '${districtId}'`,
      );
    }
  }
  ```
- **Test Verification**:
  Attempting to register a school with District A and Block B1 (belonging to District B) throws HTTP 400 Bad Request with message `Hierarchy conflict`.

---

## 7. UDISE+ 11-Digit Standard & Validation Architecture
- **Status**: `IMPLEMENTED` | `TESTED`
- **Standard**:
  ZENTRA validates UDISE+ as an exactly 11-digit numeric school identifier (`/^\d{11}$/`). Semantic interpretation of individual digit positions is outside Phase 6 validation.
- **Zod Contract**:
  ```typescript
  export const createSchoolSchema = z.object({
    udiseCode: z
      .string()
      .regex(/^\d{11}$/, 'UDISE code must be exactly 11 numeric digits'),
    schoolName: z.string().trim().min(2).max(255),
    districtId: z.string().uuid(),
    blockId: z.string().uuid(),
    ...
  });
  ```
- **Conflict Handling**:
  If a school already exists with the supplied UDISE code, `SchoolsService.createSchool` throws HTTP 409 Conflict:
  `School with UDISE code '...' already exists`.

---

## 8. Database Schema & Migration Implementation
- **Status**: `IMPLEMENTED` | `TESTED`
- **Migration**: `apps/api/src/database/migrations/20261007000002_create_hi_tech_labs_rls.ts`
- **Schema Enhancements**:
  1. `ALTER TABLE hi_tech_labs ENABLE ROW LEVEL SECURITY;`
  2. `ALTER TABLE hi_tech_labs FORCE ROW LEVEL SECURITY;`
  3. Policy `hi_tech_labs_territory_isolation`:
     - Allows `MASTER_ADMIN` and `REPORTING_HEAD` statewide access.
     - Joins `schools` on `hi_tech_labs.school_id = schools.school_id` and filters via `user_territory_assignments` where `district_id = schools.district_id`.
- **Migration Runner Integration**:
  Registered as migration `m7` in `migration-runner.ts`. Reversible `down()` drops the policy and disables RLS cleanly.

---

## 9. PostgreSQL Kernel Row-Level Security (RLS) for School & Lab Domains
- **Status**: `IMPLEMENTED` | `TESTED`
- **RLS Lineage & Phase Ownership**:
  School RLS originated in Phase 5 (`schools_territory_isolation`). Phase 6 extends kernel-level territory isolation to `hi_tech_labs` through its parent school relationship (`hi_tech_labs_territory_isolation`).
- **Fail-Closed Kernel Enforcement**:
  Row-Level Security is enforced directly in PostgreSQL. Even if an application service misses a where clause, the database kernel filters out unauthorized rows.
- **Transaction Context Binding**:
  Calls execute inside `RlsService.withSecurityContext({ userId, role })`, which executes transaction-local:
  ```sql
  SET LOCAL zentra.current_user_id = '<userId>';
  SET LOCAL zentra.current_user_role = '<role>';
  ```
- **Verification in Test**:
  - District Coordinator for Erode executing `SELECT * FROM schools` sees ONLY Erode schools.
  - District Coordinator for Erode executing `SELECT * FROM hi_tech_labs` sees ONLY labs belonging to Erode schools.
  - Master Admin sees all schools and labs statewide.

---

## 10. Type System & Contract Architecture
- **Status**: `IMPLEMENTED` | `TESTED`
- **Packages**:
  - `@zentra/types`:
    - `District`: `districtId`, `districtCode`, `districtName`, `isActive`, `createdAt`, `updatedAt`
    - `Block`: `blockId`, `districtId`, `blockCode`, `blockName`, `isActive`, `createdAt`, `updatedAt`
    - `SchoolCategory`: Union of categories (`Higher Secondary`, `High School`, `Model School`, `Girls High School`, `Primary`, `Middle School`, `OTHER`)
    - `School`: Complete school record with contact and geolocation fields.
    - `HiTechLab`: Complete lab record with `labType`, `activeComputersCount`, `commissioningDate`.
    - `SchoolWithLabs`: Composite entity including nested `labs: HiTechLab[]`.
    - `SchoolQueryFilters`: Pagination and search filter interface.
  - `@zentra/contracts`:
    - `createSchoolSchema`: Validates UDISE (11 digits), UUIDs, pincode (6 digits), lat/lng, contacts.
    - `updateSchoolSchema`: Partial schema for updates.
    - `createLabSchema`: Validates `labCode`, `labType`, `activeComputersCount`, `commissioningDate`.
    - `updateLabSchema`: Partial schema for lab updates.
    - `schoolQuerySchema`: Coerces and validates query parameters (`page`, `limit`, `search`, `districtId`, `blockId`).

---

## 11. Repository Layer Implementation
- **Status**: `IMPLEMENTED` | `TESTED`
- **Repositories**:
  1. `DistrictsRepository` (`repositories/districts.repository.ts`):
     - `findAll(options)`: Ordered by `district_name ASC`.
     - `findById(districtId)`
     - `findByCode(districtCode)`
     - `exists(districtId)`
  2. `BlocksRepository` (`repositories/blocks.repository.ts`):
     - `findById(blockId)`
     - `findByDistrictId(districtId, options)`: Ordered by `block_name ASC`.
     - `findByCode(districtId, blockCode)`
     - `exists(blockId)`
     - `belongsToDistrict(blockId, districtId)`
  3. `SchoolsRepository` (`repositories/schools.repository.ts`):
     - `findById(schoolId, trx)`
     - `findByUdise(udiseCode, trx)`
     - `findMany(filters, trx)`: Multi-column search across `school_name` and `udise_code`, with pagination offset.
     - `count(filters, trx)`: Count query matching filters.
     - `create(data, trx)`: Returns `Selectable<SchoolsTable>`.
     - `update(schoolId, data, trx)`: Automatically updates `updated_at`.
     - `softDelete(schoolId, trx)`: Sets `is_active = false`.
     - `exists(schoolId, trx)`
  4. `LabsRepository` (`repositories/labs.repository.ts`):
     - `findById(labId, trx)`
     - `findBySchoolId(schoolId, options, trx)`
     - `findBySchoolAndCode(schoolId, labCode, trx)`
     - `create(data, trx)`
     - `update(labId, data, trx)`
     - `softDelete(labId, trx)`
     - `countBySchool(schoolId, trx)`
     - `exists(labId, trx)`

---

## 12. Domain Service Layer Implementation
- **Status**: `IMPLEMENTED` | `TESTED`
- **Services**:
  1. `TerritoryService` (`services/territory.service.ts`):
     - Manages geographic taxonomy reading and topological integrity verification.
  2. `SchoolsService` (`services/schools.service.ts`):
     - Orchestrates school lifecycle operations.
     - Asserts territory mutation rights before any persistence.
     - Emits `SCHOOL_CREATED`, `SCHOOL_UPDATED`, and `SCHOOL_DEACTIVATED` audit records.
  3. `LabsService` (`services/labs.service.ts`):
     - Manages lab additions, configuration updates, and soft-deactivation.
     - Verifies school existence and asserts territory permissions for parent school.
     - Emits `LAB_CREATED`, `LAB_UPDATED`, and `LAB_DEACTIVATED` audit records.

---

## 13. Controller & API Routing Layer
- **Status**: `IMPLEMENTED` | `TESTED`
- **Endpoints Implemented**:
  | Route | Method | Roles Permitted | Description |
  |---|---|---|---|
  | `/districts` | `GET` | Authenticated | List all active districts |
  | `/districts/:districtId` | `GET` | Authenticated | Get district details |
  | `/districts/:districtId/blocks` | `GET` | Authenticated | List blocks in district |
  | `/blocks/:blockId` | `GET` | Authenticated | Get block details |
  | `/blocks/:blockId/schools` | `GET` | Authenticated | List schools in block |
  | `/schools` | `GET` | Authenticated | List schools with search & filters |
  | `/schools/:schoolId` | `GET` | Authenticated | Get school with nested labs |
  | `/schools` | `POST` | `MASTER_ADMIN`, `DISTRICT_COORDINATOR` | Create school |
  | `/schools/:schoolId` | `PUT` | `MASTER_ADMIN`, `DISTRICT_COORDINATOR` | Update school |
  | `/schools/:schoolId` | `DELETE` | `MASTER_ADMIN`, `DISTRICT_COORDINATOR` | Soft delete school |
  | `/schools/:schoolId/labs` | `GET` | Authenticated | List labs in school |
  | `/schools/:schoolId/labs` | `POST` | `MASTER_ADMIN`, `DISTRICT_COORDINATOR` | Add lab to school |
  | `/labs/:labId` | `GET` | Authenticated | Get lab details |
  | `/labs/:labId` | `PUT` | `MASTER_ADMIN`, `DISTRICT_COORDINATOR` | Update lab details |
  | `/labs/:labId` | `DELETE` | `MASTER_ADMIN`, `DISTRICT_COORDINATOR` | Soft delete lab |

- **District & Block Read Visibility**:
  District and Block master/reference metadata is globally readable to authenticated users. School and Lab operational records remain subject to territory/resource authorization and PostgreSQL RLS.

---

## 14. Role-Based Access Control (RBAC) Enforcement
- **Status**: `IMPLEMENTED` | `TESTED`
- **Role Permissions Matrix**:
  - `MASTER_ADMIN`: Global read/write access. Can create, edit, and deactivate schools and labs across any district.
  - `REPORTING_HEAD`: Global read-only access. Any POST/PUT/DELETE request is rejected with HTTP 403 Forbidden.
  - `DISTRICT_COORDINATOR`: Scoped administrative access. Can create, update, and deactivate schools and labs within assigned districts. Any attempt to modify schools or labs in other districts is rejected with HTTP 403 Forbidden.
  - `FIELD_ENGINEER`: Operational read access within assigned district. Administrative mutations are rejected with HTTP 403 Forbidden.
  - `AI` / `HM`: Inspection and reporting roles; administrative mutations on schools and labs are rejected with HTTP 403 Forbidden.
- **AI and HM Resource Scoping Analysis**:
  - **Mutations (Case E)**: Any mutation attempt (`POST /schools`, `PUT /schools/:id`, `DELETE /schools/:id`, `POST /schools/:id/labs`, `PUT /labs/:id`, `DELETE /labs/:id`) by AI or HM personas is rejected with HTTP 403 Forbidden by `RolesGuard` and service-level `assertCanMutateTerritory`.
  - **Cross-Territory Read (Cases B, D, F)**: Querying districts outside the user's territory assignment (`GET /schools?districtId=...`) is rejected with HTTP 403 Forbidden by `assertCanReadTerritory`.
  - **Authorized Territory Read (Cases A, C)**: Reading schools within the assigned territory is permitted and bounded by PostgreSQL RLS.
  - **School-Level Binding (REQUIRES CLARIFICATION)**:
    Whether Headmaster (HM) school read visibility must be restricted strictly to their single assigned `school_id` via a dedicated school-binding table (or whether HM accounts are provisioned with future school-level claims) REQUIRES CLARIFICATION before Phase 9/15. In Phase 6, AI and HM roles are strictly prohibited from administrative mutations (403 Forbidden), and read queries remain bounded by territory assignment and PostgreSQL RLS.

---

## 15. Resource-Level Territory Scoping Enforcement
- **Status**: `IMPLEMENTED` | `TESTED`
- **Two-Layer Boundary Protection**:
  1. **Application/Service Guardrail**: `assertCanMutateTerritory(user, targetDistrictId)` verifies that `user.territoryDistrictIds.includes(targetDistrictId)`. If not, throws HTTP 403 Forbidden. `assertCanReadTerritory(user, targetDistrictId)` ensures users do not query districts outside their assigned scope.
  2. **Database Kernel RLS**: PostgreSQL policies `schools_territory_isolation` and `hi_tech_labs_territory_isolation` prevent direct query leakage even under raw SQL queries.

---

## 16. Administrative Audit Logging & Forensics
- **Status**: `IMPLEMENTED` | `TESTED`
- **Audit Table**: `audit_events`
- **Action Types Logged**:
  - `SCHOOL_CREATED`
  - `SCHOOL_UPDATED`
  - `SCHOOL_DEACTIVATED`
  - `LAB_CREATED`
  - `LAB_UPDATED`
  - `LAB_DEACTIVATED`
- **Forensic Attributes Captured**:
  - `actor_user_id`: ID of the authenticated user performing the mutation.
  - `target_entity_type`: `'schools'` or `'hi_tech_labs'`.
  - `target_entity_id`: UUID of the affected entity.
  - `event_category`: `'ADMINISTRATIVE'`.
  - `actor_ip_address` & `actor_device_id`.
  - `pre_mutation_state` & `post_mutation_state` JSON snapshots.

---

## 17. Soft-Deletion Lifecycle & Historical Data Durability
- **Status**: `IMPLEMENTED` | `TESTED`
- **Durability Guarantee**:
  In a field service management platform handling historical warranties, service visits, and evidence photos, hard deletions cause catastrophic data loss and broken foreign keys.
- **Implementation**:
  - Calling `DELETE /schools/:schoolId` or `DELETE /labs/:labId` sets `is_active = false`.
  - Zero `DELETE FROM schools` or `DELETE FROM hi_tech_labs` statements are executed in business logic.
  - Records remain queryable by admins and preserve referential integrity with `service_cases`, `lab_equipment`, and `field_visits`.
- **Soft-Deleted Record Visibility (REQUIRES CLARIFICATION)**:
  In Phase 6, `GET /schools/:schoolId/labs` defaults to active labs (`activeOnly: true`). `GET /schools` supports an optional `isActive` query filter (`true`, `false`, or omitted). Whether standard field engineer and operational queries on `GET /schools` must unconditionally default to filtering out inactive schools (`is_active = true`), while allowing only administrative personas (`MASTER_ADMIN`, `DISTRICT_COORDINATOR`) to query historical inactive schools via an explicit flag, REQUIRES CLARIFICATION prior to Phase 15 web portal implementation. Soft-deletion is preserved across all tables with zero hard deletions.

---

## 18. Synthetic Development Seed Fixtures
- **Status**: `IMPLEMENTED` | `TESTED`
- **Compliance**: Strict compliance with Zero Real Data directive. Zero real school PII, zero real teacher phone numbers.
- **Fixture Topology in `synthetic-dev-fixtures.ts`**:
  - District A (Erode):
    - Block A1 (`DEMO_BLK`):
      - School A1-001 (UDISE `33100000001`):
        - Lab 1 (`DEMO-LAB-01`, Primary Computer Lab, 20 PCs)
        - Lab 2 (`DEMO-LAB-02`, ATAL Tinkering Hub, 15 PCs)
      - School A1-002 (UDISE `33100000003`):
        - Lab 1 (`DEMO-LAB-01`, Computer Wing, 10 PCs)
    - Block A2 (`DEMO_BLK_EAST`):
      - School A2-001 (UDISE `33100000004`):
        - Lab 1 (`DEMO-LAB-01`, Main Building Lab A, 12 PCs)
  - District B (Salem):
    - Block B1 (`DEMO_BLK_SAL`):
      - School B1-001 (UDISE `33100000002`):
        - Lab 1 (`DEMO-SAL-LAB-01`, Primary IT Lab, 20 PCs)

---

## 19. Comprehensive Integration Test Suite
- **Status**: `IMPLEMENTED` | `TESTED`
- **Test File**: `apps/api/test/school-lab-domain.spec.ts`
- **Suite Breakdown (30 tests)**:
  1. *Territory Hierarchy & Validation* (6 tests):
     - List active districts via `GET /districts`
     - Retrieve district details via `GET /districts/:districtId`
     - List blocks in district via `GET /districts/:districtId/blocks`
     - Retrieve block details via `GET /blocks/:blockId`
     - Reject cross-district hierarchy mismatch (400 Bad Request)
     - Reject nonexistent district or block IDs (400 Bad Request)
  2. *School Domain Operations* (7 tests):
     - Create school with valid 11-digit UDISE (201 Created)
     - Reject duplicate UDISE code (409 Conflict)
     - Reject invalid UDISE length or non-numeric format (400 Bad Request)
     - List schools with search and filter parameters (200 OK)
     - Retrieve school details with nested labs array (200 OK)
     - Update school details (200 OK)
     - Soft-delete school (200 OK)
  3. *Hi-Tech Lab Multi-Lab Model* (7 tests):
     - Verify 1 school supports multiple distinct labs (avoiding 1:1 fallacy)
     - Add 3rd lab to school via `POST /schools/:id/labs` (201 Created)
     - Enforce uniqueness: reject duplicate `lab_code` in same school (409 Conflict)
     - Allow identical `lab_code` across different schools (201 Created)
     - Retrieve lab details via `GET /labs/:labId` (200 OK)
     - Update lab metadata via `PUT /labs/:labId` (200 OK)
     - Soft-delete lab (200 OK)
  4. *RBAC & Multi-District Scoping* (5 tests):
     - `REPORTING_HEAD` can read statewide but mutations are rejected (403 Forbidden)
     - `non-administrative roles (FIELD_ENGINEER, HM, AI)` can read assigned schools, but mutations and unauthorized territory access are rejected with 403 Forbidden (Verifying HM/AI personas cases A-F)
     - `DISTRICT_COORDINATOR` can mutate schools within assigned district (201 Created)
     - `DISTRICT_COORDINATOR` cannot mutate schools in other districts (403 Forbidden)
     - `DISTRICT_COORDINATOR` cannot mutate labs in other districts (403 Forbidden)
  5. *PostgreSQL Kernel Row-Level Security (RLS) Isolation* (4 tests):
     - Erode Coordinator context restricts SQL strictly to Erode schools
     - Salem Coordinator context restricts SQL strictly to Salem schools
     - `hi_tech_labs` table enforces RLS territory isolation joining parent school
     - `MASTER_ADMIN` context can query schools and labs across all districts
  6. *Administrative Audit Logging* (1 test):
     - Verifies `audit_events` entries recorded for `SCHOOL_CREATED`, `SCHOOL_UPDATED`, `SCHOOL_DEACTIVATED`, `LAB_CREATED`, `LAB_UPDATED`, `LAB_DEACTIVATED`.

---

## 20. Test Execution Results & Accounting
- **Status**: `VERIFIED`
- **Test Accounting Breakdown**:
  - Phase 6 added **30 dedicated school/lab domain integration tests** (`school-lab-domain.spec.ts`).
  - Existing Phase 4 and Phase 5 regression suites were retained and also passed without modification (**60 tests**).
- **Backend Test Summary (`apps/api`) — 90/90 Passed**:
  ```
  Test Files  4 passed (4)
       Tests  90 passed (90)
    Duration  13.27s
  ```
  - `database-schema.spec.ts` (Phase 4 regression): 19 passed
  - `auth-security.spec.ts` (Phase 5 regression): 38 passed
  - `school-lab-domain.spec.ts` (Phase 6 new integration): 30 passed
  - `api.spec.ts` (API baseline): 3 passed
- **Full Monorepo Test Summary (`turbo run test`) — 109/109 Passed**:
  ```
  Tasks:    13 successful, 13 total
  Cached:    0 cached (or replayed), 13 total
  Time:    19.43s
  ```
  - `@zentra/shared`: 5 passed
  - `@zentra/config`: 3 passed
  - `@zentra/contracts`: 3 passed
  - `@zentra/testing`: 4 passed
  - `@zentra/field`: 3 passed
  - `@zentra/web`: 1 passed
  - `@zentra/api`: 90 passed
  - Total passed tests across monorepo: **109 passed** (0 failed, 0 skipped).
- **TypeScript Typecheck (`turbo run typecheck`)**:
  ```
  Tasks:    15 successful, 15 total (0 errors)
  ```
- **Monorepo Build (`turbo run build`)**:
  ```
  Tasks:    8 successful, 8 total (0 errors)
  ```

---

## 21. Error Handling & Canonical Response Envelope
- **Status**: `IMPLEMENTED` | `TESTED`
- **Standard Envelope**:
  - Success responses adhere to `ApiResponseEnvelope<T>`:
    ```json
    {
      "success": true,
      "data": { ... },
      "correlationId": "uuid-v7",
      "timestamp": "2026-10-07T16:30:00.000Z"
    }
    ```
  - Error responses adhere to `ApiErrorEnvelope`:
    ```json
    {
      "success": false,
      "error": {
        "category": "VALIDATION_ERROR | AUTHORIZATION_ERROR | CONFLICT",
        "code": "ERR_VALIDATION_FAILED | HTTP_403 | HTTP_409",
        "message": "Human readable explanation",
        "details": [ ... ],
        "isRetryable": false
      },
      "correlationId": "uuid-v7",
      "timestamp": "2026-10-07T16:30:00.000Z"
    }
    ```

---

## 22. Security Posture & Vulnerability Analysis
- **Status**: `VERIFIED`
- **Fail-Closed Isolation**: PostgreSQL RLS is enabled and forced on `schools` and `hi_tech_labs`. A compromised API route cannot access rows outside the session's territory.
- **SQL Injection Prevention**: 100% of queries use Kysely parameterized builders with strictly typed parameters. Zero raw string interpolation.
- **Non-Enumeration & Privilege Separation**: Mutation endpoints strictly reject lower-privileged roles with generic HTTP 403 errors.

---

## 23. Performance Considerations & Query Optimization
- **Status**: `VERIFIED`
- **Index Coverage**:
  - `idx_schools_district_block`: Composite index on `(district_id, block_id)` for high-speed hierarchical filtering.
  - `idx_schools_udise`: B-tree index on `udise_code` for constant-time lookups.
  - `uq_hi_tech_labs_school_code`: Composite index on `(school_id, lab_code)` providing fast index-only scans for per-school lab queries.
- **Pagination**: Default limit of 20 with max 100 enforced via Zod schema, preventing denial-of-service through unbounded query sets.

---

## 24. Backward Compatibility & Zero-Regression Verification
- **Status**: `VERIFIED`
- **Regression Check**:
  - Phase 3 Foundation: All 10 monorepo packages build without issues.
  - Phase 4 Database: Database schema and all 19 database migration tests pass cleanly.
  - Phase 5 Auth & RBAC: All 38 authentication, Scrypt, RTR, and RLS security tests pass cleanly.
  - Zero breaking changes to existing tables or columns.

---

## 25. Deferred Requirements & Phase Roadmap
- **Status**: `DOCUMENTED`
- Explicit tracking of deferred capabilities:
  - `Phase 7`: Equipment Master & Dynamic Diagnostic Attribute Engine (telemetry, battery voltage, threshold checks). Phase 4 equipment tables remain the existing database foundation. Phase 6 establishes the School/Lab administrative domain that later Phase 7 equipment functionality will attach to.
  - `Phase 8`: Ingestion & Duplicate Classification Engine (OCR, fuzzy school matching, staging tables).
  - `Phase 9`: Service Case Dispatch & Ticket Lifecycle (SLA timers, push notifications, engineer dispatch).
  - `Phase 10-12`: Mobile local-first architecture, hardware sensors, and bi-directional offline sync.

---

## 26. Architectural Decision Records (ADRs) Summary
- **Status**: `DOCUMENTED`
- **ADR-008: Multi-Lab 1:N Relationship**: Rejects 1:1 school-lab model; establishes `hi_tech_labs` with composite uniqueness on `(school_id, lab_code)` to match Tamil Nadu educational realities.
- **ADR-009: Hi-Tech Lab RLS Enforcement Extension**: School RLS originated in Phase 5. Phase 6 extends kernel-level territory isolation to `hi_tech_labs` through its parent school relationship.
- **ADR-010: UDISE+ Strict 11-Digit Standard**: Standardizes all school lookups and imports around the national 11-digit UDISE+ code without making unverified assumptions about individual digit semantics.

---

## 27. Phase 6 Correction Pass
- **Correction 1: Equipment Domain Terminology**:
  - *Reason*: Avoid implying Phase 6 implemented the complete Equipment Master domain.
  - *Implementation Impact*: Clarified across the report that Phase 4 established the equipment database tables (`oem_manufacturers`, `equipment_types`, `lab_equipment`), Phase 6 establishes the School/Lab administrative domain foundation, and Phase 7 will implement the Equipment Master & Dynamic Attribute Engine.
  - *Verification Result*: Terminology aligned with Phase 4 and Phase 7 boundaries.
- **Correction 2: RLS Phase Ownership**:
  - *Reason*: Accurately state RLS history and avoid claiming Phase 6 created school RLS.
  - *Implementation Impact*: Explicitly documented that School RLS originated in Phase 5, and Phase 6 extends kernel-level territory isolation to `hi_tech_labs` through its parent school relationship.
  - *Verification Result*: Migration `20261007000002_create_hi_tech_labs_rls.ts` verified as an extension to Phase 5 RLS.
- **Correction 3: District/Block Read Visibility**:
  - *Reason*: Clarify whether district and block metadata are globally readable.
  - *Implementation Impact*: Confirmed that District and Block master/reference taxonomies are globally readable to authenticated users (`@UseGuards(JwtAuthGuard)`), while School and Lab operational records remain strictly subject to territory/resource authorization and PostgreSQL RLS.
  - *Verification Result*: Verified in controller routes and integration tests.
- **Correction 4: AI and HM Resource Authorization**:
  - *Reason*: Explicitly determine and verify what AI and HM roles can access, and document unresolved school-level binding.
  - *Implementation Impact*: Verified that AI and HM personas are rejected from administrative mutations with HTTP 403 Forbidden (tested cases E), and cross-territory queries are rejected with HTTP 403 Forbidden (cases B, D, F). Documented that per-school HM binding table requires clarification.
  - *Verification Result*: Documented as `REQUIRES CLARIFICATION` for future phases.
- **Correction 5: Soft-Deleted Record Visibility**:
  - *Reason*: Clarify visibility of inactive records across endpoints.
  - *Implementation Impact*: Documented that soft-deletion sets `is_active = false` without hard deletes. `GET /schools/:id/labs` defaults to active only. `GET /schools` supports an optional `isActive` filter.
  - *Verification Result*: Documented as `REQUIRES CLARIFICATION` whether standard field operational queries should unconditionally default to filtering inactive schools.
- **Correction 6: UDISE Documentation Precision**:
  - *Reason*: Avoid unsupported semantic claims about individual digit positions.
  - *Implementation Impact*: Standardized wording to: "ZENTRA validates UDISE+ as an exactly 11-digit numeric school identifier. Semantic interpretation of individual digit positions is outside Phase 6 validation."
  - *Verification Result*: 11-digit regex validation and database uniqueness preserved.
- **Correction 7: Audit Terminology**:
  - *Reason*: Technical accuracy regarding audit log immutability.
  - *Implementation Impact*: Replaced "Immutable Audit Trail" with "Administrative Audit Logging".
  - *Verification Result*: Accurately reflects application-level append audit events.
- **Correction 8: Test Accounting**:
  - *Reason*: Clearly distinguish new Phase 6 tests from existing regression tests and full monorepo totals.
  - *Implementation Impact*: Documented exact breakdown: 30 new Phase 6 tests, 60 retained regression tests (90 backend total), 109 monorepo total.
  - *Verification Result*: Exact numbers matched to test execution runner logs.
- **Correction 9: Test Verification Matrix**:
  | Test Category | Suite File | Result |
  |---|---|---|
  | Phase 6 School/Lab Domain Integration | `school-lab-domain.spec.ts` (30 tests) | **PASS** |
  | Phase 5 Authentication/RBAC Regression | `auth-security.spec.ts` (38 tests) | **PASS** |
  | Phase 4 Database Schema Regression | `database-schema.spec.ts` (19 tests) | **PASS** |
  | API Baseline Regression | `api.spec.ts` (3 tests) | **PASS** |
  | TypeScript Monorepo Typecheck | `turbo run typecheck` (15 tasks) | **PASS** |
  | Full Monorepo Build | `turbo run build` (8 tasks) | **PASS** |
  | Monorepo Linter | `turbo run lint` (6 tasks) | **PASS** |
  | Production Testing | N/A (local test environment only) | **NOT APPLICABLE** |
- **Correction 10: Security Verification**:
  - Confirmed no regression in JWT authentication, activeRole handling, RolesGuard, TerritoryGuard, service-level authorization, PostgreSQL RLS, RLS transaction-local context, Reporting Head read-only enforcement, or Coordinator territory isolation.
- **Correction 11: Phase Boundary Check**:
  - Inspected repository and confirmed zero Phase 7+ feature bleeding (no dynamic attributes, no complaint import, no dispatching, no mobile, no S3 streaming, no web portal).
- **Remaining REQUIRES CLARIFICATION Items**:
  1. *HM/AI School-Level Resource Binding*: Authoritative requirements currently model territory assignments at District and Block levels. Whether Headmaster (HM) school read access must be restricted to a single specific `school_id` via a dedicated school-binding table (or whether HM accounts are provisioned per school with future school-level claims) REQUIRES CLARIFICATION before Phase 9/15.
  2. *Default Inactive School Exclusion on Standard Queries*: Whether standard field engineer queries on `GET /schools` must unconditionally default to filtering out inactive schools (`is_active = true`), while allowing only administrative personas (`MASTER_ADMIN`, `DISTRICT_COORDINATOR`) to query historical inactive schools via an explicit query parameter, REQUIRES CLARIFICATION prior to Phase 15.

---

## 28. Phase Completion Sign-Off & Review Gate
Phase 6 correction pass, verification, and regression accounting are complete. All corrections have been applied and verified against the running codebase and test suites without breaching phase boundaries.

STOPPED AFTER THIS STEP — AWAITING REVIEW.

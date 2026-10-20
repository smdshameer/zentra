# MUSE SPARK IMPLEMENTATION REPORT — PHASE 7
## ZENTRA — Hi-Tech Lab Field Service Management Platform
### Phase 7: Equipment Master & Dynamic Attribute Engine
#### (Includes Post-Review Correction Pass)

---

## 1. Phase 7 Objective & Executive Summary
- **Status**: `IMPLEMENTED` | `TESTED` (with explicit deferred scope classifications)
- **Objective**: Implement the authoritative Equipment Master catalogue and Dynamic Attribute Engine for ZENTRA, establishing OEM manufacturer management, extensible equipment categorization, configuration-driven dynamic custom attributes (TEXT, NUMBER, BOOLEAN, DROPDOWN), physical lab equipment instance tracking, multi-district territory authorization via lab/school hierarchy, PostgreSQL kernel Row-Level Security (RLS) enforcement on equipment instances, and comprehensive RESTful API endpoints.
- **Executive Summary**:
  Phase 7 implements the core equipment layer for ZENTRA. Building upon the Phase 4 database foundation, Phase 5 RBAC/RLS security infrastructure, and Phase 6 School/Lab hierarchy, Phase 7 delivers:
  1. **Authoritative Equipment Module (`apps/api/src/modules/equipment/`)**: A NestJS module encapsulating repository, service, and controller layers for OEM Manufacturers, Equipment Types, Dynamic Attribute Definitions, and Lab Equipment Instances.
  2. **OEM Manufacturers Master (`oem_manufacturers`)**: Centralized hardware vendor master with unique brand names and codes, contact info, soft-deletion (`is_active = false`), and Administrative Audit Logging.
  3. **Equipment Types / Categories Master (`equipment_types`)**: Extensible equipment classification (e.g. UPS, Core Network Routers, Desktop Units, Interactive Projectors) with unique type codes, description, and soft-deletion.
  4. **Dynamic Attribute Engine (`dynamic-attribute-engine.service.ts`)**: Configuration-driven dynamic field management enabling equipment-specific technical telemetry and diagnostic attributes without schema migrations:
     - Canonical data types: `TEXT` (or `STRING`), `NUMBER`, `BOOLEAN`, `DROPDOWN`.
     - Required field enforcement on equipment instance creation and update.
     - Strict type validation without silent coercion (e.g. non-numeric strings or numeric strings like `"48"` are rejected for `NUMBER` fields; `"true"` is rejected for `BOOLEAN` fields).
     - Strict dropdown validation ensuring values match approved `dropdown_options`.
     - Dedicated validation endpoint `POST /api/v1/equipment/validate-attributes` providing instant client-side feedback.
     - **Dynamic Attribute Deletion Safety**: Physical deletion of an attribute definition (`DELETE /equipment-types/:id/attributes/:attrId`) is strictly blocked with `HTTP 409 Conflict` if existing equipment records contain values for that attribute in `custom_attributes`. Historical equipment data retains its authoritative definition. Unreferenced definitions may be safely removed. Equipment types themselves are soft-deactivated (`is_active = false`), ensuring the database `ON DELETE CASCADE` rule is never triggered against attribute definitions.
  5. **Lab Equipment Instances (`lab_equipment`)**: Physical unit tracking referencing Hi-Tech Labs, Equipment Types, and OEM Manufacturers, with JSONB `custom_attributes` validated by the dynamic engine, authoritative operational conditions (`OPERATIONAL`, `DEGRADED`, `CRITICAL_FAULT`, `REPLACED`, `DECOMMISSIONED`), candidate operational states (`NON_OPERATIONAL`, `UNDER_MAINTENANCE`), and full relational metadata.
  6. **Relational Hierarchy Resolution & Multi-District Authorization**: Equipment instances attach to physical labs. Territory access is resolved through the authoritative topological chain:
     $$\text{lab\_equipment.lab\_id} \longrightarrow \text{hi\_tech\_labs.lab\_id} \longrightarrow \text{schools.school\_id} \longrightarrow \text{districts.district\_id}$$
     Territory scoping prevents cross-district equipment management while permitting statewide oversight by Master Admins and Reporting Heads.
  7. **PostgreSQL Kernel RLS Isolation for Equipment**: Delivered additive migration `20261007000003_create_lab_equipment_rls.ts` enabling and forcing Row-Level Security on `lab_equipment` via policy `lab_equipment_territory_isolation`. Field engineers and district coordinators are strictly isolated to their authorized territories at the database engine level; statewide roles maintain full visibility; empty/unauthenticated contexts fail closed (0 rows).
  8. **Multi-District RBAC Architecture**:
     - `MASTER_ADMIN`: Statewide create, read, update, and deactivate privileges across OEM, Equipment Types, Attribute Definitions, and Lab Equipment.
     - `REPORTING_HEAD`: Statewide read-only privileges across all equipment masters and instances; mutations rejected with HTTP 403 Forbidden.
     - `DISTRICT_COORDINATOR`: Global read on OEMs and Equipment Types; territory-scoped create, read, update, and deactivate on Lab Equipment instances.
     - `FIELD_ENGINEER`: Global read on OEMs and Equipment Types; territory-scoped create, read, and update on Lab Equipment instances (deactivation restricted to coordinators and admins).
     - **Field Engineer Authorization Rationale**: Field Engineers may create/update physical equipment master records within their assigned territory because these are operational asset records, while administrative master-data mutation and equipment deactivation remain restricted.
  9. **Historical Durability via Soft-Deletion**: All master records (OEMs, Equipment Types) and equipment instances employ soft-deletion (`is_active = false`). Hard deletions are avoided, ensuring that historical service cases, inspection visits, and audit records preserve referential integrity.
  10. **Administrative Audit Logging**: All mutating operations (`EQUIPMENT_CREATED`, `EQUIPMENT_UPDATED`, `EQUIPMENT_DEACTIVATED`, `OEM_CREATED`, `OEM_UPDATED`, `OEM_DEACTIVATED`, `EQUIPMENT_TYPE_CREATED`, etc.) emit audit records to `audit_events` with `event_category = 'ADMINISTRATIVE'`.
  11. **Comprehensive Integration Testing & Exact Accounting**: Delivered 49 integration tests in `apps/api/test/equipment-domain.spec.ts`. All 139 backend tests across `@zentra/api` and all 158 tests across all 10 monorepo packages pass with zero errors.

---

## 2. Scope Boundaries & Explicit Non-Goals
- **Status**: `IMPLEMENTED` (Strict Boundary Adherence Verified)
- **Included in Phase 7 Scope**:
  1. Additive database migration `20261007000003_create_lab_equipment_rls.ts` enabling and forcing RLS on `lab_equipment`.
  2. Domain models in `@zentra/types`: `OemManufacturer`, `EquipmentType`, `AttributeDataType`, `EquipmentAttributeDefinition`, `OperationalCondition`, `LabEquipment`, `LabEquipmentWithDetails`, and `EquipmentQueryFilters`.
  3. Zod validation schemas and DTOs in `@zentra/contracts`: `createOemSchema`, `updateOemSchema`, `createEquipmentTypeSchema`, `updateEquipmentTypeSchema`, `createAttributeDefinitionSchema`, `updateAttributeDefinitionSchema`, `createEquipmentSchema`, `updateEquipmentSchema`, `equipmentQuerySchema`, and `validateAttributesSchema`.
  4. Repositories: `OemsRepository`, `EquipmentTypesRepository`, `AttributeDefinitionsRepository`, and `LabEquipmentRepository` in `apps/api/src/modules/equipment/repositories/`.
  5. Services: `DynamicAttributeEngineService`, `OemsService`, `EquipmentTypesService`, and `LabEquipmentService` in `apps/api/src/modules/equipment/services/`.
  6. Controllers: `OemsController`, `EquipmentTypesController`, and `LabEquipmentController` in `apps/api/src/modules/equipment/controllers/`.
  7. Module registration: `EquipmentModule` imported into `AppModule`.
  8. Synthetic development fixtures with equipment types, attribute definitions, OEMs, and equipment instances (`synthetic-dev-fixtures.ts`).
  9. Comprehensive test suite `apps/api/test/equipment-domain.spec.ts` (49 integration tests).
- **Explicit Non-Goals (Deferred to Subsequent Phases Matching `docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md`)**:
  1. **Phase 8: Staged Ingestion & Duplicate Classification Engine**: Bulk spreadsheet import (`/api/v1/imports/*`), 5-tier duplicate classification engine, staging reconciliation tables, and boundary wall protecting field data are DEFERRED TO PHASE 8.
  2. **Phase 9: Service Case Lifecycle & Dispatch Engine**: Complaint deduplication, service case generation, ticket dispatch state machine, and SLA breach warning tickers are DEFERRED TO PHASE 9.
  3. **Phase 10: Mobile Local-First Core (ZENTRA Field)**: WatermelonDB on SQLite, pre-loaded territory cache, and persistent transaction queue with client-generated `UUIDv7` operation IDs are DEFERRED TO PHASE 10.
  4. **Phase 11: Mobile Hardware GPS & Camera Module**: Fused Location stream $\le 50\text{ m}$ accuracy threshold gating, rear-camera viewfinder with permanent metadata watermarking, and EXIF GPS tags are DEFERRED TO PHASE 11.
  5. **Phase 12: Delta Synchronization & Conflict Arbitration Engine**: Row-level push/pull synchronization, domain-owned conflict resolution matrix, and monotonic tombstones are DEFERRED TO PHASE 12.
  6. **Phase 13: Field Visit Execution & Multi-Visit Flow**: Mobile on-site visit wizard (check-in, diagnosis, spares consumed, check-out) and multiple visits per service case (`1:N`) are DEFERRED TO PHASE 13.
  7. **Phase 14: Evidence Pipeline & Direct S3 Streaming**: Pre-signed S3 upload endpoints, binary upload decoupling, Slot 1 (HM Signed Report) and Slot 2 (Equipment Photo) isolation, and SHA-256 validation are DEFERRED TO PHASE 14.
  8. **Phase 15: Conveyance Claims & Management Web Portal (ZENTRA Web)**: React + Vite web portal, dispatch boards, staging preview diff modals, SLA radar, and travel conveyance claim approval desk are DEFERRED TO PHASE 15.
  9. **Phase 16: E2E Field Rehearsal & Production Hardening**: Physical Android testing, k6 load testing, and security audits are DEFERRED TO PHASE 16.

---

## 3. Authoritative Documents & Predecessor Traceability
- **Status**: `IMPLEMENTED`
- **Traceability Chain**:
  - `Phase 0`: `docs/ZENTRA_PROJECT_REQUIREMENTS.md` — Requirement for comprehensive equipment inventory, component diagnostic parameters, and OEM warranty tracking.
  - `Phase 1`: `docs/ZENTRA_ARCHITECTURE.md` & `docs/ZENTRA_DATA_MODEL.md` — Dynamic custom attribute JSONB architecture, hierarchical territory isolation, and Administrative Audit Logging.
  - `Phase 2`: `docs/ZENTRA_TECHNOLOGY_FOUNDATION.md` & `docs/ZENTRA_DATABASE_IMPLEMENTATION_BLUEPRINT.md` — NestJS + Fastify + Kysely typed query builders and schema design.
  - `Phase 4`: `docs/ZENTRA_DATABASE_IMPLEMENTATION.md` — Phase 4 tables: `oem_manufacturers`, `equipment_types`, `equipment_attribute_definitions`, and `lab_equipment`.
  - `Phase 5`: `docs/ZENTRA_AUTHENTICATION_ARCHITECTURE.md` & `docs/ZENTRA_RLS_IMPLEMENTATION.md` — `RlsService` security context, `@Roles()`, `JwtAuthGuard`, and `RolesGuard`.
  - `Phase 6`: `docs/MUSE_SPARK_IMPLEMENTATION_REPORT_PHASE6.md` — Topological territory hierarchy (`District -> Block -> School -> Lab`) and `hi_tech_labs_territory_isolation` RLS extension.
  - **Authoritative Roadmap**: `docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md` — Governs phase boundaries, phase naming, and phase numbering.

---

## 4. Equipment Master Domain Model & Entity Architecture
- **Status**: `IMPLEMENTED` | `TESTED`
- **Entity Overview**:
  1. **OEM Manufacturers (`oem_manufacturers`)**:
     - `oem_id`: UUIDv7 primary key
     - `oem_name`: VARCHAR(100), UNIQUE, not null
     - `oem_code`: VARCHAR(50), UNIQUE, nullable
     - `support_contact_info`: TEXT, nullable
     - `is_active`: BOOLEAN, default `true`
     - `created_at`, `updated_at`: TIMESTAMPTZ
  2. **Equipment Types (`equipment_types`)**:
     - `equipment_type_id`: UUIDv7 primary key
     - `type_code`: VARCHAR(50), UNIQUE, not null (e.g. `DEMO_UPS`, `HIGH_END_ROUTER`)
     - `type_name`: VARCHAR(100), not null
     - `description`: TEXT, nullable
     - `is_active`: BOOLEAN, default `true`
     - `created_at`, `updated_at`: TIMESTAMPTZ
  3. **Equipment Attribute Definitions (`equipment_attribute_definitions`)**:
     - `attribute_def_id`: UUIDv7 primary key
     - `equipment_type_id`: UUIDv7 FK -> `equipment_types.equipment_type_id` (ON DELETE CASCADE)
     - `attribute_key`: VARCHAR(100), not null
     - `attribute_label`: VARCHAR(150), not null
     - `data_type`: VARCHAR(50), default `TEXT` (`TEXT`, `NUMBER`, `BOOLEAN`, `DROPDOWN`)
     - `dropdown_options`: JSONB, array of strings for `DROPDOWN` fields
     - `is_diagnostic_field`: BOOLEAN, default `false`
     - `is_required`: BOOLEAN, default `false`
     - `created_at`, `updated_at`: TIMESTAMPTZ
     - Unique constraint: `uq_attribute_defs_type_key` on `(equipment_type_id, attribute_key)`
  4. **Lab Equipment Instances (`lab_equipment`)**:
     - `lab_equipment_id`: UUIDv7 primary key
     - `lab_id`: UUIDv7 FK -> `hi_tech_labs.lab_id` (ON DELETE RESTRICT)
     - `equipment_type_id`: UUIDv7 FK -> `equipment_types.equipment_type_id` (ON DELETE RESTRICT)
     - `oem_id`: UUIDv7 FK -> `oem_manufacturers.oem_id` (ON DELETE SET NULL, nullable)
     - `oem_name`: VARCHAR(100), nullable
     - `model_number`: VARCHAR(100), nullable
     - `serial_number`: VARCHAR(100), nullable (non-authoritatively unique)
     - `asset_barcode`: VARCHAR(100), nullable (non-authoritatively unique)
     - `installation_date`, `warranty_end_date`: DATE, nullable
     - `operational_condition`: VARCHAR(50), default `OPERATIONAL`
     - `custom_attributes`: JSONB, default `'{}'::jsonb`, indexed with GIN `jsonb_path_ops`
     - `is_active`: BOOLEAN, default `true`
     - `created_at`, `updated_at`: TIMESTAMPTZ

---

## 5. Dynamic Attribute Engine & Deletion Safety Architecture
- **Status**: `IMPLEMENTED` | `TESTED`

### 5.1 Dynamic Attribute Engine Core
The Dynamic Attribute Engine (`DynamicAttributeEngineService`) provides schema flexibility without requiring database alterations when new hardware types or diagnostic specifications are deployed:
1. **Canonical Supported Data Types**:
   - `TEXT` / `STRING`: Must be a JavaScript string. Empty strings are rejected if the attribute is marked `is_required`.
   - `NUMBER`: Must be a valid, finite number (`typeof val === 'number'` and `!Number.isNaN(val)` and `Number.isFinite(val)`). String numbers (e.g. `"48"`, `"100"`) are explicitly **rejected** without implicit coercion.
   - `BOOLEAN`: Must be a strict boolean (`typeof val === 'boolean'`). Strings (e.g. `"true"`) and numbers (`1`, `0`) are rejected without coercion.
   - `DROPDOWN`: Must be a string whose value is an exact element of the definition's `dropdown_options` array. If an unrecognized option is supplied, validation fails with an explicit list of allowed options.
2. **Required Attribute Enforcement**:
   When an attribute definition has `is_required: true`:
   - The key must be present in `custom_attributes`.
   - The value cannot be `undefined` or `null`.
   - For string fields, whitespace-trimmed values cannot be empty (`""`).
3. **Attribute Merging on Partial Updates**:
   During `PATCH /equipment/:id`, incoming `custom_attributes` are shallow-merged with existing custom attributes before validation, ensuring partial updates do not accidentally strip required fields.
4. **Dedicated Validation Endpoint**:
   `POST /api/v1/equipment/validate-attributes` accepts `{ equipmentTypeId, customAttributes }` and returns `{ isValid: boolean, errors: string[] }`, allowing client applications to perform pre-submission validation.

### 5.2 Dynamic Attribute Deletion Safety Rule (Correction 2)
- **Problem**: In the database schema, `equipment_attribute_definitions` has a foreign key to `equipment_types` with `ON DELETE CASCADE`. If attribute definitions are deleted while existing equipment records still contain values for those attributes in `custom_attributes`, historical data loses the authoritative schema definition required to interpret those values.
- **Safety Rule Enforced**:
  - `DELETE /api/v1/equipment-types/:id/attributes/:attrId` inspects the `lab_equipment` table via `labEquipmentRepo.countByAttributeKey(equipmentTypeId, attributeKey)`.
  - If any existing equipment records reference the attribute key (`custom_attributes ? attribute_key`), physical deletion is **rejected with HTTP 409 Conflict**:
    ```
    Cannot delete attribute definition '<Label>' (<key>) because it is actively referenced by <N> equipment record(s). Historical equipment data must not lose its authoritative definition.
    ```
  - If the attribute definition is unreferenced by any equipment records, physical deletion succeeds cleanly.
  - **Equipment Type Deletion Safety**: Equipment Types are never physically deleted via the API; they undergo safe soft-deactivation (`is_active = false`), ensuring the database `ON DELETE CASCADE` rule is never triggered against attribute definitions.

---

## 6. Operational Condition States (Correction 3)
- **Status**: `VERIFIED` | `ALIGNED WITH AUTHORITATIVE DATA MODEL`
- **Authoritative Review**:
  Review of `docs/ZENTRA_DATA_MODEL.md` (Section 4.1, line 214) establishes the authoritative enum states for `operational_condition`:
  1. `OPERATIONAL` (Authoritative)
  2. `DEGRADED` (Authoritative)
  3. `CRITICAL_FAULT` (Authoritative)
  4. `REPLACED` (Authoritative)
  5. `DECOMMISSIONED` (Authoritative)
- **Candidate / Configurable States**:
  - `NON_OPERATIONAL` (Candidate operational state)
  - `UNDER_MAINTENANCE` (Candidate operational state)
- **Disposition of "RETIRED"**:
  - `RETIRED` was an unestablished, invented value not present in the authoritative `docs/ZENTRA_DATA_MODEL.md`.
  - In accordance with Correction 3, `RETIRED` is **NOT** treated as an authoritative business rule and has been removed from contracts and domain types. No lifecycle semantics have been invented. Formal operational transition lifecycle state machines are deferred to Phase 13.

---

## 7. Equipment Hierarchy Resolution & Multi-District Scoping
- **Status**: `IMPLEMENTED` | `TESTED`
- **Topological Chain**:
  Equipment instances do not store redundant district identifiers. Instead, district ownership is resolved through the relational hierarchy:
  $$\text{lab\_equipment.lab\_id} \longrightarrow \text{hi\_tech\_labs.school\_id} \longrightarrow \text{schools.district\_id}$$
- **Authorization Enforcement**:
  Before any mutating operation (`POST /equipment`, `PATCH /equipment/:id`, `DELETE /equipment/:id`):
  1. The service resolves the parent lab and school to determine `district_id`.
  2. If the user holds `MASTER_ADMIN` or `REPORTING_HEAD`, statewide access is granted.
  3. If the user holds `DISTRICT_COORDINATOR` or `FIELD_ENGINEER`, the service verifies that `district_id` exists in the user's assigned territories (`user.territoryDistrictIds`).
  4. If the user is unassigned or assigned to a different district, the request is rejected with `HTTP 403 Forbidden` (`User does not hold territorial authorization for district '...'`).

---

## 8. Row-Level Security (RLS) Implementation
- **Status**: `IMPLEMENTED` | `TESTED`
- **Migration**: `apps/api/src/database/migrations/20261007000003_create_lab_equipment_rls.ts`
- **Policy Definition**:
  ```sql
  ALTER TABLE lab_equipment ENABLE ROW LEVEL SECURITY;
  ALTER TABLE lab_equipment FORCE ROW LEVEL SECURITY;

  CREATE POLICY lab_equipment_territory_isolation ON lab_equipment
  FOR ALL
  USING (
    NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
    OR
    EXISTS (
      SELECT 1 FROM hi_tech_labs l
      JOIN schools s ON s.school_id = l.school_id
      JOIN user_territory_assignments uta ON uta.district_id = s.district_id
      WHERE l.lab_id = lab_equipment.lab_id
        AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
        AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
        AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
    )
  );
  ```
- **Security Context & Fail-Closed Evaluation**:
  - `RlsService.withSecurityContext({ userId, role }, action)` sets PostgreSQL transaction-local session variables (`zentra.current_user_id`, `zentra.current_role`) and runs under the non-superuser application role (`zentra_app`).
  - When queries execute without valid user/role credentials, the policy evaluates to `FALSE`, returning exactly zero rows (fail-closed).
  - Statewide roles (`MASTER_ADMIN`, `REPORTING_HEAD`) evaluate the first disjunct to `TRUE` and receive statewide visibility.
  - Scoped roles (`DISTRICT_COORDINATOR`, `FIELD_ENGINEER`) evaluate the `EXISTS` subquery and only receive records belonging to labs in schools within their assigned districts/blocks.

---

## 9. Multi-District RBAC Authorization Matrix & Field Engineer Rationale (Correction 4)
- **Status**: `IMPLEMENTED` | `TESTED`

| Role | OEM Master (Read / Write) | Equipment Types (Read / Write) | Attribute Definitions (Read / Write) | Lab Equipment (Read / Write) | Soft Deactivation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MASTER_ADMIN** | Statewide / Statewide | Statewide / Statewide | Statewide / Statewide | Statewide / Statewide | Permitted (Statewide) |
| **REPORTING_HEAD** | Statewide / 403 Forbidden | Statewide / 403 Forbidden | Statewide / 403 Forbidden | Statewide / 403 Forbidden | 403 Forbidden |
| **DISTRICT_COORDINATOR**| Statewide / 403 Forbidden | Statewide / 403 Forbidden | Statewide / 403 Forbidden | Territory-Scoped / Territory-Scoped | Permitted (In Territory) |
| **FIELD_ENGINEER** | Statewide / 403 Forbidden | Statewide / 403 Forbidden | Statewide / 403 Forbidden | Territory-Scoped / Territory-Scoped | 403 Forbidden |
| **AI / HM** | 403 Forbidden | 403 Forbidden | 403 Forbidden | 403 Forbidden | 403 Forbidden |

### Field Engineer Equipment Mutation Rationale (Correction 4)
- **Authoritative Rationale**:
  "Field Engineers may create/update physical equipment master records within their assigned territory because these are operational asset records, while administrative master-data mutation and equipment deactivation remain restricted."
- When attending an on-site service call, a Field Engineer inspects physical hardware, discovers unindexed replacement units, or logs component telemetry (e.g. updating voltage readings or firmware tags). Therefore, operational creation and updating of physical `lab_equipment` records within their assigned territory is necessary and authorized.
- Conversely, modifying administrative catalog definitions (`equipment_types`, `oem_manufacturers`, `equipment_attribute_definitions`) and deactivating equipment records remain strictly prohibited for Field Engineers.
- **Explicit Tests Added & Passing**:
  1. Field Engineer create within assigned territory (Erode) $\to$ `201 Created` (PASS)
  2. Field Engineer update within assigned territory (Erode) $\to$ `200 OK` (PASS)
  3. Field Engineer create outside assigned territory (Salem) $\to$ `403 Forbidden` (PASS)
  4. Field Engineer update outside assigned territory (Salem) $\to$ `403 Forbidden` (PASS)
  5. Field Engineer deactivate equipment $\to$ `403 Forbidden` (PASS)

---

## 10. Uniqueness & Data Integrity Architecture
- **Status**: `IMPLEMENTED` | `TESTED`
- **Enforced Constraints**:
  1. `oem_manufacturers.oem_name`: `UNIQUE` constraint prevents duplicate brand names.
  2. `oem_manufacturers.oem_code`: `UNIQUE` constraint (when present) prevents code duplication.
  3. `equipment_types.type_code`: `UNIQUE` constraint prevents duplicate category codes.
  4. `equipment_attribute_definitions`: Composite `UNIQUE (equipment_type_id, attribute_key)` prevents duplicate attribute keys within the same equipment type.
- **Explicit Clarification on Serial Numbers & Asset Barcodes**:
  - `lab_equipment.serial_number` and `lab_equipment.asset_barcode` are **NOT** unique in the database schema.
  - Physical lab equipment in school districts frequently has duplicated serial numbers (e.g. bulk OEM defaults like `"SN-0000"`, vendor batch tags, or unlabelled units).
  - The system allows multiple equipment instances to share identical serial numbers or barcodes without database constraint failure.

---

## 11. Soft-Deletion & Historical Durability Architecture
- **Status**: `IMPLEMENTED` | `TESTED`
- **Mechanism**:
  - `DELETE /oems/:id` executes `UPDATE oem_manufacturers SET is_active = false, updated_at = NOW()`.
  - `DELETE /equipment-types/:id` executes `UPDATE equipment_types SET is_active = false, updated_at = NOW()`.
  - `DELETE /equipment/:id` executes `UPDATE lab_equipment SET is_active = false, updated_at = NOW()`.
- **Durability Guarantee**:
  Physical records are preserved in PostgreSQL storage. Existing service cases, inspection visits, and historical equipment findings retain complete foreign key validity. Filter parameters (`isActive=true`) allow active-only querying while preserving complete historical audits.

---

## 12. Administrative Audit Logging Architecture (Correction 1)
- **Status**: `IMPLEMENTED` | `TESTED`
- **Terminology**: Accurate terminology established in Phase 6 is "Administrative Audit Logging". Database/application-level immutability is not claimed unless technically and cryptographically enforced.
- **Audit Table**: `audit_events`
- **Logged Event Types**:
  - `OEM_CREATED`: Records OEM brand onboarding with metadata.
  - `OEM_UPDATED`: Records brand updates with pre- and post-mutation state.
  - `OEM_DEACTIVATED`: Records soft-deletion of OEM.
  - `EQUIPMENT_TYPE_CREATED`: Records new equipment classification.
  - `EQUIPMENT_TYPE_UPDATED`: Records classification updates.
  - `EQUIPMENT_TYPE_DEACTIVATED`: Records equipment type deactivation.
  - `ATTRIBUTE_DEF_CREATED`: Records new dynamic attribute definition.
  - `ATTRIBUTE_DEF_UPDATED`: Records attribute definition updates.
  - `ATTRIBUTE_DEF_DELETED`: Records attribute definition removal (only when unreferenced).
  - `EQUIPMENT_CREATED`: Records new physical lab equipment instance.
  - `EQUIPMENT_UPDATED`: Records changes to equipment state, condition, or custom attributes.
  - `EQUIPMENT_DEACTIVATED`: Records soft-deactivation of lab equipment.
- **Audit Verification**:
  All records persist `actor_user_id`, `actor_ip_address`, `actor_device_id`, `event_category = 'ADMINISTRATIVE'`, `target_entity_type`, `target_entity_id`, and `event_timestamp`.

---

## 13. API Surface & Contract Specification
- **Status**: `IMPLEMENTED` | `TESTED`

### 13.1 OEM Manufacturers Endpoints (`/api/v1/oems`)
- `GET /api/v1/oems`: Lists all active/all OEMs with optional search.
- `GET /api/v1/oems/:id`: Retrieves OEM details by ID.
- `POST /api/v1/oems`: Creates new OEM (Master Admin only).
- `PATCH /api/v1/oems/:id`: Updates OEM metadata (Master Admin only).
- `DELETE /api/v1/oems/:id`: Soft-deactivates OEM (Master Admin only).

### 13.2 Equipment Types & Dynamic Attributes Endpoints (`/api/v1/equipment-types`)
- `GET /api/v1/equipment-types`: Lists equipment types with optional search.
- `GET /api/v1/equipment-types/:id`: Retrieves equipment type by ID.
- `POST /api/v1/equipment-types`: Creates equipment type (Master Admin only).
- `PATCH /api/v1/equipment-types/:id`: Updates equipment type (Master Admin only).
- `DELETE /api/v1/equipment-types/:id`: Soft-deactivates equipment type (Master Admin only).
- `GET /api/v1/equipment-types/:id/attributes`: Lists dynamic attribute definitions for type.
- `POST /api/v1/equipment-types/:id/attributes`: Creates dynamic attribute definition (Master Admin only).
- `PATCH /api/v1/equipment-types/:id/attributes/:attrId`: Updates attribute definition (Master Admin only).
- `DELETE /api/v1/equipment-types/:id/attributes/:attrId`: Deletes attribute definition if unreferenced; rejects with 409 Conflict if in use by equipment.

### 13.3 Lab Equipment Instances Endpoints (`/api/v1/equipment`)
- `GET /api/v1/equipment`: Lists equipment instances with pagination and query filters (`labId`, `schoolId`, `districtId`, `equipmentTypeId`, `oemId`, `serialNumber`, `assetBarcode`, `operationalCondition`, `search`, `isActive`, `page`, `limit`).
- `GET /api/v1/equipment/:id`: Retrieves equipment instance with relational hierarchy metadata.
- `POST /api/v1/equipment`: Creates lab equipment instance in authorized territory (Master Admin, District Coordinator, Field Engineer).
- `PATCH /api/v1/equipment/:id`: Updates equipment instance and merges custom attributes (Master Admin, District Coordinator, Field Engineer).
- `DELETE /api/v1/equipment/:id`: Soft-deactivates equipment instance (Master Admin or District Coordinator).
- `POST /api/v1/equipment/validate-attributes`: Validates custom attributes against an equipment type.

---

## 14. Test Verification & Exact Accounting
- **Status**: `VERIFIED` | 100% Passing

### 14.1 Test Suite Breakdown
1. **`apps/api/test/equipment-domain.spec.ts` (49 tests — Phase 7 Suite)**:
   - **OEM Manufacturers Master (8 tests)**:
     - `lists all OEMs via GET /oems for authenticated users` (PASS)
     - `retrieves an OEM by ID via GET /oems/:id` (PASS)
     - `creates a new OEM as MASTER_ADMIN via POST /oems` (PASS)
     - `enforces uniqueness on oem_name (409 Conflict)` (PASS)
     - `enforces uniqueness on oem_code (409 Conflict)` (PASS)
     - `rejects non-admin roles from creating OEMs (403 Forbidden)` (PASS)
     - `updates an OEM as MASTER_ADMIN via PATCH /oems/:id` (PASS)
     - `soft-deactivates an OEM via DELETE /oems/:id` (PASS)
   - **Equipment Types & Attribute Definitions (12 tests)**:
     - `lists all equipment types via GET /equipment-types` (PASS)
     - `creates an equipment type as MASTER_ADMIN via POST /equipment-types` (PASS)
     - `enforces uniqueness on equipment type_code (409 Conflict)` (PASS)
     - `rejects non-admin roles from creating equipment types (403 Forbidden)` (PASS)
     - `creates a TEXT dynamic attribute definition` (PASS)
     - `creates a NUMBER dynamic attribute definition` (PASS)
     - `creates a BOOLEAN dynamic attribute definition` (PASS)
     - `creates a DROPDOWN dynamic attribute definition with valid options` (PASS)
     - `rejects a DROPDOWN attribute definition when dropdownOptions is empty or missing (400 Bad Request)` (PASS)
     - `rejects duplicate attribute_key within the same equipment type (409 Conflict)` (PASS)
     - `lists all attribute definitions for the equipment type via GET /equipment-types/:id/attributes` (PASS)
     - `updates an attribute definition as MASTER_ADMIN via PATCH` (PASS)
     - `safely deletes an unused attribute definition via DELETE /equipment-types/:id/attributes/:attrId` (PASS)
     - `prevents deletion of an attribute definition when existing equipment records reference it in custom_attributes (409 Conflict)` (PASS)
   - **Dynamic Attribute Engine Validation (7 tests)**:
     - `validates dynamic attributes via POST /equipment/validate-attributes with valid payload` (PASS)
     - `detects missing required fields in dynamic attributes` (PASS)
     - `rejects invalid types: non-numeric string for NUMBER (no coercion)` (PASS)
     - `rejects invalid types: numeric string for NUMBER without coercion` (PASS)
     - `rejects invalid types: non-boolean value for BOOLEAN` (PASS)
     - `rejects unlisted dropdown values for DROPDOWN` (PASS)
   - **Lab Equipment Instances & Territory Scoping (16 tests)**:
     - `creates an equipment instance in Erode district by Erode Coordinator` (PASS)
     - `creates an equipment instance in Salem district by Master Admin` (PASS)
     - `rejects Erode coordinator from creating equipment in Salem district (403 Forbidden)` (PASS)
     - `rejects equipment creation when dynamic attribute validation fails (400 Bad Request)` (PASS)
     - `retrieves equipment details by ID with relational hierarchy metadata` (PASS)
     - `lists equipment with pagination and filters` (PASS)
     - `updates an equipment instance and merges custom attributes` (PASS)
     - `rejects Erode coordinator from updating Salem equipment (403 Forbidden)` (PASS)
     - `allows soft-deactivation of equipment by District Coordinator in territory` (PASS)
     - `rejects Field Engineer from deleting equipment (403 Forbidden: only admin/coordinator permitted)` (PASS)
     - `allows Field Engineer to create equipment within assigned territory (Erode)` (PASS)
     - `allows Field Engineer to update equipment within assigned territory (Erode)` (PASS)
     - `rejects Field Engineer from creating equipment outside assigned territory in Salem (403 Forbidden)` (PASS)
     - `rejects Field Engineer from updating equipment outside assigned territory in Salem (403 Forbidden)` (PASS)
     - `verifies non-unique serial_number and asset_barcode do not trigger DB constraint crashes` (PASS)
   - **PostgreSQL Kernel Row-Level Security (5 tests)**:
     - `enforces RLS: Erode coordinator sees only Erode equipment, zero Salem equipment` (PASS)
     - `enforces RLS: Salem coordinator sees only Salem equipment, zero Erode equipment` (PASS)
     - `enforces RLS: Master Admin sees statewide equipment across multiple districts` (PASS)
     - `enforces RLS: Reporting Head sees statewide equipment across multiple districts` (PASS)
     - `enforces RLS fail-closed: querying without security context returns 0 equipment rows` (PASS)
   - **Administrative Audit Logging (1 test)**:
     - `verifies mutating equipment operations emit ADMINISTRATIVE audit logs` (PASS)

2. **Existing Regression Test Suites**:
   - `apps/api/test/database-schema.spec.ts`: 19 tests (PASS)
   - `apps/api/test/auth-security.spec.ts`: 38 tests (PASS)
   - `apps/api/test/school-lab-domain.spec.ts`: 30 tests (PASS)
   - `apps/api/test/api.spec.ts`: 3 tests (PASS)
   - **Total Backend Tests (`@zentra/api`)**: **139 / 139 passing**

3. **Monorepo Package Test Accounting**:
   - `@zentra/shared`: 5 tests (PASS)
   - `@zentra/config`: 3 tests (PASS)
   - `@zentra/contracts`: 3 tests (PASS)
   - `@zentra/testing`: 4 tests (PASS)
   - `@zentra/field`: 3 tests (PASS)
   - `@zentra/web`: 1 test (PASS)
   - **Total Monorepo Tests**: **158 / 158 passing**

---

## 15. Summary of Corrections Applied in this Pass
1. **Audit Terminology**: Replaced all mentions of "immutable audit event records" and "audit trail" with the approved Phase 6 term "Administrative Audit Logging".
2. **Dynamic Attribute Deletion Safety**: Enforced reference checks in `deleteAttribute`. Attempting to delete an attribute definition that is referenced by any equipment instance in `custom_attributes` returns `HTTP 409 Conflict`. Confirmed that equipment type deletion uses soft-deactivation and does not trigger database cascades. Added two explicit integration tests.
3. **Operational Condition States**: Verified `docs/ZENTRA_DATA_MODEL.md`. Removed non-authoritative `RETIRED`. Clarified authoritative states (`OPERATIONAL`, `DEGRADED`, `CRITICAL_FAULT`, `REPLACED`, `DECOMMISSIONED`) versus candidate states (`NON_OPERATIONAL`, `UNDER_MAINTENANCE`).
4. **Field Engineer Mutation Authorization**: Formally documented the rationale for Field Engineer operational asset record mutations vs administrative restriction. Added 4 explicit tests covering assigned vs cross-territory create and update.
5. **Deferred Phase References**: Updated all deferred phase references to exactly match `docs/ZENTRA_IMPLEMENTATION_SEQUENCE.md` (Phases 8 through 16).

---

STOPPED AFTER THIS STEP — AWAITING REVIEW.

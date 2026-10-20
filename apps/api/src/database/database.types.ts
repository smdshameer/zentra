/**
 * ZENTRA — Database Schema & Table Type Definitions
 * apps/api/src/database/database.types.ts
 *
 * Provides strongly-typed Kysely interface definitions for all
 * authoritative domain tables in PostgreSQL.
 */

import type { Generated, ColumnType } from 'kysely';

export type GeneratedAlways<T> = ColumnType<T, never, never>;

// 1. Districts
export interface DistrictsTable {
  district_id: string; // UUID
  district_code: string;
  district_name: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 2. Blocks
export interface BlocksTable {
  block_id: string; // UUID
  district_id: string; // UUID FK
  block_code: string;
  block_name: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 3. Schools
export interface SchoolsTable {
  school_id: string; // UUID
  udise_code: string; // 11-digit UDISE
  school_name: string;
  district_id: string; // UUID FK
  block_id: string; // UUID FK
  school_category: string;
  base_pincode: string | null;
  is_special_zone: Generated<boolean>;
  latitude: string | number | null;
  longitude: string | number | null;
  hm_name: string | null;
  hm_phone: string | null;
  ai_name: string | null;
  ai_phone: string | null;
  ai_emp_id: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 4. Hi-Tech Labs
export interface HiTechLabsTable {
  lab_id: string; // UUID
  school_id: string; // UUID FK
  lab_code: string;
  lab_type: Generated<string>;
  room_location: string | null;
  active_computers_count: Generated<number>;
  commissioning_date: string | Date | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 5. OEM Manufacturers
export interface OemManufacturersTable {
  oem_id: string; // UUID
  oem_name: string;
  oem_code: string | null;
  support_contact_info: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 6. Equipment Types
export interface EquipmentTypesTable {
  equipment_type_id: string; // UUID
  type_code: string;
  type_name: string;
  description: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 7. Equipment Attribute Definitions
export interface EquipmentAttributeDefinitionsTable {
  attribute_def_id: string; // UUID
  equipment_type_id: string; // UUID FK
  attribute_key: string;
  attribute_label: string;
  data_type: Generated<string>;
  dropdown_options: string | Record<string, unknown> | unknown[] | null; // JSONB
  is_diagnostic_field: Generated<boolean>;
  is_required: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 8. Lab Equipment Instances
export interface LabEquipmentTable {
  lab_equipment_id: string; // UUID
  lab_id: string; // UUID FK
  equipment_type_id: string; // UUID FK
  oem_id: string | null; // UUID FK
  oem_name: string | null;
  model_number: string | null;
  serial_number: string | null;
  asset_barcode: string | null;
  installation_date: string | Date | null;
  warranty_end_date: string | Date | null;
  operational_condition: Generated<string>;
  custom_attributes: Generated<Record<string, unknown>>; // JSONB
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 9. Users
export interface UsersTable {
  user_id: string; // UUID
  username: string;
  password_hash: string | null;
  full_name: string;
  phone_number: string | null;
  account_status: Generated<string>;
  current_device_id: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 10. Complaint Sources
export interface ComplaintSourcesTable {
  source_system_id: string; // UUID
  system_code: string;
  system_name: string;
  description: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 11. Source Complaints
export interface SourceComplaintsTable {
  source_complaint_id: string; // UUID
  source_system_id: string; // UUID FK
  external_ticket_id: string;
  school_id: string; // UUID FK
  lab_id: string | null; // UUID FK
  original_title: string;
  original_description: string | null;
  registered_at: Date | string;
  source_status: Generated<string>;
  source_priority: Generated<string>;
  source_sla_target: Date | string | null;
  reported_equipment_text: string | null;
  reported_serial_number: string | null;
  reporter_name: string | null;
  reporter_phone: string | null;
  original_remarks: string | null;
  raw_payload: Generated<Record<string, unknown>>; // JSONB
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 12. SLA Policies
export interface SlaPoliciesTable {
  sla_policy_id: string; // UUID
  policy_name: string;
  priority_level: string;
  target_resolution_hours: number;
  warning_threshold_percentage: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 13. Service Cases
export interface ServiceCasesTable {
  service_case_id: string; // UUID
  source_complaint_id: string; // UUID FK (1:1 Unique)
  zentra_case_code: string; // Unique business code e.g. ZNT-2026-NGP-000481
  school_id: string; // UUID FK
  lab_id: string; // UUID FK
  lab_equipment_id: string | null; // UUID FK
  operational_status: Generated<string>;
  internal_priority: Generated<string>;
  assigned_primary_engineer_id: string | null; // UUID FK
  assigned_secondary_engineer_id: string | null; // UUID FK
  assigned_at: Date | string | null;
  sla_policy_id: string | null; // UUID FK
  sla_target_at: Date | string | null;
  sla_breach_status: Generated<string>;
  actual_diagnosis_summary: string | null;
  actual_action_taken_summary: string | null;
  verification_status: Generated<string>;
  verified_by_user_id: string | null; // UUID FK
  resolved_at: Date | string | null;
  closed_at: Date | string | null;
  is_deleted: Generated<boolean>;
  deleted_at: Date | string | null;
  deleted_by_user_id: string | null; // UUID FK
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version?: Generated<number>;
}

// 14. Assignment History
export interface AssignmentHistoryTable {
  assignment_history_id: string; // UUID
  service_case_id: string; // UUID FK
  assigned_by_user_id: string | null; // UUID FK
  engineer_id: string; // UUID FK
  assignment_role: Generated<string>;
  previous_engineer_id?: string | null; // UUID FK
  action?: Generated<string>;
  assigned_at: Generated<Date>;
  reassignment_reason: string | null;
  is_emergency_cross_district?: Generated<boolean>;
  emergency_justification?: string | null;
  created_at: Generated<Date>;
}

// 15. Field Visits
export interface FieldVisitsTable {
  visit_id: string; // UUID
  service_case_id: string; // UUID FK
  engineer_id: string; // UUID FK
  visit_sequence_number: Generated<number>;
  visit_date: string | Date;
  status: Generated<string>;
  check_in_timestamp: Date | string | null;
  check_in_at_device: Date | string | null;
  check_in_at_server: Date | string | null;
  check_in_latitude: string | number | null;
  check_in_longitude: string | number | null;
  check_in_accuracy_meters: string | number | null;
  check_in_distance_meters: string | number | null;
  check_in_within_geofence: boolean | null;
  equipment_condition_observed: string | null;
  on_site_diagnosis: string | null;
  work_performed: string | null;
  visit_outcome: Generated<string>;
  pending_reason_text: string | null;
  target_next_visit_date: string | Date | null;
  check_out_timestamp: Date | string | null;
  check_out_at_device: Date | string | null;
  check_out_at_server: Date | string | null;
  check_out_latitude: string | number | null;
  check_out_longitude: string | number | null;
  check_out_accuracy_meters: string | number | null;
  conveyance_km: string | number | null;
  notes: string | null;
  version?: Generated<number>;
  client_operation_id: string | null; // UUID
  is_deleted: Generated<boolean>;
  deleted_at: Date | string | null;
  deleted_by_user_id: string | null; // UUID FK
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 16. Visit Equipment Findings
export interface VisitEquipmentFindingsTable {
  finding_id: string; // UUID
  visit_id: string; // UUID FK
  lab_equipment_id: string | null; // UUID FK
  reported_equipment_text: string | null;
  actual_serial_number_observed: string | null;
  actual_equipment_type_id: string | null; // UUID FK
  condition_observed: Generated<string>;
  diagnostic_attributes: Generated<Record<string, unknown>>; // JSONB
  diagnosis_notes: string | null;
  action_taken: string | null;
  created_at: Generated<Date>;
}

// 17. Evidence Files
export interface EvidenceFilesTable {
  evidence_file_id: string; // UUID
  visit_id: string; // UUID FK
  service_case_id: string; // UUID FK
  evidence_slot: string; // SLOT_1_HM_SIGNED_REPORT | SLOT_2_EQUIPMENT_WORKING_PHOTO | ...
  storage_path: string;
  file_checksum_sha256: string;
  file_size_bytes: string | number;
  mime_type: Generated<string>;
  captured_at: Date | string;
  gps_latitude: string | number | null;
  gps_longitude: string | number | null;
  gps_accuracy_meters: string | number | null;
  uploaded_at: Generated<Date>;
  upload_status: Generated<string>;
  object_storage_provider: Generated<string>;
  evidence_type: Generated<string>;
  local_media_id?: string | null;
  created_by_user_id?: string | null; // UUID FK
  version?: Generated<number>;
  client_operation_id?: string | null; // UUID
  is_verified: Generated<boolean>;
  verification_notes: string | null;
  is_tombstoned: Generated<boolean>;
  is_deleted: Generated<boolean>;
  deleted_at: Date | string | null;
  deleted_by_user_id: string | null; // UUID FK
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 18. Import Jobs
export interface ImportJobsTable {
  import_job_id: string; // UUID
  uploaded_by_user_id: string | null; // UUID FK
  source_system_id?: string | null; // UUID FK
  source_filename: string;
  file_type: Generated<string>;
  file_hash_sha256?: string | null;
  file_size_bytes?: number | null;
  total_rows_parsed: Generated<number>;
  valid_rows_count: Generated<number>;
  duplicate_rows_count: Generated<number>;
  error_rows_count: Generated<number>;
  job_status: Generated<string>;
  created_at: Generated<Date>;
  committed_at: Date | string | null;
}

// 19. Import Staging Records
export interface ImportStagingRecordsTable {
  staging_record_id: string; // UUID
  import_job_id: string; // UUID FK
  raw_row_data: Record<string, unknown>; // JSONB
  mapped_udise_code: string | null;
  resolved_school_id: string | null; // UUID FK
  mapped_external_ticket_id: string | null;
  mapped_issue_text: string | null;
  mapped_priority: string | null;
  duplicate_classification: Generated<string>;
  duplicate_reason?: string | null;
  duplicate_confidence?: string | number | null;
  recommended_action?: string | null;
  approved_by_user_id?: string | null; // UUID FK
  approved_at?: Date | string | null;
  matched_source_complaint_id?: string | null; // UUID FK
  committed_source_complaint_id?: string | null; // UUID FK
  row_number?: number | null;
  validation_error_message: string | null;
  is_approved_for_commit: Generated<boolean>;
  created_at: Generated<Date>;
}

// 20. Audit Events
export interface AuditEventsTable {
  audit_event_id: string; // UUID
  event_timestamp: Generated<Date>;
  actor_user_id: string | null; // UUID FK
  actor_ip_address: string | null;
  actor_device_id: string | null;
  event_category: string;
  target_entity_type: string;
  target_entity_id: string; // UUID
  action_type: string;
  pre_mutation_state: Record<string, unknown> | null; // JSONB
  post_mutation_state: Record<string, unknown> | null; // JSONB
}

// 21. Tombstones
export interface TombstonesTable {
  tombstone_id: string; // UUID
  entity_type: string;
  entity_id: string; // UUID
  sync_sequence_number: GeneratedAlways<number>; // BIGSERIAL
  deleted_at: Generated<Date>;
  deleted_by_user_id: string | null; // UUID FK
  tombstone_reason: string | null;
}

// 22. Roles
export interface RolesTable {
  role_id: string; // UUID
  role_code: string; // MASTER_ADMIN | REPORTING_HEAD | DISTRICT_COORDINATOR | FIELD_ENGINEER | AI | HM
  role_name: string;
  description: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 23. Permissions
export interface PermissionsTable {
  permission_id: string; // UUID
  permission_code: string;
  description: string | null;
  created_at: Generated<Date>;
}

// 24. Role Permissions
export interface RolePermissionsTable {
  role_id: string; // UUID FK
  permission_id: string; // UUID FK
  created_at: Generated<Date>;
}

// 25. User Roles
export interface UserRolesTable {
  user_role_id: string; // UUID
  user_id: string; // UUID FK
  role_id: string; // UUID FK
  created_at: Generated<Date>;
}

// 26. User Territory Assignments
export interface UserTerritoryAssignmentsTable {
  assignment_id: string; // UUID
  user_id: string; // UUID FK
  district_id: string; // UUID FK
  block_id: string | null; // UUID FK
  is_primary_territory: Generated<boolean>;
  valid_from: Generated<Date>;
  valid_to: Date | string | null;
  created_at: Generated<Date>;
}

// 27. Refresh Tokens
export interface RefreshTokensTable {
  refresh_token_id: string; // UUID
  user_id: string; // UUID FK
  token_hash: string; // SHA-256
  family_id: string; // UUID
  is_revoked: Generated<boolean>;
  expires_at: Date | string;
  device_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Generated<Date>;
  revoked_at: Date | string | null;
}

// Complete Database Schema Map
export interface DatabaseSchema {
  districts: DistrictsTable;
  blocks: BlocksTable;
  schools: SchoolsTable;
  hi_tech_labs: HiTechLabsTable;
  oem_manufacturers: OemManufacturersTable;
  equipment_types: EquipmentTypesTable;
  equipment_attribute_definitions: EquipmentAttributeDefinitionsTable;
  lab_equipment: LabEquipmentTable;
  users: UsersTable;
  complaint_sources: ComplaintSourcesTable;
  source_complaints: SourceComplaintsTable;
  sla_policies: SlaPoliciesTable;
  service_cases: ServiceCasesTable;
  assignment_history: AssignmentHistoryTable;
  field_visits: FieldVisitsTable;
  visit_equipment_findings: VisitEquipmentFindingsTable;
  evidence_files: EvidenceFilesTable;
  import_jobs: ImportJobsTable;
  import_staging_records: ImportStagingRecordsTable;
  audit_events: AuditEventsTable;
  tombstones: TombstonesTable;
  roles: RolesTable;
  permissions: PermissionsTable;
  role_permissions: RolePermissionsTable;
  user_roles: UserRolesTable;
  user_territory_assignments: UserTerritoryAssignmentsTable;
  refresh_tokens: RefreshTokensTable;
  service_case_status_history: ServiceCaseStatusHistoryTable;
  idempotency_keys: IdempotencyKeysTable;
  field_visit_status_history: FieldVisitStatusHistoryTable;
  conveyance_rate_policies: ConveyanceRatePoliciesTable;
  conveyance_claims: ConveyanceClaimsTable;
}

// 28. Service Case Status History
export interface ServiceCaseStatusHistoryTable {
  status_history_id: string; // UUID
  service_case_id: string; // UUID FK
  from_status: string;
  to_status: string;
  changed_by_user_id: string | null; // UUID FK
  transition_reason: string | null;
  created_at: Generated<Date>;
}

// 29. Idempotency Keys (Phase 12 Sync Engine)
export interface IdempotencyKeysTable {
  client_operation_id: string; // UUID
  user_id: string; // UUID FK
  endpoint: string;
  response_status_code: number;
  response_body: Record<string, unknown>; // JSONB
  created_at: Generated<Date>;
}

// 30. Field Visit Status History (Phase 13 Append-Only Audit)
export interface FieldVisitStatusHistoryTable {
  history_id: string; // UUID
  visit_id: string; // UUID FK
  from_status: string;
  to_status: string;
  changed_by_user_id: string | null; // UUID FK
  transition_reason: string | null;
  client_operation_id: string | null; // UUID
  created_at: Generated<Date>;
}

// 31. Conveyance Rate Policies (Phase 15 Configuration-Driven Reimbursement)
export interface ConveyanceRatePoliciesTable {
  policy_id: Generated<string>; // UUID
  tenant_id?: string | null; // UUID FK
  district_id?: string | null; // UUID FK
  travel_mode: string;
  rate_per_km: number | string;
  max_daily_distance_km: number | string | null;
  max_daily_amount: number | string | null;
  requires_odometer: Generated<boolean>;
  requires_evidence: Generated<boolean>;
  description: string | null;
  is_provisional: Generated<boolean>;
  effective_from: Generated<Date>;
  effective_to: Date | null;
  is_active: Generated<boolean>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// 32. Conveyance Claims (Phase 15 Authoritative Domain Claims)
export interface ConveyanceClaimsTable {
  conveyance_claim_id: string; // UUID
  visit_id: string; // UUID FK
  service_case_id: string; // UUID FK
  engineer_id: string; // UUID FK
  submitted_by_user_id: string | null; // UUID FK
  policy_id: string | null; // UUID FK
  travel_date: string; // Date (YYYY-MM-DD)
  from_location: string;
  to_location: string;
  travel_mode: string;
  starting_odometer_km: number | string | null;
  ending_odometer_km: number | string | null;
  calculated_odometer_distance_km: number | string | null;
  gps_distance_km: number | string | null;
  captured_distance_km: number | string | null;
  claimed_distance_km: number | string;
  approved_distance_km: number | string | null;
  applied_rate_per_km: number | string;
  rate_policy_version: Generated<number>;
  is_provisional_policy: Generated<boolean>;
  calculated_amount: number | string;
  claimed_amount: number | string;
  approved_amount: number | string | null;
  supporting_evidence_file_id: string | null; // UUID FK
  claim_status: Generated<string>;
  submitted_at: Date | null;
  reviewed_by_user_id: string | null; // UUID FK
  reviewed_at: Date | null;
  rejection_reason: string | null;
  correction_notes: string | null;
  remarks: string | null;
  version: Generated<number>;
  client_operation_id: string | null; // UUID
  is_tombstoned: Generated<boolean>;
  is_deleted: Generated<boolean>;
  deleted_at: Date | null;
  deleted_by_user_id: string | null; // UUID FK
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}




/**
 * ZENTRA Field — Local Database Schema
 * apps/field/src/database/schema.ts
 *
 * WatermelonDB AppSchema (Version 1):
 * Defines offline domain tables, local operation queue, and sync metadata.
 * Includes indexes on foreign keys, operational status, and server IDs for sub-second lookups.
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const APP_SCHEMA_VERSION = 1;

export const appDatabaseSchema = appSchema({
  version: APP_SCHEMA_VERSION,
  tables: [
    // 1. Districts Reference
    tableSchema({
      name: 'districts',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'district_code', type: 'string', isIndexed: true },
        { name: 'district_name', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // 2. Blocks Reference
    tableSchema({
      name: 'blocks',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'district_id', type: 'string', isIndexed: true },
        { name: 'block_code', type: 'string' },
        { name: 'block_name', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // 3. Schools Master Dossier
    tableSchema({
      name: 'schools',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'udise_code', type: 'string', isIndexed: true },
        { name: 'district_id', type: 'string', isIndexed: true },
        { name: 'block_id', type: 'string', isIndexed: true },
        { name: 'school_name', type: 'string' },
        { name: 'category', type: 'string' },
        { name: 'latitude', type: 'number', isOptional: true },
        { name: 'longitude', type: 'number', isOptional: true },
        { name: 'headmaster_name', type: 'string', isOptional: true },
        { name: 'headmaster_phone', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // 4. Hi-Tech Labs
    tableSchema({
      name: 'hi_tech_labs',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'school_id', type: 'string', isIndexed: true },
        { name: 'lab_type', type: 'string' },
        { name: 'room_number', type: 'string', isOptional: true },
        { name: 'total_systems', type: 'number' },
        { name: 'is_functional', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // 5. Equipment Inventory
    tableSchema({
      name: 'equipment',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'lab_id', type: 'string', isIndexed: true },
        { name: 'equipment_type_id', type: 'string' },
        { name: 'equipment_type_name', type: 'string' },
        { name: 'serial_number', type: 'string', isIndexed: true },
        { name: 'oem_name', type: 'string' },
        { name: 'model_number', type: 'string' },
        { name: 'functional_status', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // 6. Service Cases
    tableSchema({
      name: 'service_cases',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'zentra_case_code', type: 'string', isIndexed: true },
        { name: 'school_id', type: 'string', isIndexed: true },
        { name: 'lab_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'equipment_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'source_complaint_id', type: 'string', isOptional: true },
        { name: 'assigned_primary_engineer_id', type: 'string', isIndexed: true },
        { name: 'assigned_secondary_engineer_id', type: 'string', isOptional: true },
        { name: 'operational_status', type: 'string', isIndexed: true },
        { name: 'priority', type: 'string' },
        { name: 'sla_target_at', type: 'number', isOptional: true },
        { name: 'fault_description', type: 'string' },
        { name: 'resolution_notes', type: 'string', isOptional: true },
        { name: 'server_version', type: 'string', isOptional: true },
        { name: 'sync_state', type: 'string', isIndexed: true }, // 'SYNCED' | 'PENDING_SYNC' | 'LOCAL_ONLY' | 'CONFLICT'
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // 7. Local Operation Queue (Zero Data Loss Persistent Ledger)
    tableSchema({
      name: 'local_operations',
      columns: [
        { name: 'client_operation_id', type: 'string', isIndexed: true }, // UUIDv7
        { name: 'entity_type', type: 'string', isIndexed: true },
        { name: 'local_entity_id', type: 'string', isIndexed: true },
        { name: 'server_entity_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'operation_type', type: 'string', isIndexed: true }, // 'INSERT' | 'UPDATE' | 'STATUS_TRANSITION'
        { name: 'payload_json', type: 'string' },
        { name: 'base_version', type: 'string', isOptional: true },
        { name: 'status', type: 'string', isIndexed: true }, // 'QUEUED' | 'IN_FLIGHT' | 'FAILED' | 'ACKNOWLEDGED' | 'CONFLICT'
        { name: 'retry_count', type: 'number' },
        { name: 'last_attempt_at', type: 'number', isOptional: true },
        { name: 'error_message', type: 'string', isOptional: true },
        { name: 'conflict_code', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number', isIndexed: true },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // 8. Synchronization Metadata Foundation (Schema foundation only — synchronization semantics deferred to Phase 12)
    tableSchema({
      name: 'sync_metadata',
      columns: [
        { name: 'key', type: 'string', isIndexed: true },
        { name: 'value', type: 'string' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // 9. Field Visits (Physical Attendance & On-Site Lifecycle)
    tableSchema({
      name: 'field_visits',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'service_case_id', type: 'string', isIndexed: true },
        { name: 'engineer_id', type: 'string', isIndexed: true },
        { name: 'visit_sequence_number', type: 'number' },
        { name: 'visit_date', type: 'string' },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'check_in_timestamp', type: 'number', isOptional: true },
        { name: 'check_in_at_device', type: 'number', isOptional: true },
        { name: 'check_in_latitude', type: 'number', isOptional: true },
        { name: 'check_in_longitude', type: 'number', isOptional: true },
        { name: 'check_in_accuracy_meters', type: 'number', isOptional: true },
        { name: 'check_in_distance_meters', type: 'number', isOptional: true },
        { name: 'check_in_within_geofence', type: 'boolean', isOptional: true },
        { name: 'equipment_condition_observed', type: 'string', isOptional: true },
        { name: 'on_site_diagnosis', type: 'string', isOptional: true },
        { name: 'work_performed', type: 'string', isOptional: true },
        { name: 'visit_outcome', type: 'string', isOptional: true },
        { name: 'pending_reason_text', type: 'string', isOptional: true },
        { name: 'target_next_visit_date', type: 'string', isOptional: true },
        { name: 'check_out_timestamp', type: 'number', isOptional: true },
        { name: 'check_out_at_device', type: 'number', isOptional: true },
        { name: 'check_out_latitude', type: 'number', isOptional: true },
        { name: 'check_out_longitude', type: 'number', isOptional: true },
        { name: 'check_out_accuracy_meters', type: 'number', isOptional: true },
        { name: 'notes', type: 'string', isOptional: true },
        { name: 'server_version', type: 'string', isOptional: true },
        { name: 'sync_state', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // 9. Evidence Files
    tableSchema({
      name: 'evidence',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'visit_id', type: 'string', isIndexed: true },
        { name: 'service_case_id', type: 'string', isIndexed: true },
        { name: 'evidence_slot', type: 'string', isIndexed: true },
        { name: 'evidence_type', type: 'string' },
        { name: 'local_media_id', type: 'string', isOptional: true, isIndexed: true },
        { name: 'local_file_uri', type: 'string' },
        { name: 'storage_path', type: 'string', isOptional: true },
        { name: 'file_checksum_sha256', type: 'string' },
        { name: 'file_size_bytes', type: 'number' },
        { name: 'mime_type', type: 'string' },
        { name: 'upload_status', type: 'string', isIndexed: true },
        { name: 'captured_at', type: 'number' },
        { name: 'uploaded_at', type: 'number', isOptional: true },
        { name: 'gps_latitude', type: 'number', isOptional: true },
        { name: 'gps_longitude', type: 'number', isOptional: true },
        { name: 'gps_accuracy_meters', type: 'number', isOptional: true },
        { name: 'retry_count', type: 'number' },
        { name: 'last_error', type: 'string', isOptional: true },
        { name: 'server_version', type: 'string', isOptional: true },
        { name: 'sync_state', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // 10. Conveyance Claims (Phase 15 Local-First Claims)
    tableSchema({
      name: 'conveyance_claims',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'visit_id', type: 'string', isIndexed: true },
        { name: 'service_case_id', type: 'string', isIndexed: true },
        { name: 'engineer_id', type: 'string', isIndexed: true },
        { name: 'policy_id', type: 'string', isOptional: true },
        { name: 'travel_date', type: 'string' },
        { name: 'from_location', type: 'string' },
        { name: 'to_location', type: 'string' },
        { name: 'travel_mode', type: 'string' },
        { name: 'starting_odometer_km', type: 'number', isOptional: true },
        { name: 'ending_odometer_km', type: 'number', isOptional: true },
        { name: 'calculated_odometer_distance_km', type: 'number', isOptional: true },
        { name: 'gps_distance_km', type: 'number', isOptional: true },
        { name: 'captured_distance_km', type: 'number', isOptional: true },
        { name: 'claimed_distance_km', type: 'number' },
        { name: 'approved_distance_km', type: 'number', isOptional: true },
        { name: 'applied_rate_per_km', type: 'number' },
        { name: 'rate_policy_version', type: 'number' },
        { name: 'is_provisional_policy', type: 'boolean' },
        { name: 'calculated_amount', type: 'number' },
        { name: 'claimed_amount', type: 'number' },
        { name: 'approved_amount', type: 'number', isOptional: true },
        { name: 'supporting_evidence_file_id', type: 'string', isOptional: true },
        { name: 'claim_status', type: 'string', isIndexed: true },
        { name: 'submitted_at', type: 'number', isOptional: true },
        { name: 'submitted_by_user_id', type: 'string', isOptional: true },
        { name: 'reviewed_by_user_id', type: 'string', isOptional: true },
        { name: 'reviewed_at', type: 'number', isOptional: true },
        { name: 'rejection_reason', type: 'string', isOptional: true },
        { name: 'correction_notes', type: 'string', isOptional: true },
        { name: 'remarks', type: 'string', isOptional: true },
        { name: 'version', type: 'number' },
        { name: 'sync_state', type: 'string', isIndexed: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});


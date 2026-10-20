/**
 * ZENTRA Database Migration: Visits, Evidence and Findings
 * 20261005000004_create_visits_evidence_and_findings.ts
 *
 * Implements:
 * - field_visits (supports multiple on-site visits per service case)
 * - visit_equipment_findings (reported vs actual equipment found)
 * - evidence_files (Slot 1 and Slot 2 evidence metadata isolation; no binary blobs)
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Field Visits
  await db.schema
    .createTable('field_visits')
    .addColumn('visit_id', 'uuid', (col) => col.primaryKey())
    .addColumn('service_case_id', 'uuid', (col) =>
      col.notNull().references('service_cases.service_case_id').onDelete('restrict'),
    )
    .addColumn('engineer_id', 'uuid', (col) =>
      col.notNull().references('users.user_id').onDelete('restrict'),
    )
    .addColumn('visit_sequence_number', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('visit_date', 'date', (col) => col.notNull())
    .addColumn('check_in_timestamp', 'timestamptz')
    .addColumn('check_in_latitude', 'decimal(10, 8)')
    .addColumn('check_in_longitude', 'decimal(11, 8)')
    .addColumn('check_in_accuracy_meters', 'decimal(6, 2)')
    .addColumn('check_in_within_geofence', 'boolean')
    .addColumn('equipment_condition_observed', 'varchar(100)')
    .addColumn('on_site_diagnosis', 'text')
    .addColumn('work_performed', 'text')
    .addColumn('visit_outcome', 'varchar(50)', (col) => col.notNull().defaultTo('RESOLVED_ON_SITE'))
    .addColumn('pending_reason_text', 'text')
    .addColumn('target_next_visit_date', 'date')
    .addColumn('check_out_timestamp', 'timestamptz')
    .addColumn('check_out_latitude', 'decimal(10, 8)')
    .addColumn('check_out_longitude', 'decimal(11, 8)')
    .addColumn('check_out_accuracy_meters', 'decimal(6, 2)')
    .addColumn('conveyance_km', 'decimal(6, 2)')
    .addColumn('client_operation_id', 'uuid')
    .addColumn('is_deleted', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('deleted_by_user_id', 'uuid', (col) =>
      col.references('users.user_id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint('uq_field_visits_case_sequence', [
      'service_case_id',
      'visit_sequence_number',
    ])
    .addCheckConstraint(
      'chk_field_visits_outcome',
      sql`visit_outcome IN (
        'RESOLVED_ON_SITE', 'PENDING_PARTS', 'PENDING_OEM_ESCALATION', 
        'ABORTED_SCHOOL_CLOSED', 'UNABLE_TO_REPRODUCE'
      )`,
    )
    .execute();

  await db.schema
    .createIndex('idx_field_visits_case_id')
    .on('field_visits')
    .column('service_case_id')
    .execute();
  await db.schema
    .createIndex('idx_field_visits_engineer_id')
    .on('field_visits')
    .column('engineer_id')
    .execute();

  // 2. Visit Equipment Findings (Reported vs Actual Equipment Observed)
  await db.schema
    .createTable('visit_equipment_findings')
    .addColumn('finding_id', 'uuid', (col) => col.primaryKey())
    .addColumn('visit_id', 'uuid', (col) =>
      col.notNull().references('field_visits.visit_id').onDelete('cascade'),
    )
    .addColumn('lab_equipment_id', 'uuid', (col) =>
      col.references('lab_equipment.lab_equipment_id').onDelete('set null'),
    )
    .addColumn('reported_equipment_text', 'varchar(255)')
    .addColumn('actual_serial_number_observed', 'varchar(100)')
    .addColumn('actual_equipment_type_id', 'uuid', (col) =>
      col.references('equipment_types.equipment_type_id').onDelete('set null'),
    )
    .addColumn('condition_observed', 'varchar(50)', (col) => col.notNull().defaultTo('FAULTY'))
    .addColumn('diagnostic_attributes', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('diagnosis_notes', 'text')
    .addColumn('action_taken', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex('idx_findings_visit_id')
    .on('visit_equipment_findings')
    .column('visit_id')
    .execute();

  // 3. Evidence Files (Slot 1 / Slot 2 Isolation; S3 storage paths only)
  await db.schema
    .createTable('evidence_files')
    .addColumn('evidence_file_id', 'uuid', (col) => col.primaryKey())
    .addColumn('visit_id', 'uuid', (col) =>
      col.notNull().references('field_visits.visit_id').onDelete('restrict'),
    )
    .addColumn('service_case_id', 'uuid', (col) =>
      col.notNull().references('service_cases.service_case_id').onDelete('restrict'),
    )
    .addColumn('evidence_slot', 'varchar(50)', (col) => col.notNull())
    .addColumn('storage_path', 'varchar(500)', (col) => col.notNull())
    .addColumn('file_checksum_sha256', 'varchar(64)', (col) => col.notNull())
    .addColumn('file_size_bytes', 'bigint', (col) => col.notNull())
    .addColumn('mime_type', 'varchar(100)', (col) => col.notNull().defaultTo('image/jpeg'))
    .addColumn('captured_at', 'timestamptz', (col) => col.notNull())
    .addColumn('gps_latitude', 'decimal(10, 8)')
    .addColumn('gps_longitude', 'decimal(11, 8)')
    .addColumn('gps_accuracy_meters', 'decimal(6, 2)')
    .addColumn('uploaded_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('is_verified', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('verification_notes', 'text')
    .addColumn('is_tombstoned', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('is_deleted', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('deleted_by_user_id', 'uuid', (col) =>
      col.references('users.user_id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addCheckConstraint(
      'chk_evidence_files_slot',
      sql`evidence_slot IN (
        'SLOT_1_HM_SIGNED_REPORT', 
        'SLOT_2_EQUIPMENT_WORKING_PHOTO', 
        'SLOT_AUX_FAULT_PRE_SERVICE', 
        'SLOT_AUX_SERIAL_PLATE', 
        'SLOT_AUX_REPLACED_PARTS'
      )`,
    )
    .execute();

  await db.schema
    .createIndex('idx_evidence_files_visit_id')
    .on('evidence_files')
    .column('visit_id')
    .execute();
  await db.schema
    .createIndex('idx_evidence_files_case_id')
    .on('evidence_files')
    .column('service_case_id')
    .execute();
  await db.schema
    .createIndex('idx_evidence_files_slot')
    .on('evidence_files')
    .column('evidence_slot')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('evidence_files').ifExists().cascade().execute();
  await db.schema.dropTable('visit_equipment_findings').ifExists().cascade().execute();
  await db.schema.dropTable('field_visits').ifExists().cascade().execute();
}

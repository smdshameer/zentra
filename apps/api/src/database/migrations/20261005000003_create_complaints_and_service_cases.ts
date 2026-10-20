/**
 * ZENTRA Database Migration: Complaints and Service Cases
 * 20261005000003_create_complaints_and_service_cases.ts
 *
 * Implements:
 * - users (personnel reference placeholder for FK relationships; zero auth credentials)
 * - complaint_sources
 * - source_complaints (SOURCE OWNED - immutable intake data)
 * - sla_policies
 * - service_cases (SERVER OPERATIONAL OWNED - field service lifecycle)
 * - assignment_history (append-only dispatch ledger)
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Users (Personnel Reference Placeholder)
  await db.schema
    .createTable('users')
    .addColumn('user_id', 'uuid', (col) => col.primaryKey())
    .addColumn('username', 'varchar(100)', (col) => col.notNull().unique())
    .addColumn('full_name', 'varchar(150)', (col) => col.notNull())
    .addColumn('phone_number', 'varchar(20)')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // 2. Complaint Sources
  await db.schema
    .createTable('complaint_sources')
    .addColumn('source_system_id', 'uuid', (col) => col.primaryKey())
    .addColumn('system_code', 'varchar(50)', (col) => col.notNull().unique())
    .addColumn('system_name', 'varchar(150)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // 3. Source Complaints (SOURCE OWNED - IMMUTABLE)
  await db.schema
    .createTable('source_complaints')
    .addColumn('source_complaint_id', 'uuid', (col) => col.primaryKey())
    .addColumn('source_system_id', 'uuid', (col) =>
      col.notNull().references('complaint_sources.source_system_id').onDelete('restrict'),
    )
    .addColumn('external_ticket_id', 'varchar(100)', (col) => col.notNull())
    .addColumn('school_id', 'uuid', (col) =>
      col.notNull().references('schools.school_id').onDelete('restrict'),
    )
    .addColumn('lab_id', 'uuid', (col) =>
      col.references('hi_tech_labs.lab_id').onDelete('restrict'),
    )
    .addColumn('original_title', 'varchar(255)', (col) => col.notNull())
    .addColumn('original_description', 'text')
    .addColumn('registered_at', 'timestamptz', (col) => col.notNull())
    .addColumn('source_status', 'varchar(50)', (col) => col.notNull().defaultTo('Open'))
    .addColumn('source_priority', 'varchar(50)', (col) => col.notNull().defaultTo('MEDIUM'))
    .addColumn('source_sla_target', 'timestamptz')
    .addColumn('reported_equipment_text', 'varchar(255)')
    .addColumn('reported_serial_number', 'varchar(100)')
    .addColumn('reporter_name', 'varchar(150)')
    .addColumn('reporter_phone', 'varchar(50)')
    .addColumn('original_remarks', 'text')
    .addColumn('raw_payload', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint('uq_source_complaints_system_ticket', [
      'source_system_id',
      'external_ticket_id',
    ])
    .execute();

  await db.schema
    .createIndex('idx_source_complaints_school_id')
    .on('source_complaints')
    .column('school_id')
    .execute();
  await db.schema
    .createIndex('idx_source_complaints_status')
    .on('source_complaints')
    .column('source_status')
    .execute();

  // 4. SLA Policies
  await db.schema
    .createTable('sla_policies')
    .addColumn('sla_policy_id', 'uuid', (col) => col.primaryKey())
    .addColumn('policy_name', 'varchar(100)', (col) => col.notNull().unique())
    .addColumn('priority_level', 'varchar(50)', (col) => col.notNull())
    .addColumn('target_resolution_hours', 'integer', (col) => col.notNull())
    .addColumn('warning_threshold_percentage', 'integer', (col) => col.notNull().defaultTo(75))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // 5. Service Cases (SERVER OPERATIONAL OWNED)
  await db.schema
    .createTable('service_cases')
    .addColumn('service_case_id', 'uuid', (col) => col.primaryKey())
    .addColumn('source_complaint_id', 'uuid', (col) =>
      col
        .notNull()
        .unique()
        .references('source_complaints.source_complaint_id')
        .onDelete('restrict'),
    )
    .addColumn('zentra_case_code', 'varchar(50)', (col) => col.notNull().unique())
    .addColumn('school_id', 'uuid', (col) =>
      col.notNull().references('schools.school_id').onDelete('restrict'),
    )
    .addColumn('lab_id', 'uuid', (col) =>
      col.notNull().references('hi_tech_labs.lab_id').onDelete('restrict'),
    )
    .addColumn('lab_equipment_id', 'uuid', (col) =>
      col.references('lab_equipment.lab_equipment_id').onDelete('set null'),
    )
    .addColumn('operational_status', 'varchar(50)', (col) => col.notNull().defaultTo('REGISTERED'))
    .addColumn('internal_priority', 'varchar(50)', (col) => col.notNull().defaultTo('MEDIUM'))
    .addColumn('assigned_primary_engineer_id', 'uuid', (col) =>
      col.references('users.user_id').onDelete('set null'),
    )
    .addColumn('assigned_secondary_engineer_id', 'uuid', (col) =>
      col.references('users.user_id').onDelete('set null'),
    )
    .addColumn('assigned_at', 'timestamptz')
    .addColumn('sla_policy_id', 'uuid', (col) =>
      col.references('sla_policies.sla_policy_id').onDelete('set null'),
    )
    .addColumn('sla_target_at', 'timestamptz')
    .addColumn('sla_breach_status', 'varchar(50)', (col) => col.notNull().defaultTo('WITHIN_SLA'))
    .addColumn('actual_diagnosis_summary', 'text')
    .addColumn('actual_action_taken_summary', 'text')
    .addColumn('verification_status', 'varchar(50)', (col) =>
      col.notNull().defaultTo('PENDING_REVIEW'),
    )
    .addColumn('verified_by_user_id', 'uuid', (col) =>
      col.references('users.user_id').onDelete('set null'),
    )
    .addColumn('resolved_at', 'timestamptz')
    .addColumn('closed_at', 'timestamptz')
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
    .addCheckConstraint(
      'chk_service_case_operational_status',
      sql`operational_status IN (
        'REGISTERED', 'ASSIGNED', 'IN_TRANSIT', 'VISIT_STARTED', 
        'IN_PROGRESS', 'PENDING_PARTS', 'ESCALATED_OEM', 'RESOLVED', 'VERIFIED', 'CLOSED'
      )`,
    )
    .addCheckConstraint(
      'chk_service_case_verification_status',
      sql`verification_status IN ('PENDING_REVIEW', 'VERIFIED_BY_COORDINATOR', 'REJECTED_NEEDS_REVISIT')`,
    )
    .execute();

  await db.schema
    .createIndex('idx_service_cases_school_status')
    .on('service_cases')
    .columns(['school_id', 'operational_status'])
    .execute();
  await db.schema
    .createIndex('idx_service_cases_primary_engineer')
    .on('service_cases')
    .columns(['assigned_primary_engineer_id', 'operational_status'])
    .execute();
  await db.schema
    .createIndex('idx_service_cases_deleted')
    .on('service_cases')
    .column('is_deleted')
    .execute();

  // 6. Assignment History
  await db.schema
    .createTable('assignment_history')
    .addColumn('assignment_history_id', 'uuid', (col) => col.primaryKey())
    .addColumn('service_case_id', 'uuid', (col) =>
      col.notNull().references('service_cases.service_case_id').onDelete('cascade'),
    )
    .addColumn('assigned_by_user_id', 'uuid', (col) =>
      col.references('users.user_id').onDelete('set null'),
    )
    .addColumn('engineer_id', 'uuid', (col) =>
      col.notNull().references('users.user_id').onDelete('restrict'),
    )
    .addColumn('assignment_role', 'varchar(50)', (col) => col.notNull().defaultTo('PRIMARY'))
    .addColumn('assigned_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('reassignment_reason', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex('idx_assignment_history_case_id')
    .on('assignment_history')
    .column('service_case_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('assignment_history').ifExists().cascade().execute();
  await db.schema.dropTable('service_cases').ifExists().cascade().execute();
  await db.schema.dropTable('sla_policies').ifExists().cascade().execute();
  await db.schema.dropTable('source_complaints').ifExists().cascade().execute();
  await db.schema.dropTable('complaint_sources').ifExists().cascade().execute();
  await db.schema.dropTable('users').ifExists().cascade().execute();
}

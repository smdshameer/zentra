/**
 * ZENTRA Database Migration: Governance, Staging, and Audit
 * 20261005000005_create_governance_staging_and_audit.ts
 *
 * Implements:
 * - import_jobs (intake batch tracking)
 * - import_staging_records (isolated staging data; completely separate from live field-service data)
 * - audit_events (immutable system audit log)
 * - tombstones (offline sync tombstone sequence registry)
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Import Jobs
  await db.schema
    .createTable('import_jobs')
    .addColumn('import_job_id', 'uuid', (col) => col.primaryKey())
    .addColumn('uploaded_by_user_id', 'uuid', (col) =>
      col.references('users.user_id').onDelete('set null'),
    )
    .addColumn('source_filename', 'varchar(255)', (col) => col.notNull())
    .addColumn('file_type', 'varchar(50)', (col) => col.notNull().defaultTo('XLSX'))
    .addColumn('total_rows_parsed', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('valid_rows_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('duplicate_rows_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('error_rows_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('job_status', 'varchar(50)', (col) => col.notNull().defaultTo('UPLOADED'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('committed_at', 'timestamptz')
    .execute();

  // 2. Import Staging Records (STAGING ONLY - ISOLATED FROM OPERATIONAL TABLES)
  await db.schema
    .createTable('import_staging_records')
    .addColumn('staging_record_id', 'uuid', (col) => col.primaryKey())
    .addColumn('import_job_id', 'uuid', (col) =>
      col.notNull().references('import_jobs.import_job_id').onDelete('cascade'),
    )
    .addColumn('raw_row_data', 'jsonb', (col) => col.notNull())
    .addColumn('mapped_udise_code', 'varchar(11)')
    .addColumn('resolved_school_id', 'uuid', (col) =>
      col.references('schools.school_id').onDelete('set null'),
    )
    .addColumn('mapped_external_ticket_id', 'varchar(100)')
    .addColumn('mapped_issue_text', 'text')
    .addColumn('mapped_priority', 'varchar(50)')
    .addColumn('duplicate_classification', 'varchar(50)', (col) =>
      col.notNull().defaultTo('NEW_UNIQUE'),
    )
    .addColumn('validation_error_message', 'text')
    .addColumn('is_approved_for_commit', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex('idx_staging_job_id')
    .on('import_staging_records')
    .column('import_job_id')
    .execute();
  await db.schema
    .createIndex('idx_staging_udise')
    .on('import_staging_records')
    .column('mapped_udise_code')
    .execute();

  // 3. Audit Events (Append-Only Log)
  await db.schema
    .createTable('audit_events')
    .addColumn('audit_event_id', 'uuid', (col) => col.primaryKey())
    .addColumn('event_timestamp', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('actor_user_id', 'uuid', (col) =>
      col.references('users.user_id').onDelete('set null'),
    )
    .addColumn('actor_ip_address', 'varchar(45)')
    .addColumn('actor_device_id', 'varchar(100)')
    .addColumn('event_category', 'varchar(50)', (col) => col.notNull())
    .addColumn('target_entity_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('target_entity_id', 'uuid', (col) => col.notNull())
    .addColumn('action_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('pre_mutation_state', 'jsonb')
    .addColumn('post_mutation_state', 'jsonb')
    .execute();

  await db.schema
    .createIndex('idx_audit_events_target')
    .on('audit_events')
    .columns(['target_entity_type', 'target_entity_id'])
    .execute();
  await db.schema
    .createIndex('idx_audit_events_timestamp')
    .on('audit_events')
    .column('event_timestamp')
    .execute();

  // 4. Tombstones (Offline Sync Deletion Tracking)
  await db.schema
    .createTable('tombstones')
    .addColumn('tombstone_id', 'uuid', (col) => col.primaryKey())
    .addColumn('entity_type', 'varchar(64)', (col) => col.notNull())
    .addColumn('entity_id', 'uuid', (col) => col.notNull())
    .addColumn('sync_sequence_number', 'bigserial', (col) => col.notNull().unique())
    .addColumn('deleted_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('deleted_by_user_id', 'uuid', (col) =>
      col.references('users.user_id').onDelete('set null'),
    )
    .addColumn('tombstone_reason', 'text')
    .execute();

  await db.schema
    .createIndex('idx_tombstones_sync_seq')
    .on('tombstones')
    .column('sync_sequence_number')
    .execute();
  await db.schema
    .createIndex('idx_tombstones_entity')
    .on('tombstones')
    .columns(['entity_type', 'entity_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('tombstones').ifExists().cascade().execute();
  await db.schema.dropTable('audit_events').ifExists().cascade().execute();
  await db.schema.dropTable('import_staging_records').ifExists().cascade().execute();
  await db.schema.dropTable('import_jobs').ifExists().cascade().execute();
}

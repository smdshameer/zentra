/**
 * ZENTRA Database Migration: Import Staging Enhancements and Row-Level Security
 * 20261008000001_create_import_staging_rls.ts
 *
 * Implements Phase 8 Staged Ingestion & Deduplication Subsystem:
 * - Enhances import_jobs with source_system_id, file_hash_sha256, and file_size_bytes
 * - Enhances import_staging_records with row_number, duplicate reasoning/confidence, and matched/committed links
 * - Enables and forces Row-Level Security on import_jobs and import_staging_records
 * - Scopes district coordinators to their assigned districts while granting statewide visibility to MASTER_ADMIN & REPORTING_HEAD
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Additive columns for import_jobs
  await db.schema
    .alterTable('import_jobs')
    .addColumn('source_system_id', 'uuid', (col) =>
      col.references('complaint_sources.source_system_id').onDelete('set null'),
    )
    .addColumn('file_hash_sha256', 'varchar(64)')
    .addColumn('file_size_bytes', 'integer')
    .execute();

  // 2. Additive columns for import_staging_records
  await db.schema
    .alterTable('import_staging_records')
    .addColumn('row_number', 'integer')
    .addColumn('duplicate_reason', 'text')
    .addColumn('duplicate_confidence', 'numeric(4, 2)')
    .addColumn('recommended_action', 'varchar(50)')
    .addColumn('approved_by_user_id', 'uuid', (col) =>
      col.references('users.user_id').onDelete('set null'),
    )
    .addColumn('approved_at', 'timestamptz')
    .addColumn('matched_source_complaint_id', 'uuid', (col) =>
      col.references('source_complaints.source_complaint_id').onDelete('set null'),
    )
    .addColumn('committed_source_complaint_id', 'uuid', (col) =>
      col.references('source_complaints.source_complaint_id').onDelete('set null'),
    )
    .execute();

  await sql`ALTER TABLE import_staging_records ALTER COLUMN is_approved_for_commit SET DEFAULT false`.execute(db);

  // 3. Enable and Force Row-Level Security on Import Staging Records
  await sql`ALTER TABLE import_staging_records ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE import_staging_records FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY import_staging_records_territory_isolation ON import_staging_records
    FOR ALL
    USING (
      NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
      OR
      (
        import_staging_records.resolved_school_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM schools s
          JOIN user_territory_assignments uta ON uta.district_id = s.district_id
          WHERE s.school_id = import_staging_records.resolved_school_id
            AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
            AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
            AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
        )
      )
      OR
      (
        import_staging_records.resolved_school_id IS NULL
        AND EXISTS (
          SELECT 1 FROM import_jobs j
          WHERE j.import_job_id = import_staging_records.import_job_id
            AND j.uploaded_by_user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
        )
      )
    )
  `.execute(db);

  // 4. Enable and Force Row-Level Security on Import Jobs
  await sql`ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY import_jobs_territory_isolation ON import_jobs
    FOR ALL
    USING (
      NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
      OR
      import_jobs.uploaded_by_user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
      OR
      EXISTS (
        SELECT 1 FROM import_staging_records isr
        JOIN schools s ON s.school_id = isr.resolved_school_id
        JOIN user_territory_assignments uta ON uta.district_id = s.district_id
        WHERE isr.import_job_id = import_jobs.import_job_id
          AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
          AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
          AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
      )
    )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // 1. Drop RLS policies and disable RLS
  await sql`DROP POLICY IF EXISTS import_staging_records_territory_isolation ON import_staging_records`.execute(db);
  await sql`ALTER TABLE import_staging_records NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE import_staging_records DISABLE ROW LEVEL SECURITY`.execute(db);

  await sql`DROP POLICY IF EXISTS import_jobs_territory_isolation ON import_jobs`.execute(db);
  await sql`ALTER TABLE import_jobs NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE import_jobs DISABLE ROW LEVEL SECURITY`.execute(db);

  // 2. Drop columns from import_staging_records
  await sql`ALTER TABLE import_staging_records ALTER COLUMN is_approved_for_commit SET DEFAULT true`.execute(db);

  await sql`
    ALTER TABLE import_staging_records
      DROP COLUMN IF EXISTS committed_source_complaint_id,
      DROP COLUMN IF EXISTS matched_source_complaint_id,
      DROP COLUMN IF EXISTS approved_at,
      DROP COLUMN IF EXISTS approved_by_user_id,
      DROP COLUMN IF EXISTS recommended_action,
      DROP COLUMN IF EXISTS duplicate_confidence,
      DROP COLUMN IF EXISTS duplicate_reason,
      DROP COLUMN IF EXISTS row_number;
  `.execute(db);

  // 3. Drop columns from import_jobs
  await sql`
    ALTER TABLE import_jobs
      DROP COLUMN IF EXISTS file_size_bytes,
      DROP COLUMN IF EXISTS file_hash_sha256,
      DROP COLUMN IF EXISTS source_system_id;
  `.execute(db);
}

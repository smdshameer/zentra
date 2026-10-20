/**
 * ZENTRA Database Migration: Enhance Evidence Files & S3 Pipeline
 * 20261008000005_enhance_evidence_files_and_s3_pipeline.ts
 *
 * Implements Phase 14 Evidence Pipeline & Direct S3 Streaming:
 * - Enhances evidence_files with upload lifecycle, object storage provider, version, and clientOperationId
 * - Supports controlled slots (HM signature, completion photo, aux fault, serial plate, diagnostic, etc.)
 * - Deploys Row-Level Security (RLS) territory isolation on evidence_files (lineage: evidence -> visit -> case -> school -> territory)
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Add upload lifecycle, version, object storage provider, and audit columns to evidence_files
  // Note: Existing pre-Phase-14 records are initially mapped to LEGACY_UNVERIFIED to prevent false promotion to FINALIZED
  await sql`
    ALTER TABLE evidence_files
      ADD COLUMN IF NOT EXISTS upload_status varchar(50) DEFAULT 'LEGACY_UNVERIFIED',
      ADD COLUMN IF NOT EXISTS object_storage_provider varchar(50) NOT NULL DEFAULT 'S3',
      ADD COLUMN IF NOT EXISTS evidence_type varchar(50) NOT NULL DEFAULT 'PHOTO',
      ADD COLUMN IF NOT EXISTS local_media_id varchar(100),
      ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS client_operation_id uuid;
  `.execute(db);

  // 2. Add Upload Status Check Constraint (supporting legacy and active Phase 14 statuses)
  await sql`
    ALTER TABLE evidence_files DROP CONSTRAINT IF EXISTS chk_evidence_files_upload_status;
    ALTER TABLE evidence_files ADD CONSTRAINT chk_evidence_files_upload_status
      CHECK (upload_status IN (
        'LOCAL_CAPTURED', 'QUEUED', 'UPLOAD_SESSION_CREATED', 'PENDING_UPLOAD',
        'UPLOADING', 'UPLOADED', 'FINALIZED', 'VERIFIED', 'UPLOAD_FAILED',
        'LEGACY_UNVERIFIED', 'LEGACY_MIGRATED'
      ));
  `.execute(db);

  // 3. Safe Backfill for Pre-Phase-14 Legacy Evidence Records:
  // - If pre-existing evidence was verified (is_verified = true) -> map to 'LEGACY_MIGRATED'
  // - If pre-existing evidence was unverified (is_verified = false) -> map to 'LEGACY_UNVERIFIED'
  // Pre-existing records are identified by client_operation_id IS NULL or legacy status.
  // Pre-existing records are never falsely promoted to FINALIZED or VERIFIED.
  await sql`
    UPDATE evidence_files
    SET upload_status = CASE
      WHEN is_verified = true THEN 'LEGACY_MIGRATED'
      ELSE 'LEGACY_UNVERIFIED'
    END
    WHERE client_operation_id IS NULL;
  `.execute(db);

  // 4. Set permanent default for future Phase 14 rows to UPLOAD_SESSION_CREATED and enforce NOT NULL
  await sql`
    ALTER TABLE evidence_files ALTER COLUMN upload_status SET DEFAULT 'UPLOAD_SESSION_CREATED';
    ALTER TABLE evidence_files ALTER COLUMN upload_status SET NOT NULL;
  `.execute(db);

  // 3. Expand evidence_slot Check Constraint to support canonical Phase 14 slots
  await sql`
    ALTER TABLE evidence_files DROP CONSTRAINT IF EXISTS chk_evidence_files_slot;
    ALTER TABLE evidence_files ADD CONSTRAINT chk_evidence_files_slot
      CHECK (evidence_slot IN (
        'SLOT_1_HM_SIGNED_REPORT', 
        'SLOT_2_EQUIPMENT_WORKING_PHOTO', 
        'SLOT_AUX_FAULT_PRE_SERVICE', 
        'SLOT_AUX_SERIAL_PLATE', 
        'SLOT_AUX_REPLACED_PARTS',
        'BEFORE_SERVICE_PHOTO',
        'SERIAL_NUMBER_PHOTO',
        'PARTS_SPARES_PHOTO',
        'DIAGNOSTIC_PHOTO',
        'OTHER_ATTACHMENT',
        'SLOT_1_DEFECT',
        'SLOT_2_COMPLETION'
      ));
  `.execute(db);

  // 4. Create Performance and Synchronization Indexes
  await sql`
    CREATE INDEX IF NOT EXISTS idx_evidence_files_upload_status 
      ON evidence_files(upload_status);
    CREATE INDEX IF NOT EXISTS idx_evidence_files_client_op_id 
      ON evidence_files(client_operation_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_files_updated_at 
      ON evidence_files(updated_at);
  `.execute(db);

  // 5. Enable and Force Row-Level Security on evidence_files
  await sql`ALTER TABLE evidence_files ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE evidence_files FORCE ROW LEVEL SECURITY`.execute(db);

  // 6. Deploy Territory Lineage RLS Policy:
  // Lineage: Evidence -> Field Visit -> Service Case -> School -> District Assignment
  await sql`
    DO $$ BEGIN
      DROP POLICY IF EXISTS evidence_files_territory_isolation ON evidence_files;
      CREATE POLICY evidence_files_territory_isolation ON evidence_files
      FOR ALL
      USING (
        NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
        OR
        (
          NULLIF(current_setting('zentra.current_role', true), '') = 'FIELD_ENGINEER'
          AND (
            created_by_user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
            OR EXISTS (
              SELECT 1 FROM field_visits fv
              WHERE fv.visit_id = evidence_files.visit_id
                AND fv.engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
            )
          )
        )
        OR
        EXISTS (
          SELECT 1 FROM service_cases sc
          JOIN schools s ON s.school_id = sc.school_id
          JOIN user_territory_assignments uta ON uta.district_id = s.district_id
          WHERE sc.service_case_id = evidence_files.service_case_id
            AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
            AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
            AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
        )
      );
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // 1. Drop RLS Policy & Disable RLS
  await sql`DROP POLICY IF EXISTS evidence_files_territory_isolation ON evidence_files`.execute(db);
  await sql`ALTER TABLE evidence_files NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE evidence_files DISABLE ROW LEVEL SECURITY`.execute(db);

  // 2. Drop Indexes
  await sql`DROP INDEX IF EXISTS idx_evidence_files_updated_at`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_evidence_files_client_op_id`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_evidence_files_upload_status`.execute(db);

  // 3. Drop Constraints & Added Columns
  await sql`ALTER TABLE evidence_files DROP CONSTRAINT IF EXISTS chk_evidence_files_upload_status`.execute(db);
  await sql`
    ALTER TABLE evidence_files
      DROP COLUMN IF EXISTS upload_status,
      DROP COLUMN IF EXISTS object_storage_provider,
      DROP COLUMN IF EXISTS evidence_type,
      DROP COLUMN IF EXISTS local_media_id,
      DROP COLUMN IF EXISTS created_by_user_id,
      DROP COLUMN IF EXISTS updated_at,
      DROP COLUMN IF EXISTS version,
      DROP COLUMN IF EXISTS client_operation_id;
  `.execute(db);
}

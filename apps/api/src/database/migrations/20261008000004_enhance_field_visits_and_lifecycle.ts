/**
 * ZENTRA Database Migration: Enhance Field Visits & Status History
 * 20261008000004_enhance_field_visits_and_lifecycle.ts
 *
 * Implements Phase 13 Field Visit Execution:
 * - Enhances field_visits with status lifecycle and server-authoritative version
 * - Captures check-in/out timestamps (device vs server) and geofence distance
 * - Adds append-only field_visit_status_history table
 * - Deploys Row-Level Security (RLS) policies on field_visits and history
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Add missing lifecycle, concurrency version, and timestamp columns to field_visits
  await sql`
    ALTER TABLE field_visits
      ADD COLUMN IF NOT EXISTS status varchar(30) NOT NULL DEFAULT 'PLANNED',
      ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS check_in_at_device timestamptz,
      ADD COLUMN IF NOT EXISTS check_in_at_server timestamptz,
      ADD COLUMN IF NOT EXISTS check_in_distance_meters decimal(8, 2),
      ADD COLUMN IF NOT EXISTS check_out_at_device timestamptz,
      ADD COLUMN IF NOT EXISTS check_out_at_server timestamptz,
      ADD COLUMN IF NOT EXISTS notes text;
  `.execute(db);

  // 2. Add Status Check Constraint
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_field_visits_status') THEN
        ALTER TABLE field_visits ADD CONSTRAINT chk_field_visits_status
          CHECK (status IN (
            'PLANNED', 'EN_ROUTE', 'CHECKED_IN', 'IN_PROGRESS', 
            'COMPLETED', 'CANCELLED', 'ABORTED', 'PENDING_RETURN'
          ));
      END IF;
    END $$;
  `.execute(db);

  // 3. Update outcome check constraint to support RETURN_VISIT_REQUIRED
  await sql`
    ALTER TABLE field_visits DROP CONSTRAINT IF EXISTS chk_field_visits_outcome;
    ALTER TABLE field_visits ADD CONSTRAINT chk_field_visits_outcome
      CHECK (visit_outcome IN (
        'RESOLVED_ON_SITE', 'PENDING_PARTS', 'PENDING_OEM_ESCALATION', 
        'ABORTED_SCHOOL_CLOSED', 'UNABLE_TO_REPRODUCE', 'RETURN_VISIT_REQUIRED'
      ));
  `.execute(db);

  // 4. Create Append-Only Status History Table
  await sql`
    CREATE TABLE IF NOT EXISTS field_visit_status_history (
      history_id uuid PRIMARY KEY,
      visit_id uuid NOT NULL REFERENCES field_visits(visit_id) ON DELETE CASCADE,
      from_status varchar(30) NOT NULL,
      to_status varchar(30) NOT NULL,
      changed_by_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
      transition_reason text,
      client_operation_id uuid,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_field_visit_status_history_visit_id 
      ON field_visit_status_history(visit_id);
    CREATE INDEX IF NOT EXISTS idx_field_visit_status_history_created_at 
      ON field_visit_status_history(created_at);
  `.execute(db);

  // 5. Enable and Force Row-Level Security on field_visits
  await sql`ALTER TABLE field_visits ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE field_visits FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    DO $$ BEGIN
      DROP POLICY IF EXISTS field_visits_territory_isolation ON field_visits;
      CREATE POLICY field_visits_territory_isolation ON field_visits
      FOR ALL
      USING (
        NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
        OR
        (
          NULLIF(current_setting('zentra.current_role', true), '') = 'FIELD_ENGINEER'
          AND engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
        )
        OR
        EXISTS (
          SELECT 1 FROM service_cases sc
          JOIN schools s ON s.school_id = sc.school_id
          JOIN user_territory_assignments uta ON uta.district_id = s.district_id
          WHERE sc.service_case_id = field_visits.service_case_id
            AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
            AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
            AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
        )
      );
    END $$;
  `.execute(db);

  // 6. Enable and Force Row-Level Security on field_visit_status_history
  await sql`ALTER TABLE field_visit_status_history ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE field_visit_status_history FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    DO $$ BEGIN
      DROP POLICY IF EXISTS field_visit_status_history_territory_isolation ON field_visit_status_history;
      CREATE POLICY field_visit_status_history_territory_isolation ON field_visit_status_history
      FOR ALL
      USING (
        NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
        OR
        EXISTS (
          SELECT 1 FROM field_visits fv
          JOIN service_cases sc ON sc.service_case_id = fv.service_case_id
          JOIN schools s ON s.school_id = sc.school_id
          JOIN user_territory_assignments uta ON uta.district_id = s.district_id
          WHERE fv.visit_id = field_visit_status_history.visit_id
            AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
            AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
            AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
        )
      );
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // 1. Drop RLS Policies & Disable RLS
  await sql`DROP POLICY IF EXISTS field_visit_status_history_territory_isolation ON field_visit_status_history`.execute(db);
  await sql`ALTER TABLE field_visit_status_history NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE field_visit_status_history DISABLE ROW LEVEL SECURITY`.execute(db);

  await sql`DROP POLICY IF EXISTS field_visits_territory_isolation ON field_visits`.execute(db);
  await sql`ALTER TABLE field_visits NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE field_visits DISABLE ROW LEVEL SECURITY`.execute(db);

  // 2. Drop History Table
  await sql`DROP TABLE IF EXISTS field_visit_status_history CASCADE`.execute(db);

  // 3. Drop Constraints and Columns from field_visits
  await sql`ALTER TABLE field_visits DROP CONSTRAINT IF EXISTS chk_field_visits_status`.execute(db);
  await sql`
    ALTER TABLE field_visits
      DROP COLUMN IF EXISTS status,
      DROP COLUMN IF EXISTS version,
      DROP COLUMN IF EXISTS check_in_at_device,
      DROP COLUMN IF EXISTS check_in_at_server,
      DROP COLUMN IF EXISTS check_in_distance_meters,
      DROP COLUMN IF EXISTS check_out_at_device,
      DROP COLUMN IF EXISTS check_out_at_server,
      DROP COLUMN IF EXISTS notes;
  `.execute(db);

  // 4. Revert Outcome check constraint to original
  await sql`ALTER TABLE field_visits DROP CONSTRAINT IF EXISTS chk_field_visits_outcome`.execute(db);
  await sql`
    ALTER TABLE field_visits ADD CONSTRAINT chk_field_visits_outcome
      CHECK (visit_outcome IN (
        'RESOLVED_ON_SITE', 'PENDING_PARTS', 'PENDING_OEM_ESCALATION', 
        'ABORTED_SCHOOL_CLOSED', 'UNABLE_TO_REPRODUCE'
      ));
  `.execute(db);
}

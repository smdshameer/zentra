/**
 * ZENTRA Database Migration: Service Cases, Dispatch Engine & SLA Enhancements
 * 20261008000002_enhance_service_cases_and_dispatch.ts
 *
 * Implements Phase 9 Service Case Lifecycle & Dispatch Engine Foundation:
 * - Enhances assignment_history with previous_engineer_id, action, emergency cross-district tracking
 * - Enforces technical append-only immutability on assignment_history via PostgreSQL trigger (prevents UPDATE / DELETE)
 * - Creates service_case_status_history table for auditing lifecycle state transitions
 * - Enables and forces Row-Level Security (RLS) on assignment_history and service_case_status_history
 * - Seeds default SLA policies (Critical 24h, High 48h, Medium 72h, Low 168h)
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Additive columns for assignment_history
  await db.schema
    .alterTable('assignment_history')
    .addColumn('previous_engineer_id', 'uuid', (col) =>
      col.references('users.user_id').onDelete('set null'),
    )
    .addColumn('action', 'varchar(50)', (col) => col.notNull().defaultTo('ASSIGNED'))
    .addColumn('is_emergency_cross_district', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('emergency_justification', 'text')
    .execute();

  // 2. Technical Immutability: Prevent UPDATE and DELETE on assignment_history via database trigger
  await sql`
    CREATE OR REPLACE FUNCTION prevent_assignment_history_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'assignment_history is append-only: UPDATE and DELETE operations are prohibited';
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_assignment_history_immutable
    BEFORE UPDATE OR DELETE ON assignment_history
    FOR EACH ROW EXECUTE FUNCTION prevent_assignment_history_mutation();
  `.execute(db);

  // 3. Create service_case_status_history table for state machine transition tracking
  await db.schema
    .createTable('service_case_status_history')
    .addColumn('status_history_id', 'uuid', (col) => col.primaryKey())
    .addColumn('service_case_id', 'uuid', (col) =>
      col.notNull().references('service_cases.service_case_id').onDelete('cascade'),
    )
    .addColumn('from_status', 'varchar(50)', (col) => col.notNull())
    .addColumn('to_status', 'varchar(50)', (col) => col.notNull())
    .addColumn('changed_by_user_id', 'uuid', (col) =>
      col.references('users.user_id').onDelete('set null'),
    )
    .addColumn('transition_reason', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex('idx_status_history_case_id')
    .on('service_case_status_history')
    .column('service_case_id')
    .execute();

  // 4. Technical Immutability: Prevent UPDATE and DELETE on service_case_status_history
  await sql`
    CREATE OR REPLACE FUNCTION prevent_status_history_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'service_case_status_history is append-only: UPDATE and DELETE operations are prohibited';
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);

  await sql`
    CREATE TRIGGER trg_status_history_immutable
    BEFORE UPDATE OR DELETE ON service_case_status_history
    FOR EACH ROW EXECUTE FUNCTION prevent_status_history_mutation();
  `.execute(db);

  // 5. Enable and Force Row-Level Security on assignment_history
  await sql`ALTER TABLE assignment_history ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE assignment_history FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY assignment_history_territory_isolation ON assignment_history
    FOR ALL
    USING (
      NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
      OR
      assignment_history.engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
      OR
      EXISTS (
        SELECT 1 FROM service_cases sc
        JOIN schools s ON s.school_id = sc.school_id
        JOIN user_territory_assignments uta ON uta.district_id = s.district_id
        WHERE sc.service_case_id = assignment_history.service_case_id
          AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
          AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
          AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
      )
    );
  `.execute(db);

  // 6. Enable and Force Row-Level Security on service_case_status_history
  await sql`ALTER TABLE service_case_status_history ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE service_case_status_history FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY service_case_status_history_territory_isolation ON service_case_status_history
    FOR ALL
    USING (
      NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
      OR
      EXISTS (
        SELECT 1 FROM service_cases sc
        WHERE sc.service_case_id = service_case_status_history.service_case_id
          AND (
            sc.assigned_primary_engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
            OR sc.assigned_secondary_engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
          )
      )
      OR
      EXISTS (
        SELECT 1 FROM service_cases sc
        JOIN schools s ON s.school_id = sc.school_id
        JOIN user_territory_assignments uta ON uta.district_id = s.district_id
        WHERE sc.service_case_id = service_case_status_history.service_case_id
          AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
          AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
          AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
      )
    );
  `.execute(db);

  // 7. Seed Default SLA Policies if table is empty
  await sql`
    INSERT INTO sla_policies (sla_policy_id, policy_name, priority_level, target_resolution_hours, warning_threshold_percentage, is_active)
    VALUES 
      ('018f0000-0000-7000-8000-000000000001', 'Critical Priority SLA (24h)', 'CRITICAL', 24, 75, true),
      ('018f0000-0000-7000-8000-000000000002', 'High Priority SLA (48h)', 'HIGH', 48, 75, true),
      ('018f0000-0000-7000-8000-000000000003', 'Medium Priority SLA (72h)', 'MEDIUM', 72, 75, true),
      ('018f0000-0000-7000-8000-000000000004', 'Low Priority SLA (168h)', 'LOW', 168, 75, true)
    ON CONFLICT (policy_name) DO NOTHING;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // 1. Drop RLS policies and disable RLS
  await sql`DROP POLICY IF EXISTS service_case_status_history_territory_isolation ON service_case_status_history`.execute(db);
  await sql`ALTER TABLE service_case_status_history NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE service_case_status_history DISABLE ROW LEVEL SECURITY`.execute(db);

  await sql`DROP POLICY IF EXISTS assignment_history_territory_isolation ON assignment_history`.execute(db);
  await sql`ALTER TABLE assignment_history NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE assignment_history DISABLE ROW LEVEL SECURITY`.execute(db);

  // 2. Drop triggers and functions
  await sql`DROP TRIGGER IF EXISTS trg_status_history_immutable ON service_case_status_history`.execute(db);
  await sql`DROP FUNCTION IF EXISTS prevent_status_history_mutation()`.execute(db);

  await sql`DROP TRIGGER IF EXISTS trg_assignment_history_immutable ON assignment_history`.execute(db);
  await sql`DROP FUNCTION IF EXISTS prevent_assignment_history_mutation()`.execute(db);

  // 3. Drop service_case_status_history table
  await db.schema.dropTable('service_case_status_history').ifExists().cascade().execute();

  // 4. Drop added columns from assignment_history
  await sql`
    ALTER TABLE assignment_history
      DROP COLUMN IF EXISTS emergency_justification,
      DROP COLUMN IF EXISTS is_emergency_cross_district,
      DROP COLUMN IF EXISTS action,
      DROP COLUMN IF EXISTS previous_engineer_id;
  `.execute(db);
}

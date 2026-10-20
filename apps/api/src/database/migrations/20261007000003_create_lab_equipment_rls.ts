/**
 * ZENTRA Database Migration: Lab Equipment Row-Level Security
 * 20261007000003_create_lab_equipment_rls.ts
 *
 * Implements Phase 7 Domain Security:
 * - Enables and forces Row-Level Security on `lab_equipment` table.
 * - Enforces fail-closed multi-district data isolation on equipment queries.
 * - Permits statewide administrative/reporting roles (MASTER_ADMIN, REPORTING_HEAD).
 * - Scopes field engineers and district coordinators to authorized territories via lab -> school hierarchy.
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Enable and Force Row-Level Security on Lab Equipment
  await sql`ALTER TABLE lab_equipment ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE lab_equipment FORCE ROW LEVEL SECURITY`.execute(db);

  // 2. Policy: lab_equipment_territory_isolation
  await sql`
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
    )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP POLICY IF EXISTS lab_equipment_territory_isolation ON lab_equipment`.execute(db);
  await sql`ALTER TABLE lab_equipment NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE lab_equipment DISABLE ROW LEVEL SECURITY`.execute(db);
}

/**
 * ZENTRA Database Migration: Hi-Tech Labs Row-Level Security
 * 20261007000002_create_hi_tech_labs_rls.ts
 *
 * Implements Phase 6 Domain Security:
 * - Enables and forces Row-Level Security on `hi_tech_labs` table.
 * - Enforces fail-closed multi-district data isolation on lab queries.
 * - Permits statewide administrative/reporting roles (MASTER_ADMIN, REPORTING_HEAD).
 * - Scopes field engineers and district coordinators to authorized territories.
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Enable and Force Row-Level Security on Hi-Tech Labs
  await sql`ALTER TABLE hi_tech_labs ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE hi_tech_labs FORCE ROW LEVEL SECURITY`.execute(db);

  // 2. Policy: hi_tech_labs_territory_isolation
  await sql`
    CREATE POLICY hi_tech_labs_territory_isolation ON hi_tech_labs
    FOR ALL
    USING (
      NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
      OR
      EXISTS (
        SELECT 1 FROM schools s
        JOIN user_territory_assignments uta ON uta.district_id = s.district_id
        WHERE s.school_id = hi_tech_labs.school_id
          AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
          AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
          AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
      )
    )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP POLICY IF EXISTS hi_tech_labs_territory_isolation ON hi_tech_labs`.execute(db);
  await sql`ALTER TABLE hi_tech_labs NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE hi_tech_labs DISABLE ROW LEVEL SECURITY`.execute(db);
}

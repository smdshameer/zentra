/**
 * ZENTRA Database Migration: Create Conveyance Rate Policies & Claims
 * 20261008000006_create_conveyance_and_claims.ts
 *
 * Implements Phase 15 Conveyance Claims & Management Web Portal (Correction Pass):
 * - Creates configurable conveyance_rate_policies table (rates, travel modes, distance limits, tenant/district scoping)
 * - Seeds provisional default policies (₹5/km bike, ₹2.5/km bus, ₹2/km train, ₹8/km auto)
 * - Creates authoritative conveyance_claims table linked to field visits & service cases
 * - Preserves three distinct distance models: captured_distance_km, claimed_distance_km, approved_distance_km
 * - Preserves auditability: applied_rate_per_km, rate_policy_version, calculated_amount, claimed_amount, approved_amount
 * - Supports proxy submission tracking: submitted_by_user_id vs engineer_id
 * - Protects financial history via ON DELETE RESTRICT on field_visits
 * - Deploys Row-Level Security (RLS) territory isolation via multi-hop lineage for SELECT, INSERT, UPDATE, DELETE
 * - Uses strictly approved ZENTRA roles: MASTER_ADMIN, REPORTING_HEAD, DISTRICT_COORDINATOR, FIELD_ENGINEER (no SUPER_ADMIN)
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Create Conveyance Rate Policies Table (Configuration-Driven Reimbursement)
  await sql`
    CREATE TABLE IF NOT EXISTS conveyance_rate_policies (
      policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid,
      district_id uuid REFERENCES districts(district_id) ON DELETE CASCADE,
      travel_mode varchar(50) NOT NULL,
      rate_per_km numeric(6, 2) NOT NULL,
      max_daily_distance_km numeric(6, 2),
      max_daily_amount numeric(8, 2),
      requires_odometer boolean NOT NULL DEFAULT false,
      requires_evidence boolean NOT NULL DEFAULT false,
      description text,
      is_provisional boolean NOT NULL DEFAULT true,
      effective_from timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      effective_to timestamptz,
      is_active boolean NOT NULL DEFAULT true,
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_conveyance_policy_mode CHECK (travel_mode IN ('BIKE', 'BUS', 'TRAIN', 'AUTO', 'OTHER')),
      CONSTRAINT chk_conveyance_policy_rate_positive CHECK (rate_per_km >= 0),
      CONSTRAINT chk_conveyance_policy_effective_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
    );
  `.execute(db);

  // 2. Seed Provisional / Configurable Default Rate Policies
  // NOTE: Strictly classified as PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY
  await sql`
    INSERT INTO conveyance_rate_policies (
      travel_mode, rate_per_km, requires_odometer, requires_evidence, description, is_provisional
    ) VALUES
      ('BIKE', 5.00, true, false, 'Provisional default rate for two-wheeler field travel (₹5.00/km)', true),
      ('BUS', 2.50, false, true, 'Provisional default rate for public bus transit (₹2.50/km or ticket fare)', true),
      ('TRAIN', 2.00, false, true, 'Provisional default rate for passenger / suburban rail (₹2.00/km)', true),
      ('AUTO', 8.00, false, true, 'Provisional default rate for local shared / meter auto (₹8.00/km)', true),
      ('OTHER', 5.00, false, true, 'Provisional fallback rate for other transit modes (₹5.00/km)', true)
    ON CONFLICT DO NOTHING;
  `.execute(db);

  // 3. Rate Policy Lookup Indexes
  await sql`
    CREATE INDEX IF NOT EXISTS idx_conveyance_rate_policies_lookup
      ON conveyance_rate_policies (travel_mode, is_active, effective_from);
    CREATE INDEX IF NOT EXISTS idx_conveyance_rate_policies_district
      ON conveyance_rate_policies (district_id);
  `.execute(db);

  // 4. Create Conveyance Claims Table
  await sql`
    CREATE TABLE IF NOT EXISTS conveyance_claims (
      conveyance_claim_id uuid PRIMARY KEY,
      visit_id uuid NOT NULL REFERENCES field_visits(visit_id) ON DELETE RESTRICT,
      service_case_id uuid NOT NULL REFERENCES service_cases(service_case_id) ON DELETE RESTRICT,
      engineer_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
      submitted_by_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
      policy_id uuid REFERENCES conveyance_rate_policies(policy_id) ON DELETE SET NULL,
      travel_date date NOT NULL,
      from_location varchar(255) NOT NULL,
      to_location varchar(255) NOT NULL,
      travel_mode varchar(50) NOT NULL,
      starting_odometer_km numeric(8, 2),
      ending_odometer_km numeric(8, 2),
      calculated_odometer_distance_km numeric(6, 2),
      gps_distance_km numeric(6, 2),
      captured_distance_km numeric(6, 2),
      claimed_distance_km numeric(6, 2) NOT NULL,
      approved_distance_km numeric(6, 2),
      applied_rate_per_km numeric(6, 2) NOT NULL,
      rate_policy_version integer NOT NULL DEFAULT 1,
      is_provisional_policy boolean NOT NULL DEFAULT true,
      calculated_amount numeric(10, 2) NOT NULL,
      claimed_amount numeric(10, 2) NOT NULL,
      approved_amount numeric(10, 2),
      supporting_evidence_file_id uuid REFERENCES evidence_files(evidence_file_id) ON DELETE SET NULL,
      claim_status varchar(50) NOT NULL DEFAULT 'DRAFT',
      submitted_at timestamptz,
      reviewed_by_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
      reviewed_at timestamptz,
      rejection_reason text,
      correction_notes text,
      remarks text,
      version integer NOT NULL DEFAULT 1,
      client_operation_id uuid,
      is_tombstoned boolean NOT NULL DEFAULT false,
      is_deleted boolean NOT NULL DEFAULT false,
      deleted_at timestamptz,
      deleted_by_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_conveyance_claims_status CHECK (
        claim_status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RETURNED_FOR_CORRECTION', 'PAID')
      ),
      CONSTRAINT chk_conveyance_claims_mode CHECK (
        travel_mode IN ('BIKE', 'BUS', 'TRAIN', 'AUTO', 'OTHER')
      ),
      CONSTRAINT chk_conveyance_claims_odometer CHECK (
        ending_odometer_km IS NULL OR starting_odometer_km IS NULL OR ending_odometer_km >= starting_odometer_km
      ),
      CONSTRAINT chk_conveyance_claims_distance_positive CHECK (
        claimed_distance_km >= 0
      ),
      CONSTRAINT chk_conveyance_claims_amount_positive CHECK (
        claimed_amount >= 0
      )
    );
  `.execute(db);

  // 5. Unique Constraint: Exactly 1 Active Claim per Field Visit (Duplicate Reimbursement Prevention)
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_conveyance_claims_active_visit
      ON conveyance_claims(visit_id)
      WHERE is_deleted = false AND is_tombstoned = false;
  `.execute(db);

  // 6. Query and Synchronization Indexes
  await sql`
    CREATE INDEX IF NOT EXISTS idx_conveyance_claims_engineer
      ON conveyance_claims(engineer_id);
    CREATE INDEX IF NOT EXISTS idx_conveyance_claims_submitted_by
      ON conveyance_claims(submitted_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_conveyance_claims_service_case
      ON conveyance_claims(service_case_id);
    CREATE INDEX IF NOT EXISTS idx_conveyance_claims_status
      ON conveyance_claims(claim_status);
    CREATE INDEX IF NOT EXISTS idx_conveyance_claims_travel_date
      ON conveyance_claims(travel_date);
    CREATE INDEX IF NOT EXISTS idx_conveyance_claims_client_op_id
      ON conveyance_claims(client_operation_id);
    CREATE INDEX IF NOT EXISTS idx_conveyance_claims_updated_at
      ON conveyance_claims(updated_at);
  `.execute(db);

  // 7. Enable and Force Row-Level Security on conveyance_claims
  await sql`ALTER TABLE conveyance_claims ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE conveyance_claims FORCE ROW LEVEL SECURITY`.execute(db);

  // 8. Deploy Role-Restricted Territory Lineage RLS Policies (SELECT, INSERT, UPDATE, DELETE):
  // Lineage: Conveyance Claim -> Field Visit -> Service Case -> School -> District Assignment
  // Roles: strictly MASTER_ADMIN, REPORTING_HEAD, DISTRICT_COORDINATOR, FIELD_ENGINEER
  await sql`
    DO $$ BEGIN
      DROP POLICY IF EXISTS conveyance_claims_territory_isolation ON conveyance_claims;
      DROP POLICY IF EXISTS conveyance_claims_select_policy ON conveyance_claims;
      DROP POLICY IF EXISTS conveyance_claims_insert_policy ON conveyance_claims;
      DROP POLICY IF EXISTS conveyance_claims_update_policy ON conveyance_claims;
      DROP POLICY IF EXISTS conveyance_claims_delete_policy ON conveyance_claims;

      -- SELECT Policy
      CREATE POLICY conveyance_claims_select_policy ON conveyance_claims
      FOR SELECT
      USING (
        NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
        OR
        (
          NULLIF(current_setting('zentra.current_role', true), '') = 'FIELD_ENGINEER'
          AND engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
        )
        OR
        (
          NULLIF(current_setting('zentra.current_role', true), '') = 'DISTRICT_COORDINATOR'
          AND EXISTS (
            SELECT 1 FROM field_visits fv
            JOIN service_cases sc ON sc.service_case_id = fv.service_case_id
            JOIN schools s ON s.school_id = sc.school_id
            JOIN user_territory_assignments uta ON uta.district_id = s.district_id
            WHERE fv.visit_id = conveyance_claims.visit_id
              AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
              AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
              AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
          )
        )
      );

      -- INSERT Policy (guarantees territory authorization on insert)
      CREATE POLICY conveyance_claims_insert_policy ON conveyance_claims
      FOR INSERT
      WITH CHECK (
        NULLIF(current_setting('zentra.current_role', true), '') = 'MASTER_ADMIN'
        OR
        (
          NULLIF(current_setting('zentra.current_role', true), '') = 'FIELD_ENGINEER'
          AND engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
          AND EXISTS (
            SELECT 1 FROM field_visits fv
            WHERE fv.visit_id = conveyance_claims.visit_id
              AND fv.engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
          )
        )
        OR
        (
          NULLIF(current_setting('zentra.current_role', true), '') = 'DISTRICT_COORDINATOR'
          AND EXISTS (
            SELECT 1 FROM field_visits fv
            JOIN service_cases sc ON sc.service_case_id = fv.service_case_id
            JOIN schools s ON s.school_id = sc.school_id
            JOIN user_territory_assignments uta ON uta.district_id = s.district_id
            WHERE fv.visit_id = conveyance_claims.visit_id
              AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
              AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
              AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
          )
        )
      );

      -- UPDATE Policy (guarantees territory authorization on mutation)
      CREATE POLICY conveyance_claims_update_policy ON conveyance_claims
      FOR UPDATE
      USING (
        NULLIF(current_setting('zentra.current_role', true), '') = 'MASTER_ADMIN'
        OR
        (
          NULLIF(current_setting('zentra.current_role', true), '') = 'FIELD_ENGINEER'
          AND engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
        )
        OR
        (
          NULLIF(current_setting('zentra.current_role', true), '') = 'DISTRICT_COORDINATOR'
          AND EXISTS (
            SELECT 1 FROM field_visits fv
            JOIN service_cases sc ON sc.service_case_id = fv.service_case_id
            JOIN schools s ON s.school_id = sc.school_id
            JOIN user_territory_assignments uta ON uta.district_id = s.district_id
            WHERE fv.visit_id = conveyance_claims.visit_id
              AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
              AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
              AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
          )
        )
      )
      WITH CHECK (
        NULLIF(current_setting('zentra.current_role', true), '') = 'MASTER_ADMIN'
        OR
        (
          NULLIF(current_setting('zentra.current_role', true), '') = 'FIELD_ENGINEER'
          AND engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
        )
        OR
        (
          NULLIF(current_setting('zentra.current_role', true), '') = 'DISTRICT_COORDINATOR'
          AND EXISTS (
            SELECT 1 FROM field_visits fv
            JOIN service_cases sc ON sc.service_case_id = fv.service_case_id
            JOIN schools s ON s.school_id = sc.school_id
            JOIN user_territory_assignments uta ON uta.district_id = s.district_id
            WHERE fv.visit_id = conveyance_claims.visit_id
              AND uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
              AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
              AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
          )
        )
      );

      -- DELETE Policy (restricted to MASTER_ADMIN; financial history protected)
      CREATE POLICY conveyance_claims_delete_policy ON conveyance_claims
      FOR DELETE
      USING (
        NULLIF(current_setting('zentra.current_role', true), '') = 'MASTER_ADMIN'
      );
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // 1. Drop RLS Policies & Disable RLS
  await sql`DROP POLICY IF EXISTS conveyance_claims_territory_isolation ON conveyance_claims`.execute(db);
  await sql`DROP POLICY IF EXISTS conveyance_claims_select_policy ON conveyance_claims`.execute(db);
  await sql`DROP POLICY IF EXISTS conveyance_claims_insert_policy ON conveyance_claims`.execute(db);
  await sql`DROP POLICY IF EXISTS conveyance_claims_update_policy ON conveyance_claims`.execute(db);
  await sql`DROP POLICY IF EXISTS conveyance_claims_delete_policy ON conveyance_claims`.execute(db);
  await sql`ALTER TABLE conveyance_claims NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE conveyance_claims DISABLE ROW LEVEL SECURITY`.execute(db);

  // 2. Drop Indexes
  await sql`DROP INDEX IF EXISTS idx_conveyance_claims_updated_at`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_conveyance_claims_client_op_id`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_conveyance_claims_travel_date`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_conveyance_claims_status`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_conveyance_claims_service_case`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_conveyance_claims_submitted_by`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_conveyance_claims_engineer`.execute(db);
  await sql`DROP INDEX IF EXISTS uq_conveyance_claims_active_visit`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_conveyance_rate_policies_district`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_conveyance_rate_policies_lookup`.execute(db);

  // 3. Drop Tables
  await sql`DROP TABLE IF EXISTS conveyance_claims CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS conveyance_rate_policies CASCADE`.execute(db);
}

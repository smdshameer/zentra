/**
 * ZENTRA Database Migration: Authentication, Roles, Territory Assignments and RLS
 * 20261007000001_create_auth_and_rbac.ts
 *
 * Implements Phase 5 Security Foundation:
 * - Augments `users` with `password_hash`, `account_status`, `current_device_id`
 * - `roles` & `permissions` reference tables
 * - `role_permissions` & `user_roles` join tables
 * - `user_territory_assignments` for multi-district and multi-block scoping
 * - `refresh_tokens` with cryptographic hash & token family tracking
 * - PostgreSQL Row-Level Security (RLS) policies on `schools` and `service_cases`
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Augment Users table
  await db.schema
    .alterTable('users')
    .addColumn('password_hash', 'varchar(255)')
    .addColumn('account_status', 'varchar(32)', (col) =>
      col.notNull().defaultTo('ACTIVE'),
    )
    .addColumn('current_device_id', 'varchar(128)')
    .execute();

  await sql`
    ALTER TABLE users
    ADD CONSTRAINT chk_users_account_status
    CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'ON_LEAVE', 'TERMINATED'))
  `.execute(db);

  // 2. Roles Table
  await db.schema
    .createTable('roles')
    .addColumn('role_id', 'uuid', (col) => col.primaryKey())
    .addColumn('role_code', 'varchar(64)', (col) => col.notNull().unique())
    .addColumn('role_name', 'varchar(128)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // 3. Permissions Table
  await db.schema
    .createTable('permissions')
    .addColumn('permission_id', 'uuid', (col) => col.primaryKey())
    .addColumn('permission_code', 'varchar(64)', (col) => col.notNull().unique())
    .addColumn('description', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // 4. Role-Permissions Join Table
  await db.schema
    .createTable('role_permissions')
    .addColumn('role_id', 'uuid', (col) =>
      col.notNull().references('roles.role_id').onDelete('cascade'),
    )
    .addColumn('permission_id', 'uuid', (col) =>
      col.notNull().references('permissions.permission_id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addPrimaryKeyConstraint('pk_role_permissions', ['role_id', 'permission_id'])
    .execute();

  // 5. User-Roles Join Table
  await db.schema
    .createTable('user_roles')
    .addColumn('user_role_id', 'uuid', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.user_id').onDelete('cascade'),
    )
    .addColumn('role_id', 'uuid', (col) =>
      col.notNull().references('roles.role_id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint('uq_user_roles_user_role', ['user_id', 'role_id'])
    .execute();

  // 6. User-Territory Assignments Table (Multi-District & Multi-Block)
  await db.schema
    .createTable('user_territory_assignments')
    .addColumn('assignment_id', 'uuid', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.user_id').onDelete('cascade'),
    )
    .addColumn('district_id', 'uuid', (col) =>
      col.notNull().references('districts.district_id').onDelete('restrict'),
    )
    .addColumn('block_id', 'uuid', (col) =>
      col.references('blocks.block_id').onDelete('restrict'),
    )
    .addColumn('is_primary_territory', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('valid_from', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('valid_to', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex('idx_user_territory_lookup')
    .on('user_territory_assignments')
    .columns(['user_id', 'district_id'])
    .execute();

  // 7. Refresh Tokens Table (Hashed Storage & Family Rotation)
  await db.schema
    .createTable('refresh_tokens')
    .addColumn('refresh_token_id', 'uuid', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.user_id').onDelete('cascade'),
    )
    .addColumn('token_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('family_id', 'uuid', (col) => col.notNull())
    .addColumn('is_revoked', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('device_id', 'varchar(128)')
    .addColumn('ip_address', 'varchar(64)')
    .addColumn('user_agent', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('revoked_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_refresh_tokens_hash')
    .on('refresh_tokens')
    .column('token_hash')
    .execute();

  await db.schema
    .createIndex('idx_refresh_tokens_family')
    .on('refresh_tokens')
    .column('family_id')
    .execute();

  // 8. Row-Level Security (RLS) on Schools Table
  await sql`ALTER TABLE schools ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE schools FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY schools_territory_isolation ON schools
    FOR ALL
    USING (
      NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
      OR
      EXISTS (
        SELECT 1 FROM user_territory_assignments uta
        WHERE uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
          AND uta.district_id = schools.district_id
          AND (uta.block_id IS NULL OR uta.block_id = schools.block_id)
          AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
      )
    )
  `.execute(db);

  // 9. Row-Level Security (RLS) on Service Cases Table
  await sql`ALTER TABLE service_cases ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE service_cases FORCE ROW LEVEL SECURITY`.execute(db);

  await sql`
    CREATE POLICY service_cases_territory_isolation ON service_cases
    FOR ALL
    USING (
      NULLIF(current_setting('zentra.current_role', true), '') IN ('MASTER_ADMIN', 'REPORTING_HEAD')
      OR
      (
        NULLIF(current_setting('zentra.current_role', true), '') = 'FIELD_ENGINEER'
        AND (
          service_cases.assigned_primary_engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
          OR service_cases.assigned_secondary_engineer_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
        )
      )
      OR
      EXISTS (
        SELECT 1 FROM user_territory_assignments uta
        JOIN schools s ON s.school_id = service_cases.school_id
        WHERE uta.user_id = NULLIF(current_setting('zentra.current_user_id', true), '')::uuid
          AND uta.district_id = s.district_id
          AND (uta.block_id IS NULL OR uta.block_id = s.block_id)
          AND (uta.valid_to IS NULL OR uta.valid_to > CURRENT_TIMESTAMP)
      )
    )
  `.execute(db);

  // 10. Dedicated Non-Superuser Application Role for Row-Level Security
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zentra_app') THEN
        CREATE ROLE zentra_app WITH LOGIN NOSUPERUSER;
      END IF;
      GRANT USAGE ON SCHEMA public TO zentra_app;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO zentra_app;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO zentra_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO zentra_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO zentra_app;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // 1. Drop RLS policies
  await sql`DROP POLICY IF EXISTS service_cases_territory_isolation ON service_cases`.execute(db);
  await sql`ALTER TABLE service_cases NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE service_cases DISABLE ROW LEVEL SECURITY`.execute(db);

  await sql`DROP POLICY IF EXISTS schools_territory_isolation ON schools`.execute(db);
  await sql`ALTER TABLE schools NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE schools DISABLE ROW LEVEL SECURITY`.execute(db);

  // 2. Drop Auth Tables
  await db.schema.dropTable('refresh_tokens').ifExists().execute();
  await db.schema.dropTable('user_territory_assignments').ifExists().execute();
  await db.schema.dropTable('user_roles').ifExists().execute();
  await db.schema.dropTable('role_permissions').ifExists().execute();
  await db.schema.dropTable('permissions').ifExists().execute();
  await db.schema.dropTable('roles').ifExists().execute();

  // 3. Drop columns from Users table
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_account_status`.execute(db);
  await db.schema.alterTable('users').dropColumn('current_device_id').execute();
  await db.schema.alterTable('users').dropColumn('account_status').execute();
  await db.schema.alterTable('users').dropColumn('password_hash').execute();
}

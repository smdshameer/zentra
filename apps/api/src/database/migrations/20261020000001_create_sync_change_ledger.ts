/**
 * ZENTRA Database Migration: Commit-Ordered Change Ledger & Privilege Hardening
 * 20261020000001_create_sync_change_ledger.ts
 *
 * Implements Stage 6G-B3-C4 Workstream A:
 * 1. Single-row atomic sequence tracker (sync_sequence_tracker)
 * 2. Monotonic commit-ordered append-only change ledger (sync_change_ledger)
 * 3. Atomic retention watermark tracker (sync_retention_watermark)
 * 4. PL/pgSQL deferred constraint trigger function (fn_sync_capture)
 * 5. Deferred constraint triggers across service_cases, field_visits, evidence_files, conveyance_claims
 * 6. Privilege Hardening: REVOKE TRUNCATE on all tables from zentra_app and zentra_staging_app
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Single-row sequence tracker
  await db.schema
    .createTable('sync_sequence_tracker')
    .ifNotExists()
    .addColumn('tracker_id', 'integer', (col) => col.primaryKey())
    .addColumn('current_seq', 'bigint', (col) => col.notNull().defaultTo(0))
    .execute();

  await sql`
    INSERT INTO sync_sequence_tracker (tracker_id, current_seq) VALUES (1, 0)
    ON CONFLICT (tracker_id) DO NOTHING;
  `.execute(db);

  // 2. Append-only commit-ordered change ledger
  await db.schema
    .createTable('sync_change_ledger')
    .ifNotExists()
    .addColumn('event_seq', 'bigint', (col) => col.primaryKey())
    .addColumn('entity_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('entity_id', 'uuid', (col) => col.notNull())
    .addColumn('action', 'varchar(20)', (col) => col.notNull()) // 'UPSERT' | 'TOMBSTONE'
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('district_id', 'uuid')
    .addColumn('engineer_id', 'uuid')
    .addColumn('recipient_user_id', 'uuid') // For targeted revocation tombstones
    .addColumn('data', 'jsonb')
    .addColumn('committed_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex('idx_sync_change_ledger_seq')
    .ifNotExists()
    .on('sync_change_ledger')
    .column('event_seq')
    .execute();

  await db.schema
    .createIndex('idx_sync_change_ledger_entity')
    .ifNotExists()
    .on('sync_change_ledger')
    .columns(['entity_type', 'entity_id'])
    .execute();

  await db.schema
    .createIndex('idx_sync_change_ledger_district')
    .ifNotExists()
    .on('sync_change_ledger')
    .column('district_id')
    .execute();

  await db.schema
    .createIndex('idx_sync_change_ledger_engineer')
    .ifNotExists()
    .on('sync_change_ledger')
    .column('engineer_id')
    .execute();

  await db.schema
    .createIndex('idx_sync_change_ledger_recipient')
    .ifNotExists()
    .on('sync_change_ledger')
    .column('recipient_user_id')
    .execute();

  // 3. Atomic retention watermark
  await db.schema
    .createTable('sync_retention_watermark')
    .ifNotExists()
    .addColumn('watermark_id', 'integer', (col) => col.primaryKey())
    .addColumn('min_available_seq', 'bigint', (col) => col.notNull().defaultTo(1))
    .addColumn('purged_through_seq', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('last_purged_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await sql`
    INSERT INTO sync_retention_watermark (watermark_id, min_available_seq, purged_through_seq)
    VALUES (1, 1, 0)
    ON CONFLICT (watermark_id) DO NOTHING;
  `.execute(db);

  // 4. PL/pgSQL deferred constraint trigger procedure
  await sql`
    CREATE OR REPLACE FUNCTION fn_sync_capture()
    RETURNS TRIGGER AS $$
    DECLARE
      v_next_seq BIGINT;
      v_entity_type VARCHAR(50);
      v_entity_id UUID;
      v_action VARCHAR(20);
      v_version INT := 1;
      v_data JSONB;
      v_district_id UUID;
      v_engineer_id UUID;
    BEGIN
      -- 1. No-op update suppression (skip if row contents are identical)
      IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
        RETURN NEW;
      END IF;

      -- 2. Identify entity type and primary key
      v_entity_type := TG_TABLE_NAME;
      IF TG_OP = 'DELETE' THEN
        v_action := 'TOMBSTONE';
        IF v_entity_type = 'service_cases' THEN
          v_entity_id := OLD.service_case_id;
        ELSIF v_entity_type = 'field_visits' THEN
          v_entity_id := OLD.visit_id;
        ELSIF v_entity_type = 'evidence_files' THEN
          v_entity_id := OLD.evidence_file_id;
        ELSIF v_entity_type = 'conveyance_claims' THEN
          v_entity_id := OLD.conveyance_claim_id;
        END IF;
        v_data := jsonb_build_object('entityId', v_entity_id, 'deletedAt', CURRENT_TIMESTAMP);
      ELSE
        v_action := 'UPSERT';
        IF v_entity_type = 'service_cases' THEN
          v_entity_id := NEW.service_case_id;
          v_version := COALESCE(NEW.version, 1);
          v_engineer_id := NEW.assigned_primary_engineer_id;
          SELECT district_id INTO v_district_id FROM schools WHERE school_id = NEW.school_id;
        ELSIF v_entity_type = 'field_visits' THEN
          v_entity_id := NEW.visit_id;
          v_version := COALESCE(NEW.version, 1);
          v_engineer_id := NEW.engineer_id;
          SELECT s.district_id INTO v_district_id FROM service_cases sc JOIN schools s ON s.school_id = sc.school_id WHERE sc.service_case_id = NEW.service_case_id;
        ELSIF v_entity_type = 'evidence_files' THEN
          v_entity_id := NEW.evidence_file_id;
          v_version := COALESCE(NEW.version, 1);
          v_engineer_id := NEW.created_by_user_id;
          SELECT s.district_id INTO v_district_id FROM service_cases sc JOIN schools s ON s.school_id = sc.school_id WHERE sc.service_case_id = NEW.service_case_id;
        ELSIF v_entity_type = 'conveyance_claims' THEN
          v_entity_id := NEW.conveyance_claim_id;
          v_version := COALESCE(NEW.version, 1);
          v_engineer_id := NEW.engineer_id;
          SELECT s.district_id INTO v_district_id FROM field_visits fv JOIN service_cases sc ON sc.service_case_id = fv.service_case_id JOIN schools s ON s.school_id = sc.school_id WHERE fv.visit_id = NEW.visit_id;
        END IF;
        v_data := to_jsonb(NEW);
      END IF;

      -- 3. Terminal pre-commit counter increment
      UPDATE sync_sequence_tracker
      SET current_seq = current_seq + 1
      WHERE tracker_id = 1
      RETURNING current_seq INTO v_next_seq;

      -- 4. Append to change ledger
      INSERT INTO sync_change_ledger (
        event_seq, entity_type, entity_id, action, version, district_id, engineer_id, data, committed_at
      ) VALUES (
        v_next_seq, v_entity_type, v_entity_id, v_action, v_version, v_district_id, v_engineer_id, v_data, CURRENT_TIMESTAMP
      );

      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      ELSE
        RETURN NEW;
      END IF;
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);

  // 5. Attach deferred constraint triggers
  const tables = ['service_cases', 'field_visits', 'evidence_files', 'conveyance_claims'];
  for (const table of tables) {
    await sql`
      DROP TRIGGER IF EXISTS trg_sync_${sql.raw(table)} ON ${sql.raw(table)};
      CREATE CONSTRAINT TRIGGER trg_sync_${sql.raw(table)}
      AFTER INSERT OR UPDATE OR DELETE ON ${sql.raw(table)}
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION fn_sync_capture();
    `.execute(db);
  }

  // 6. Privilege Hardening: REVOKE TRUNCATE to prevent row-trigger bypass
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zentra_app') THEN
        REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM zentra_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM zentra_app;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zentra_staging_app') THEN
        REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM zentra_staging_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM zentra_staging_app;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  const tables = ['service_cases', 'field_visits', 'evidence_files', 'conveyance_claims'];
  for (const table of tables) {
    await sql`
      DROP TRIGGER IF EXISTS trg_sync_${sql.raw(table)} ON ${sql.raw(table)};
    `.execute(db);
  }

  await sql`DROP FUNCTION IF EXISTS fn_sync_capture()`.execute(db);

  await db.schema.dropTable('sync_retention_watermark').ifExists().cascade().execute();
  await db.schema.dropTable('sync_change_ledger').ifExists().cascade().execute();
  await db.schema.dropTable('sync_sequence_tracker').ifExists().cascade().execute();
}

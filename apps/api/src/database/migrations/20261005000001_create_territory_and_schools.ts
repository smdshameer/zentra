/**
 * ZENTRA Database Migration: Territory and Schools
 * 20261005000001_create_territory_and_schools.ts
 *
 * Implements the core geographical hierarchy:
 * District -> Block -> School -> Lab
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. Districts
  await db.schema
    .createTable('districts')
    .addColumn('district_id', 'uuid', (col) => col.primaryKey())
    .addColumn('district_code', 'varchar(10)', (col) => col.notNull().unique())
    .addColumn('district_name', 'varchar(100)', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // 2. Blocks
  await db.schema
    .createTable('blocks')
    .addColumn('block_id', 'uuid', (col) => col.primaryKey())
    .addColumn('district_id', 'uuid', (col) =>
      col.notNull().references('districts.district_id').onDelete('restrict'),
    )
    .addColumn('block_code', 'varchar(20)', (col) => col.notNull())
    .addColumn('block_name', 'varchar(100)', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint('uq_blocks_district_code', ['district_id', 'block_code'])
    .addUniqueConstraint('uq_blocks_district_name', ['district_id', 'block_name'])
    .execute();

  await db.schema
    .createIndex('idx_blocks_district_id')
    .on('blocks')
    .column('district_id')
    .execute();

  // 3. Schools
  await db.schema
    .createTable('schools')
    .addColumn('school_id', 'uuid', (col) => col.primaryKey())
    .addColumn('udise_code', 'varchar(11)', (col) => col.notNull().unique())
    .addColumn('school_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('district_id', 'uuid', (col) =>
      col.notNull().references('districts.district_id').onDelete('restrict'),
    )
    .addColumn('block_id', 'uuid', (col) =>
      col.notNull().references('blocks.block_id').onDelete('restrict'),
    )
    .addColumn('school_category', 'varchar(50)', (col) => col.notNull().defaultTo('OTHER'))
    .addColumn('base_pincode', 'varchar(6)')
    .addColumn('is_special_zone', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('latitude', 'decimal(10, 8)')
    .addColumn('longitude', 'decimal(11, 8)')
    .addColumn('hm_name', 'varchar(150)')
    .addColumn('hm_phone', 'varchar(20)')
    .addColumn('ai_name', 'varchar(150)')
    .addColumn('ai_phone', 'varchar(20)')
    .addColumn('ai_emp_id', 'varchar(50)')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex('idx_schools_district_id')
    .on('schools')
    .column('district_id')
    .execute();
  await db.schema.createIndex('idx_schools_block_id').on('schools').column('block_id').execute();
  await db.schema
    .createIndex('idx_schools_udise_code')
    .on('schools')
    .column('udise_code')
    .execute();

  // 4. Hi-Tech Labs (1:N with schools)
  await db.schema
    .createTable('hi_tech_labs')
    .addColumn('lab_id', 'uuid', (col) => col.primaryKey())
    .addColumn('school_id', 'uuid', (col) =>
      col.notNull().references('schools.school_id').onDelete('restrict'),
    )
    .addColumn('lab_code', 'varchar(50)', (col) => col.notNull())
    .addColumn('lab_type', 'varchar(50)', (col) => col.notNull().defaultTo('PRIMARY'))
    .addColumn('room_location', 'varchar(255)')
    .addColumn('active_computers_count', 'integer', (col) => col.notNull().defaultTo(10))
    .addColumn('commissioning_date', 'date')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint('uq_hi_tech_labs_school_code', ['school_id', 'lab_code'])
    .execute();

  await db.schema
    .createIndex('idx_hi_tech_labs_school_id')
    .on('hi_tech_labs')
    .column('school_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('hi_tech_labs').ifExists().cascade().execute();
  await db.schema.dropTable('schools').ifExists().cascade().execute();
  await db.schema.dropTable('blocks').ifExists().cascade().execute();
  await db.schema.dropTable('districts').ifExists().cascade().execute();
}

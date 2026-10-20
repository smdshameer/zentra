/**
 * ZENTRA Database Migration: Equipment Master & Instances
 * 20261005000002_create_equipment_master.ts
 *
 * Implements:
 * - oem_manufacturers
 * - equipment_types
 * - equipment_attribute_definitions (configuration-driven dynamic fields)
 * - lab_equipment (physical unit instances with JSONB custom attributes)
 */

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. OEM Manufacturers
  await db.schema
    .createTable('oem_manufacturers')
    .addColumn('oem_id', 'uuid', (col) => col.primaryKey())
    .addColumn('oem_name', 'varchar(100)', (col) => col.notNull().unique())
    .addColumn('oem_code', 'varchar(50)', (col) => col.unique())
    .addColumn('support_contact_info', 'text')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // 2. Equipment Types / Categories
  await db.schema
    .createTable('equipment_types')
    .addColumn('equipment_type_id', 'uuid', (col) => col.primaryKey())
    .addColumn('type_code', 'varchar(50)', (col) => col.notNull().unique())
    .addColumn('type_name', 'varchar(100)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  // 3. Equipment Attribute Definitions
  await db.schema
    .createTable('equipment_attribute_definitions')
    .addColumn('attribute_def_id', 'uuid', (col) => col.primaryKey())
    .addColumn('equipment_type_id', 'uuid', (col) =>
      col.notNull().references('equipment_types.equipment_type_id').onDelete('cascade'),
    )
    .addColumn('attribute_key', 'varchar(100)', (col) => col.notNull())
    .addColumn('attribute_label', 'varchar(150)', (col) => col.notNull())
    .addColumn('data_type', 'varchar(50)', (col) => col.notNull().defaultTo('STRING'))
    .addColumn('dropdown_options', 'jsonb')
    .addColumn('is_diagnostic_field', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('is_required', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addUniqueConstraint('uq_attribute_defs_type_key', ['equipment_type_id', 'attribute_key'])
    .execute();

  await db.schema
    .createIndex('idx_attribute_defs_equipment_type')
    .on('equipment_attribute_definitions')
    .column('equipment_type_id')
    .execute();

  // 4. Lab Equipment Instances
  await db.schema
    .createTable('lab_equipment')
    .addColumn('lab_equipment_id', 'uuid', (col) => col.primaryKey())
    .addColumn('lab_id', 'uuid', (col) =>
      col.notNull().references('hi_tech_labs.lab_id').onDelete('restrict'),
    )
    .addColumn('equipment_type_id', 'uuid', (col) =>
      col.notNull().references('equipment_types.equipment_type_id').onDelete('restrict'),
    )
    .addColumn('oem_id', 'uuid', (col) =>
      col.references('oem_manufacturers.oem_id').onDelete('set null'),
    )
    .addColumn('oem_name', 'varchar(100)')
    .addColumn('model_number', 'varchar(100)')
    .addColumn('serial_number', 'varchar(100)')
    .addColumn('asset_barcode', 'varchar(100)')
    .addColumn('installation_date', 'date')
    .addColumn('warranty_end_date', 'date')
    .addColumn('operational_condition', 'varchar(50)', (col) =>
      col.notNull().defaultTo('OPERATIONAL'),
    )
    .addColumn('custom_attributes', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
    )
    .execute();

  await db.schema
    .createIndex('idx_lab_equipment_lab_id')
    .on('lab_equipment')
    .column('lab_id')
    .execute();
  await db.schema
    .createIndex('idx_lab_equipment_type_id')
    .on('lab_equipment')
    .column('equipment_type_id')
    .execute();
  await db.schema
    .createIndex('idx_lab_equipment_oem_id')
    .on('lab_equipment')
    .column('oem_id')
    .execute();
  await db.schema
    .createIndex('idx_lab_equipment_serial_number')
    .on('lab_equipment')
    .column('serial_number')
    .execute();

  // GIN Index on custom_attributes JSONB
  await sql`CREATE INDEX idx_lab_equipment_custom_attributes ON lab_equipment USING gin (custom_attributes jsonb_path_ops);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('lab_equipment').ifExists().cascade().execute();
  await db.schema.dropTable('equipment_attribute_definitions').ifExists().cascade().execute();
  await db.schema.dropTable('equipment_types').ifExists().cascade().execute();
  await db.schema.dropTable('oem_manufacturers').ifExists().cascade().execute();
}

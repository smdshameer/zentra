/**
 * ZENTRA — Synthetic Development Fixtures (Zero Real Data)
 * apps/api/src/database/seeds/synthetic-dev-fixtures.ts
 *
 * Strict Compliance with Safety Directive:
 * NEVER use real school PII, real government staff contacts,
 * or production data in development/test seeds.
 *
 * Implements Phase 5 Security Fixtures:
 * - Canonical roles (MASTER_ADMIN, REPORTING_HEAD, DISTRICT_COORDINATOR, FIELD_ENGINEER, AI, HM)
 * - Fine-grained permissions and role_permissions bindings
 * - Synthetic test users with Scrypt hashed credentials ('ZentraDev#2026')
 * - Multi-district territory scoping fixtures (District A & District B)
 */

import { Kysely } from 'kysely';
import type { DatabaseSchema } from '../database.types';
import { generateUuidV7 } from '@zentra/shared';
import { PasswordService } from '../../modules/auth/password.service';
import type { UserRole } from '@zentra/types';

/**
 * SYNTHETIC TEST-ONLY CREDENTIAL NOTICE:
 * The constant below is strictly for ISOLATED LOCAL TESTING / AUTOMATED FIXTURES ONLY.
 * It is NEVER used in staging or production environments.
 * It must NEVER be reused outside isolated, ephemeral test runs.
 */
export const SYNTHETIC_TEST_PASSWORD = 'TestDevPassword!NonProd2026';

export interface SeededEntities {
  districtId: string;
  secondDistrictId: string;
  blockId: string;
  blockA2Id: string;
  secondBlockId: string;
  schoolId: string;
  schoolA1_2Id: string;
  schoolA2_1Id: string;
  secondSchoolId: string;
  labId: string;
  school1Lab2Id: string;
  school2LabId: string;
  school3LabId: string;
  secondLabId: string;
  oemId: string;
  equipmentTypeId: string;
  equipmentId: string;
  userId: string; // Field Engineer (District A)
  adminUserId: string; // Master Admin
  reportingHeadUserId: string; // Reporting Head
  erodeCoordinatorUserId: string; // District Coordinator (District A)
  salemCoordinatorUserId: string; // District Coordinator (District B)
  suspendedUserId: string; // Suspended Field Engineer
  onLeaveUserId: string; // On-Leave Field Engineer
  terminatedUserId: string; // Terminated Field Engineer
  complaintSourceId: string;
  sourceComplaintId: string;
  secondSourceComplaintId: string;
  serviceCaseId: string;
  secondServiceCaseId: string;
  visitId: string;
  roleIds: Record<UserRole, string>;
}

export async function seedSyntheticDevelopmentFixtures(
  db: Kysely<DatabaseSchema>,
): Promise<SeededEntities> {
  const districtId = generateUuidV7();
  const secondDistrictId = generateUuidV7();
  const blockId = generateUuidV7();
  const blockA2Id = generateUuidV7();
  const secondBlockId = generateUuidV7();
  const schoolId = generateUuidV7();
  const schoolA1_2Id = generateUuidV7();
  const schoolA2_1Id = generateUuidV7();
  const secondSchoolId = generateUuidV7();
  const labId = generateUuidV7();
  const school1Lab2Id = generateUuidV7();
  const school2LabId = generateUuidV7();
  const school3LabId = generateUuidV7();
  const secondLabId = generateUuidV7();
  const oemId = generateUuidV7();
  const equipmentTypeId = generateUuidV7();
  const equipmentId = generateUuidV7();
  const userId = generateUuidV7();
  const adminUserId = generateUuidV7();
  const reportingHeadUserId = generateUuidV7();
  const erodeCoordinatorUserId = generateUuidV7();
  const salemCoordinatorUserId = generateUuidV7();
  const suspendedUserId = generateUuidV7();
  const onLeaveUserId = generateUuidV7();
  const terminatedUserId = generateUuidV7();
  const complaintSourceId = generateUuidV7();
  const sourceComplaintId = generateUuidV7();
  const secondSourceComplaintId = generateUuidV7();
  const serviceCaseId = generateUuidV7();
  const secondServiceCaseId = generateUuidV7();
  const visitId = generateUuidV7();

  // 1. Demo Districts
  await db
    .insertInto('districts')
    .values([
      {
        district_id: districtId,
        district_code: 'DEMO_DIS',
        district_name: 'ZENTRA Demo District A (Erode)',
      },
      {
        district_id: secondDistrictId,
        district_code: 'DEMO_SAL',
        district_name: 'ZENTRA Demo District B (Salem)',
      },
    ])
    .execute();

  // 2. Demo Blocks
  await db
    .insertInto('blocks')
    .values([
      {
        block_id: blockId,
        district_id: districtId,
        block_code: 'DEMO_BLK',
        block_name: 'Demo Central Block',
      },
      {
        block_id: blockA2Id,
        district_id: districtId,
        block_code: 'DEMO_BLK_EAST',
        block_name: 'Demo East Block',
      },
      {
        block_id: secondBlockId,
        district_id: secondDistrictId,
        block_code: 'DEMO_BLK_SAL',
        block_name: 'Demo Salem North Block',
      },
    ])
    .execute();

  // 3. Demo Schools
  await db
    .insertInto('schools')
    .values([
      {
        school_id: schoolId,
        udise_code: '33100000001',
        school_name: 'ZENTRA Demo Model Higher Secondary School',
        district_id: districtId,
        block_id: blockId,
        latitude: '10.76543200',
        longitude: '79.84321000',
        school_category: 'Higher Secondary',
      },
      {
        school_id: schoolA1_2Id,
        udise_code: '33100000003',
        school_name: 'ZENTRA Demo City High School',
        district_id: districtId,
        block_id: blockId,
        latitude: '10.76800000',
        longitude: '79.84500000',
        school_category: 'High School',
      },
      {
        school_id: schoolA2_1Id,
        udise_code: '33100000004',
        school_name: 'ZENTRA Demo Rural Model School',
        district_id: districtId,
        block_id: blockA2Id,
        latitude: '10.78000000',
        longitude: '79.85500000',
        school_category: 'Model School',
      },
      {
        school_id: secondSchoolId,
        udise_code: '33100000002',
        school_name: 'ZENTRA Demo Salem Model Girls High School',
        district_id: secondDistrictId,
        block_id: secondBlockId,
        latitude: '11.66432500',
        longitude: '78.14601400',
        school_category: 'Girls High School',
      },
    ])
    .execute();

  // 4. Demo Hi-Tech Labs
  await db
    .insertInto('hi_tech_labs')
    .values([
      {
        lab_id: labId,
        school_id: schoolId,
        lab_code: 'DEMO-LAB-01',
        lab_type: 'PRIMARY',
        room_location: 'Room 204 - 1st Floor IT Wing',
        active_computers_count: 20,
      },
      {
        lab_id: school1Lab2Id,
        school_id: schoolId,
        lab_code: 'DEMO-LAB-02',
        lab_type: 'ATAL_TINKERING',
        room_location: 'Room 105 - ATAL Tinkering Hub',
        active_computers_count: 15,
      },
      {
        lab_id: school2LabId,
        school_id: schoolA1_2Id,
        lab_code: 'DEMO-LAB-01',
        lab_type: 'PRIMARY',
        room_location: 'Room 101 - Computer Wing',
        active_computers_count: 10,
      },
      {
        lab_id: school3LabId,
        school_id: schoolA2_1Id,
        lab_code: 'DEMO-LAB-01',
        lab_type: 'PRIMARY',
        room_location: 'Main Building Lab A',
        active_computers_count: 12,
      },
      {
        lab_id: secondLabId,
        school_id: secondSchoolId,
        lab_code: 'DEMO-SAL-LAB-01',
        lab_type: 'PRIMARY',
        room_location: 'IT Lab Ground Floor',
        active_computers_count: 20,
      },
    ])
    .execute();

  // 5. Demo OEM Manufacturer
  await db
    .insertInto('oem_manufacturers')
    .values({
      oem_id: oemId,
      oem_code: 'DEMO_OEM',
      oem_name: 'ZENTRA Demo OEM Solutions Ltd',
      support_contact_info: 'support@demooem.local',
    })
    .execute();

  // 6. Demo Equipment Type
  await db
    .insertInto('equipment_types')
    .values({
      equipment_type_id: equipmentTypeId,
      type_code: 'DEMO_UPS',
      type_name: 'Uninterruptible Power Supply (UPS)',
      description: 'Online UPS with battery bank',
    })
    .execute();

  // 7. Demo Equipment Attribute Definitions (All 4 canonical dynamic data types)
  await db
    .insertInto('equipment_attribute_definitions')
    .values([
      {
        attribute_def_id: generateUuidV7(),
        equipment_type_id: equipmentTypeId,
        attribute_key: 'battery_bank_voltage',
        attribute_label: 'Battery Bank Voltage (V)',
        data_type: 'NUMBER',
        is_diagnostic_field: true,
        is_required: true,
      },
      {
        attribute_def_id: generateUuidV7(),
        equipment_type_id: equipmentTypeId,
        attribute_key: 'battery_health_status',
        attribute_label: 'Battery Health Status',
        data_type: 'DROPDOWN',
        dropdown_options: JSON.stringify(['OPTIMAL', 'DEGRADED', 'REPLACE_REQUIRED']),
        is_diagnostic_field: true,
        is_required: false,
      },
      {
        attribute_def_id: generateUuidV7(),
        equipment_type_id: equipmentTypeId,
        attribute_key: 'bypass_switch_present',
        attribute_label: 'Bypass Switch Present',
        data_type: 'BOOLEAN',
        is_diagnostic_field: false,
        is_required: false,
      },
      {
        attribute_def_id: generateUuidV7(),
        equipment_type_id: equipmentTypeId,
        attribute_key: 'firmware_version',
        attribute_label: 'Firmware Version',
        data_type: 'TEXT',
        is_diagnostic_field: false,
        is_required: false,
      },
    ])
    .execute();

  // 8. Demo Lab Equipment Instance
  await db
    .insertInto('lab_equipment')
    .values({
      lab_equipment_id: equipmentId,
      lab_id: labId,
      equipment_type_id: equipmentTypeId,
      oem_id: oemId,
      oem_name: 'ZENTRA Demo OEM Solutions',
      model_number: 'DEMO-UPS-5KVA',
      serial_number: 'DEMO-SN-2026-0001',
      operational_condition: 'OPERATIONAL',
      custom_attributes: {
        battery_bank_voltage: 48,
        battery_health_status: 'OPTIMAL',
        bypass_switch_present: true,
        firmware_version: 'v2.4.1',
      },
    })
    .execute();

  // 9. Roles & Permissions Seed
  const roleCodes: UserRole[] = [
    'MASTER_ADMIN',
    'REPORTING_HEAD',
    'DISTRICT_COORDINATOR',
    'FIELD_ENGINEER',
    'AI',
    'HM',
  ];

  const roleIds = {} as Record<UserRole, string>;
  for (const code of roleCodes) {
    const roleId = generateUuidV7();
    roleIds[code] = roleId;
    await db
      .insertInto('roles')
      .values({
        role_id: roleId,
        role_code: code,
        role_name: code.replace(/_/g, ' '),
        description: `Canonical system role: ${code}`,
        is_active: true,
      })
      .execute();
  }

  // Permissions
  const permissionsList = [
    { code: 'schools:read', desc: 'Read school details' },
    { code: 'schools:write', desc: 'Mutate school details' },
    { code: 'service_cases:read', desc: 'Read service cases' },
    { code: 'service_cases:write', desc: 'Mutate service cases' },
    { code: 'dispatch:manage', desc: 'Dispatch engineer assignments' },
    { code: 'audit:read', desc: 'Read immutable audit log' },
    { code: 'equipment:read', desc: 'Read equipment master and lab instances' },
    { code: 'equipment:write', desc: 'Create and update lab equipment instances' },
    { code: 'equipment:admin', desc: 'Manage OEM and Equipment Type definitions' },
    { code: 'imports:read', desc: 'Read import jobs and staging records' },
    { code: 'imports:write', desc: 'Create and stage batch spreadsheet imports' },
    { code: 'imports:approve', desc: 'Approve and commit staging records' },
    { code: 'cases:read', desc: 'Read service cases' },
    { code: 'cases:write', desc: 'Create service cases' },
    { code: 'cases:transition', desc: 'Transition service case operational status' },
    { code: 'cases:dispatch', desc: 'Dispatch and assign field engineers' },
    { code: 'sla:read', desc: 'Read SLA policies and live calculations' },
  ];

  for (const perm of permissionsList) {
    const permId = generateUuidV7();
    await db
      .insertInto('permissions')
      .values({
        permission_id: permId,
        permission_code: perm.code,
        description: perm.desc,
      })
      .execute();

    // Assign all to MASTER_ADMIN
    await db
      .insertInto('role_permissions')
      .values({
        role_id: roleIds.MASTER_ADMIN,
        permission_id: permId,
      })
      .execute();

    // Assign strictly read/audit permissions to REPORTING_HEAD (no dispatch, no mutations)
    if (
      perm.code === 'schools:read' ||
      perm.code === 'service_cases:read' ||
      perm.code === 'audit:read' ||
      perm.code === 'equipment:read' ||
      perm.code === 'imports:read' ||
      perm.code === 'cases:read' ||
      perm.code === 'sla:read'
    ) {
      await db
        .insertInto('role_permissions')
        .values({
          role_id: roleIds.REPORTING_HEAD,
          permission_id: permId,
        })
        .execute();
    }

    // Assign operational and coordinator capabilities to DISTRICT_COORDINATOR
    if (
      perm.code === 'imports:read' ||
      perm.code === 'imports:write' ||
      perm.code === 'imports:approve' ||
      perm.code === 'schools:read' ||
      perm.code === 'schools:write' ||
      perm.code === 'equipment:read' ||
      perm.code === 'service_cases:read' ||
      perm.code === 'service_cases:write' ||
      perm.code === 'dispatch:manage' ||
      perm.code === 'cases:read' ||
      perm.code === 'cases:write' ||
      perm.code === 'cases:transition' ||
      perm.code === 'cases:dispatch' ||
      perm.code === 'sla:read'
    ) {
      await db
        .insertInto('role_permissions')
        .values({
          role_id: roleIds.DISTRICT_COORDINATOR,
          permission_id: permId,
        })
        .execute();
    }

    // Assign operational field capabilities to FIELD_ENGINEER
    if (
      perm.code === 'schools:read' ||
      perm.code === 'equipment:read' ||
      perm.code === 'service_cases:read' ||
      perm.code === 'cases:read' ||
      perm.code === 'cases:transition' ||
      perm.code === 'sla:read'
    ) {
      await db
        .insertInto('role_permissions')
        .values({
          role_id: roleIds.FIELD_ENGINEER,
          permission_id: permId,
        })
        .execute();
    }
  }

  // 10. Synthetic Users (Hashed Passwords)
  const passwordService = new PasswordService();
  const defaultPasswordHash = await passwordService.hash(SYNTHETIC_TEST_PASSWORD);

  // Insert Users
  await db
    .insertInto('users')
    .values([
      {
        user_id: adminUserId,
        username: 'admin.demo@zentra.test',
        full_name: 'Demo Master Admin',
        phone_number: '+919999900001',
        password_hash: defaultPasswordHash,
        account_status: 'ACTIVE',
      },
      {
        user_id: reportingHeadUserId,
        username: 'reporting.head@zentra.test',
        full_name: 'Demo State Reporting Head',
        phone_number: '+919999900002',
        password_hash: defaultPasswordHash,
        account_status: 'ACTIVE',
      },
      {
        user_id: erodeCoordinatorUserId,
        username: 'coordinator.erode@zentra.test',
        full_name: 'Demo Erode District Coordinator',
        phone_number: '+919999900003',
        password_hash: defaultPasswordHash,
        account_status: 'ACTIVE',
      },
      {
        user_id: salemCoordinatorUserId,
        username: 'coordinator.salem@zentra.test',
        full_name: 'Demo Salem District Coordinator',
        phone_number: '+919999900004',
        password_hash: defaultPasswordHash,
        account_status: 'ACTIVE',
      },
      {
        user_id: userId,
        username: 'engineer.demo@zentra.local',
        full_name: 'Demo Field Engineer',
        phone_number: '+919999900005',
        password_hash: defaultPasswordHash,
        account_status: 'ACTIVE',
      },
      {
        user_id: suspendedUserId,
        username: 'engineer.suspended@zentra.test',
        full_name: 'Demo Suspended Engineer',
        phone_number: '+919999900006',
        password_hash: defaultPasswordHash,
        account_status: 'SUSPENDED',
      },
      {
        user_id: onLeaveUserId,
        username: 'engineer.onleave@zentra.test',
        full_name: 'Demo On-Leave Engineer',
        phone_number: '+919999900007',
        password_hash: defaultPasswordHash,
        account_status: 'ON_LEAVE',
      },
      {
        user_id: terminatedUserId,
        username: 'engineer.terminated@zentra.test',
        full_name: 'Demo Terminated Engineer',
        phone_number: '+919999900008',
        password_hash: defaultPasswordHash,
        account_status: 'TERMINATED',
      },
    ])
    .execute();

  // Assign User Roles
  await db
    .insertInto('user_roles')
    .values([
      {
        user_role_id: generateUuidV7(),
        user_id: adminUserId,
        role_id: roleIds.MASTER_ADMIN,
      },
      {
        user_role_id: generateUuidV7(),
        user_id: reportingHeadUserId,
        role_id: roleIds.REPORTING_HEAD,
      },
      {
        user_role_id: generateUuidV7(),
        user_id: erodeCoordinatorUserId,
        role_id: roleIds.DISTRICT_COORDINATOR,
      },
      {
        user_role_id: generateUuidV7(),
        user_id: salemCoordinatorUserId,
        role_id: roleIds.DISTRICT_COORDINATOR,
      },
      {
        user_role_id: generateUuidV7(),
        user_id: userId,
        role_id: roleIds.FIELD_ENGINEER,
      },
      {
        user_role_id: generateUuidV7(),
        user_id: suspendedUserId,
        role_id: roleIds.FIELD_ENGINEER,
      },
      {
        user_role_id: generateUuidV7(),
        user_id: onLeaveUserId,
        role_id: roleIds.FIELD_ENGINEER,
      },
      {
        user_role_id: generateUuidV7(),
        user_id: terminatedUserId,
        role_id: roleIds.FIELD_ENGINEER,
      },
    ])
    .execute();

  // Assign User Territories
  await db
    .insertInto('user_territory_assignments')
    .values([
      // Erode Coordinator -> District A
      {
        assignment_id: generateUuidV7(),
        user_id: erodeCoordinatorUserId,
        district_id: districtId,
        block_id: null,
        is_primary_territory: true,
      },
      // Salem Coordinator -> District B
      {
        assignment_id: generateUuidV7(),
        user_id: salemCoordinatorUserId,
        district_id: secondDistrictId,
        block_id: null,
        is_primary_territory: true,
      },
      // Field Engineer -> District A, Block A
      {
        assignment_id: generateUuidV7(),
        user_id: userId,
        district_id: districtId,
        block_id: blockId,
        is_primary_territory: true,
      },
    ])
    .execute();

  // 11. Demo Complaint Source
  await db
    .insertInto('complaint_sources')
    .values({
      source_system_id: complaintSourceId,
      system_code: 'DEMO_HELPLINE',
      system_name: 'State Education Toll-Free Helpline',
      description: 'Central Helpline Ticketing Portal',
    })
    .execute();

  // 12. Demo Source Complaints (District A and District B)
  await db
    .insertInto('source_complaints')
    .values([
      {
        source_complaint_id: sourceComplaintId,
        source_system_id: complaintSourceId,
        external_ticket_id: 'DEMO-TKT-2026-999',
        school_id: schoolId,
        lab_id: labId,
        original_title: 'UPS Backup Failure during power cut',
        original_description: 'Lab UPS shutting down immediately after grid supply fails.',
        registered_at: new Date('2026-10-01T09:00:00Z'),
        source_status: 'Open',
        source_priority: 'HIGH',
        reported_equipment_text: 'UPS 5KVA',
        reported_serial_number: 'DEMO-SN-2026-0001',
        reporter_name: 'Demo School Coordinator',
        reporter_phone: '+919999900004',
        raw_payload: { intake_channel: 'PHONE', caller_role: 'TEACHER' },
      },
      {
        source_complaint_id: secondSourceComplaintId,
        source_system_id: complaintSourceId,
        external_ticket_id: 'DEMO-TKT-2026-1000',
        school_id: secondSchoolId,
        lab_id: secondLabId,
        original_title: 'Display monitor not turning on',
        original_description: 'Monitor power LED blinking orange.',
        registered_at: new Date('2026-10-02T10:00:00Z'),
        source_status: 'Open',
        source_priority: 'MEDIUM',
        reported_equipment_text: 'LED Monitor',
        reported_serial_number: null,
        reporter_name: 'Salem School Headmaster',
        reporter_phone: '+919999900010',
        raw_payload: { intake_channel: 'WEB' },
      },
    ])
    .execute();

  // 13. Demo Service Cases (District A and District B)
  await db
    .insertInto('service_cases')
    .values([
      {
        service_case_id: serviceCaseId,
        source_complaint_id: sourceComplaintId,
        zentra_case_code: 'ZNT-2026-DEMO-000001',
        school_id: schoolId,
        lab_id: labId,
        lab_equipment_id: equipmentId,
        operational_status: 'ASSIGNED',
        internal_priority: 'HIGH',
        assigned_primary_engineer_id: userId,
        assigned_at: new Date('2026-10-01T09:30:00Z'),
      },
      {
        service_case_id: secondServiceCaseId,
        source_complaint_id: secondSourceComplaintId,
        zentra_case_code: 'ZNT-2026-DEMO-000002',
        school_id: secondSchoolId,
        lab_id: secondLabId,
        lab_equipment_id: null,
        operational_status: 'REGISTERED',
        internal_priority: 'MEDIUM',
        assigned_primary_engineer_id: null,
        assigned_at: null,
      },
    ])
    .execute();

  // 14. Demo Field Visit
  await db
    .insertInto('field_visits')
    .values({
      visit_id: visitId,
      service_case_id: serviceCaseId,
      engineer_id: userId,
      visit_sequence_number: 1,
      visit_date: '2026-10-02',
      check_in_timestamp: new Date('2026-10-02T10:00:00Z'),
      check_in_latitude: '10.76543200',
      check_in_longitude: '79.84321000',
      check_in_accuracy_meters: '8.50',
      check_in_within_geofence: true,
      equipment_condition_observed: 'DEGRADED',
      on_site_diagnosis: 'Battery 3 terminal corroded causing open circuit.',
      work_performed: 'Cleaned terminal, re-torqued lugs, calibrated float voltage.',
      visit_outcome: 'RESOLVED_ON_SITE',
      check_out_timestamp: new Date('2026-10-02T11:45:00Z'),
      check_out_latitude: '10.76543200',
      check_out_longitude: '79.84321000',
      check_out_accuracy_meters: '9.00',
      conveyance_km: '24.50',
      client_operation_id: generateUuidV7(),
    })
    .execute();

  return {
    districtId,
    secondDistrictId,
    blockId,
    blockA2Id,
    secondBlockId,
    schoolId,
    schoolA1_2Id,
    schoolA2_1Id,
    secondSchoolId,
    labId,
    school1Lab2Id,
    school2LabId,
    school3LabId,
    secondLabId,
    oemId,
    equipmentTypeId,
    equipmentId,
    userId,
    adminUserId,
    reportingHeadUserId,
    erodeCoordinatorUserId,
    salemCoordinatorUserId,
    suspendedUserId,
    onLeaveUserId,
    terminatedUserId,
    complaintSourceId,
    sourceComplaintId,
    secondSourceComplaintId,
    serviceCaseId,
    secondServiceCaseId,
    visitId,
    roleIds,
  };
}

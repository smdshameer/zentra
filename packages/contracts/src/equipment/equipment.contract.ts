/**
 * ZENTRA — Equipment Master & Dynamic Attribute Contracts & Validation Schemas
 * packages/contracts/src/equipment/equipment.contract.ts
 */

import { z } from 'zod';

// ==========================================
// 1. OEM Manufacturers
// ==========================================

export const createOemSchema = z.object({
  oemName: z
    .string()
    .trim()
    .min(2, 'OEM name must have at least 2 characters')
    .max(100, 'OEM name cannot exceed 100 characters'),
  oemCode: z
    .string()
    .trim()
    .max(50, 'OEM code cannot exceed 50 characters')
    .optional()
    .nullable(),
  supportContactInfo: z
    .string()
    .trim()
    .max(500, 'Support contact info cannot exceed 500 characters')
    .optional()
    .nullable(),
});

export const updateOemSchema = z.object({
  oemName: z.string().trim().min(2).max(100).optional(),
  oemCode: z.string().trim().max(50).optional().nullable(),
  supportContactInfo: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

export type CreateOemDto = z.infer<typeof createOemSchema>;
export type UpdateOemDto = z.infer<typeof updateOemSchema>;

// ==========================================
// 2. Equipment Types
// ==========================================

export const createEquipmentTypeSchema = z.object({
  typeCode: z
    .string()
    .trim()
    .min(2, 'Type code must have at least 2 characters')
    .max(50, 'Type code cannot exceed 50 characters')
    .regex(/^[A-Z0-9_-]+$/i, 'Type code must contain alphanumeric characters, hyphens or underscores'),
  typeName: z
    .string()
    .trim()
    .min(2, 'Type name must have at least 2 characters')
    .max(100, 'Type name cannot exceed 100 characters'),
  description: z.string().trim().max(1000).optional().nullable(),
});

export const updateEquipmentTypeSchema = z.object({
  typeCode: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[A-Z0-9_-]+$/i, 'Type code must contain alphanumeric characters, hyphens or underscores')
    .optional(),
  typeName: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export type CreateEquipmentTypeDto = z.infer<typeof createEquipmentTypeSchema>;
export type UpdateEquipmentTypeDto = z.infer<typeof updateEquipmentTypeSchema>;

// ==========================================
// 3. Equipment Attribute Definitions
// ==========================================

export const attributeDataTypeEnum = z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'DROPDOWN', 'STRING']);

export const createAttributeDefinitionSchema = z
  .object({
    attributeKey: z
      .string()
      .trim()
      .min(1, 'Attribute key is required')
      .max(100, 'Attribute key cannot exceed 100 characters')
      .regex(/^[a-z0-9_]+$/i, 'Attribute key must contain alphanumeric characters or underscores'),
    attributeLabel: z
      .string()
      .trim()
      .min(1, 'Attribute label is required')
      .max(150, 'Attribute label cannot exceed 150 characters'),
    dataType: attributeDataTypeEnum.default('TEXT'),
    dropdownOptions: z
      .array(z.string().trim().min(1))
      .optional()
      .nullable(),
    isDiagnosticField: z.boolean().default(false),
    isRequired: z.boolean().default(false),
  })
  .refine(
    (data) => {
      if (data.dataType === 'DROPDOWN') {
        return Array.isArray(data.dropdownOptions) && data.dropdownOptions.length > 0;
      }
      return true;
    },
    {
      message: 'Dropdown data type requires a non-empty array of dropdownOptions',
      path: ['dropdownOptions'],
    },
  );

export const updateAttributeDefinitionSchema = z
  .object({
    attributeLabel: z.string().trim().min(1).max(150).optional(),
    dataType: attributeDataTypeEnum.optional(),
    dropdownOptions: z
      .array(z.string().trim().min(1))
      .optional()
      .nullable(),
    isDiagnosticField: z.boolean().optional(),
    isRequired: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.dataType === 'DROPDOWN' && data.dropdownOptions !== undefined) {
        return Array.isArray(data.dropdownOptions) && data.dropdownOptions.length > 0;
      }
      return true;
    },
    {
      message: 'Dropdown data type requires a non-empty array of dropdownOptions',
      path: ['dropdownOptions'],
    },
  );

export type CreateAttributeDefinitionDto = z.infer<typeof createAttributeDefinitionSchema>;
export type UpdateAttributeDefinitionDto = z.infer<typeof updateAttributeDefinitionSchema>;

// ==========================================
// 4. Lab Equipment Instances
// ==========================================

export const operationalConditionEnum = z.enum([
  'OPERATIONAL',
  'DEGRADED',
  'CRITICAL_FAULT',
  'REPLACED',
  'DECOMMISSIONED',
  'NON_OPERATIONAL',
  'UNDER_MAINTENANCE',
]);

export const createEquipmentSchema = z.object({
  labId: z.string().uuid('Invalid labId UUID format'),
  equipmentTypeId: z.string().uuid('Invalid equipmentTypeId UUID format'),
  oemId: z.string().uuid('Invalid oemId UUID format').optional().nullable(),
  oemName: z.string().trim().max(100).optional().nullable(),
  modelNumber: z.string().trim().max(100).optional().nullable(),
  serialNumber: z.string().trim().max(100).optional().nullable(),
  assetBarcode: z.string().trim().max(100).optional().nullable(),
  installationDate: z.string().optional().nullable(),
  warrantyEndDate: z.string().optional().nullable(),
  operationalCondition: operationalConditionEnum.default('OPERATIONAL'),
  customAttributes: z.record(z.unknown()).default({}),
});

export const updateEquipmentSchema = z.object({
  equipmentTypeId: z.string().uuid('Invalid equipmentTypeId UUID format').optional(),
  oemId: z.string().uuid('Invalid oemId UUID format').optional().nullable(),
  oemName: z.string().trim().max(100).optional().nullable(),
  modelNumber: z.string().trim().max(100).optional().nullable(),
  serialNumber: z.string().trim().max(100).optional().nullable(),
  assetBarcode: z.string().trim().max(100).optional().nullable(),
  installationDate: z.string().optional().nullable(),
  warrantyEndDate: z.string().optional().nullable(),
  operationalCondition: operationalConditionEnum.optional(),
  customAttributes: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export const equipmentQuerySchema = z.object({
  labId: z.string().uuid().optional(),
  schoolId: z.string().uuid().optional(),
  districtId: z.string().uuid().optional(),
  equipmentTypeId: z.string().uuid().optional(),
  oemId: z.string().uuid().optional(),
  serialNumber: z.string().optional(),
  assetBarcode: z.string().optional(),
  operationalCondition: z.string().optional(),
  search: z.string().optional(),
  isActive: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const validateAttributesSchema = z.object({
  equipmentTypeId: z.string().uuid('Invalid equipmentTypeId UUID format'),
  customAttributes: z.record(z.unknown()),
});

export type CreateEquipmentDto = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentDto = z.infer<typeof updateEquipmentSchema>;
export type EquipmentQueryDto = z.infer<typeof equipmentQuerySchema>;
export type ValidateAttributesDto = z.infer<typeof validateAttributesSchema>;

/**
 * ZENTRA — School & Lab Domain Contracts & Validation Schemas
 * packages/contracts/src/schools/schools.contract.ts
 */

import { z } from 'zod';

export const createSchoolSchema = z.object({
  udiseCode: z
    .string()
    .regex(/^\d{11}$/, 'UDISE code must be exactly 11 numeric digits'),
  schoolName: z
    .string()
    .trim()
    .min(2, 'School name must have at least 2 characters')
    .max(255, 'School name cannot exceed 255 characters'),
  districtId: z.string().uuid('Invalid districtId UUID format'),
  blockId: z.string().uuid('Invalid blockId UUID format'),
  schoolCategory: z.string().trim().max(50).default('OTHER'),
  basePincode: z
    .string()
    .regex(/^\d{6}$/, 'PIN code must be exactly 6 digits')
    .optional()
    .nullable(),
  isSpecialZone: z.boolean().default(false),
  latitude: z
    .union([z.number().min(-90).max(90), z.string().regex(/^-?\d+(\.\d+)?$/)])
    .optional()
    .nullable(),
  longitude: z
    .union([z.number().min(-180).max(180), z.string().regex(/^-?\d+(\.\d+)?$/)])
    .optional()
    .nullable(),
  hmName: z.string().trim().max(150).optional().nullable(),
  hmPhone: z.string().trim().max(20).optional().nullable(),
  aiName: z.string().trim().max(150).optional().nullable(),
  aiPhone: z.string().trim().max(20).optional().nullable(),
  aiEmpId: z.string().trim().max(50).optional().nullable(),
});

export const updateSchoolSchema = z.object({
  schoolName: z.string().trim().min(2).max(255).optional(),
  districtId: z.string().uuid('Invalid districtId UUID format').optional(),
  blockId: z.string().uuid('Invalid blockId UUID format').optional(),
  schoolCategory: z.string().trim().max(50).optional(),
  basePincode: z
    .string()
    .regex(/^\d{6}$/, 'PIN code must be exactly 6 digits')
    .optional()
    .nullable(),
  isSpecialZone: z.boolean().optional(),
  latitude: z
    .union([z.number().min(-90).max(90), z.string().regex(/^-?\d+(\.\d+)?$/)])
    .optional()
    .nullable(),
  longitude: z
    .union([z.number().min(-180).max(180), z.string().regex(/^-?\d+(\.\d+)?$/)])
    .optional()
    .nullable(),
  hmName: z.string().trim().max(150).optional().nullable(),
  hmPhone: z.string().trim().max(20).optional().nullable(),
  aiName: z.string().trim().max(150).optional().nullable(),
  aiPhone: z.string().trim().max(20).optional().nullable(),
  aiEmpId: z.string().trim().max(50).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const createLabSchema = z.object({
  labCode: z
    .string()
    .trim()
    .min(1, 'Lab code is required')
    .max(50, 'Lab code cannot exceed 50 characters'),
  labType: z.string().trim().max(50).default('PRIMARY'),
  roomLocation: z.string().trim().max(255).optional().nullable(),
  activeComputersCount: z.coerce.number().int().min(0).max(500).default(10),
  commissioningDate: z.string().optional().nullable(),
});

export const updateLabSchema = z.object({
  labCode: z.string().trim().min(1).max(50).optional(),
  labType: z.string().trim().max(50).optional(),
  roomLocation: z.string().trim().max(255).optional().nullable(),
  activeComputersCount: z.coerce.number().int().min(0).max(500).optional(),
  commissioningDate: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const schoolQuerySchema = z.object({
  districtId: z.string().uuid().optional(),
  blockId: z.string().uuid().optional(),
  udiseCode: z.string().optional(),
  search: z.string().optional(),
  isActive: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSchoolDto = z.infer<typeof createSchoolSchema>;
export type UpdateSchoolDto = z.infer<typeof updateSchoolSchema>;
export type CreateLabDto = z.infer<typeof createLabSchema>;
export type UpdateLabDto = z.infer<typeof updateLabSchema>;
export type SchoolQueryDto = z.infer<typeof schoolQuerySchema>;

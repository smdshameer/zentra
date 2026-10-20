/**
 * ZENTRA — Dynamic Attribute Engine Service
 * apps/api/src/modules/equipment/services/dynamic-attribute-engine.service.ts
 *
 * Implements Configuration-Driven Dynamic Attribute Validation:
 * - Validates instance custom_attributes against equipment_attribute_definitions
 * - Strictly verifies data types: TEXT, NUMBER, BOOLEAN, DROPDOWN
 * - Enforces required attributes
 * - Validates DROPDOWN allowed values
 * - Disallows invalid type coercion (e.g. non-numeric string to number)
 */

import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseSchema } from '../../../database/database.types';
import { AttributeDefinitionsRepository } from '../repositories/attribute-definitions.repository';

export interface AttributeValidationResult {
  isValid: boolean;
  errors: string[];
}

@Injectable()
export class DynamicAttributeEngineService {
  constructor(
    @Inject(AttributeDefinitionsRepository)
    private readonly attributeDefsRepo: AttributeDefinitionsRepository,
  ) {}

  /**
   * Validates custom attributes against the active attribute definitions for an equipment type.
   */
  async validate(
    equipmentTypeId: string,
    customAttributes: Record<string, unknown>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<AttributeValidationResult> {
    const definitions = await this.attributeDefsRepo.findByTypeId(equipmentTypeId, trx);
    const errors: string[] = [];

    // Map definitions by attribute_key
    const defMap = new Map(definitions.map((d) => [d.attribute_key, d]));

    // 1. Check required attributes
    for (const def of definitions) {
      if (def.is_required) {
        const val = customAttributes[def.attribute_key];
        if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
          errors.push(
            `Attribute '${def.attribute_label}' (${def.attribute_key}) is required but was not provided or is empty.`,
          );
        }
      }
    }

    // 2. Validate provided attribute types & constraints
    for (const [key, val] of Object.entries(customAttributes)) {
      if (val === undefined || val === null) {
        continue;
      }

      const def = defMap.get(key);
      if (!def) {
        // Undeclared attribute: allowed as arbitrary metadata or ignored,
        // but if strict checking is needed, we continue.
        continue;
      }

      const dataType = (def.data_type || 'TEXT').toUpperCase();

      switch (dataType) {
        case 'TEXT':
        case 'STRING': {
          if (typeof val !== 'string') {
            errors.push(
              `Attribute '${def.attribute_label}' (${key}) must be a text string, received ${typeof val}.`,
            );
          }
          break;
        }

        case 'NUMBER': {
          if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
            errors.push(
              `Attribute '${def.attribute_label}' (${key}) must be a valid finite number, received ${typeof val} (${String(val)}).`,
            );
          }
          break;
        }

        case 'BOOLEAN': {
          if (typeof val !== 'boolean') {
            errors.push(
              `Attribute '${def.attribute_label}' (${key}) must be a boolean (true/false), received ${typeof val}.`,
            );
          }
          break;
        }

        case 'DROPDOWN': {
          if (typeof val !== 'string') {
            errors.push(
              `Attribute '${def.attribute_label}' (${key}) must be a string matching one of the dropdown options.`,
            );
            break;
          }

          let allowedOptions: string[] = [];
          if (Array.isArray(def.dropdown_options)) {
            allowedOptions = def.dropdown_options.map((opt) =>
              typeof opt === 'string' ? opt : String((opt as any)?.value ?? opt),
            );
          }

          if (allowedOptions.length > 0 && !allowedOptions.includes(val)) {
            errors.push(
              `Attribute '${def.attribute_label}' (${key}) has invalid value '${val}'. Allowed options: [${allowedOptions.join(', ')}].`,
            );
          }
          break;
        }

        default: {
          // Fallback check
          break;
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates custom attributes and throws BadRequestException if any constraints fail.
   */
  async validateOrThrow(
    equipmentTypeId: string,
    customAttributes: Record<string, unknown>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Record<string, unknown>> {
    const result = await this.validate(equipmentTypeId, customAttributes, trx);
    if (!result.isValid) {
      throw new BadRequestException({
        message: 'Dynamic attribute validation failed',
        errors: result.errors,
      });
    }
    return customAttributes;
  }
}

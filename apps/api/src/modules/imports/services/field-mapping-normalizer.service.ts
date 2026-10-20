/**
 * ZENTRA — Field Mapping & Normalization Service
 * apps/api/src/modules/imports/services/field-mapping-normalizer.service.ts
 *
 * Implements Intelligent Dynamic Column Mapping, Deterministic Normalization,
 * and Mandatory Field Validation while strictly preserving original raw values.
 */

import { Injectable } from '@nestjs/common';

export interface NormalizedRowResult {
  rowNumber: number;
  rawRowData: Record<string, unknown>;
  mappedExternalTicketId: string | null;
  mappedUdiseCode: string | null;
  mappedSchoolName: string | null;
  mappedIssueText: string | null;
  mappedPriority: string;
  mappedEquipmentText: string | null;
  mappedSerialNumber: string | null;
  mappedReporterName: string | null;
  mappedReporterPhone: string | null;
  mappedRegisteredDate: Date;
  mappedRemarks: string | null;
  isValid: boolean;
  validationErrorMessage: string | null;
}

// Known column aliases (lowercased, trimmed, punctuation stripped)
const ALIAS_MAP: Record<string, string[]> = {
  externalTicketId: [
    'ticketid',
    'ticketno',
    'ticketnumber',
    'complaintticketid',
    'complaintid',
    'complaintno',
    'externalid',
    'externalticketid',
    'callid',
    'incidentid',
    'referenceid',
    'refid',
    'ticket',
  ],
  udiseCode: [
    'udise',
    'udisecode',
    'schooludise',
    'schoolcode',
    'udiseno',
    'emiscode',
    'udiseid',
  ],
  schoolName: [
    'schoolname',
    'school',
    'nameofschool',
    'institutionname',
    'institution',
  ],
  issueText: [
    'issue',
    'problem',
    'complaint',
    'description',
    'issuedescription',
    'problemdescription',
    'complaintdescription',
    'faultdescription',
    'fault',
    'natureofcomplaint',
    'issuetext',
  ],
  priority: [
    'priority',
    'severity',
    'urgency',
    'prioritylevel',
  ],
  equipmentText: [
    'equipment',
    'equipmenttype',
    'item',
    'itemname',
    'component',
    'device',
    'hardware',
    'hardwarecategory',
    'category',
  ],
  serialNumber: [
    'serialnumber',
    'serialno',
    'serial',
    'sn',
    'assetserial',
    'equipmentserial',
  ],
  reporterName: [
    'reportername',
    'reportedby',
    'contactname',
    'teachername',
    'hmname',
    'instructorname',
    'callername',
  ],
  reporterPhone: [
    'reporterphone',
    'phone',
    'phoneno',
    'phonenumber',
    'mobile',
    'mobileno',
    'mobilenumber',
    'contactno',
    'contactnumber',
  ],
  registeredDate: [
    'registereddate',
    'complaintdate',
    'reporteddate',
    'incidentdate',
    'date',
    'createddate',
    'datetime',
  ],
  remarks: [
    'remarks',
    'comment',
    'comments',
    'notes',
    'additionalnotes',
    'originalremarks',
  ],
};

@Injectable()
export class FieldMappingNormalizerService {
  /**
   * Normalizes a raw spreadsheet row into mapped canonical fields and runs validation.
   */
  normalizeRow(
    rawRow: Record<string, unknown>,
    rowNumber: number,
    customMapping?: Record<string, string>,
  ): NormalizedRowResult {
    const keyMap = this.buildRowKeyMap(rawRow, customMapping);

    // 1. Extract values
    const rawTicketId = this.extractValue(rawRow, keyMap, 'externalTicketId');
    const rawUdise = this.extractValue(rawRow, keyMap, 'udiseCode');
    const rawSchoolName = this.extractValue(rawRow, keyMap, 'schoolName');
    const rawIssue = this.extractValue(rawRow, keyMap, 'issueText');
    const rawPriority = this.extractValue(rawRow, keyMap, 'priority');
    const rawEquipment = this.extractValue(rawRow, keyMap, 'equipmentText');
    const rawSerial = this.extractValue(rawRow, keyMap, 'serialNumber');
    const rawReporterName = this.extractValue(rawRow, keyMap, 'reporterName');
    const rawReporterPhone = this.extractValue(rawRow, keyMap, 'reporterPhone');
    const rawDate = this.extractValue(rawRow, keyMap, 'registeredDate');
    const rawRemarks = this.extractValue(rawRow, keyMap, 'remarks');

    // 2. Normalize values
    const mappedExternalTicketId = rawTicketId ? String(rawTicketId).trim() : null;
    const mappedUdiseCode = this.normalizeUdise(rawUdise);
    const mappedSchoolName = rawSchoolName ? String(rawSchoolName).trim() : null;
    const mappedIssueText = rawIssue ? String(rawIssue).trim() : null;
    const mappedPriority = this.normalizePriority(rawPriority);
    const mappedEquipmentText = rawEquipment ? String(rawEquipment).trim() : null;
    const mappedSerialNumber = rawSerial ? String(rawSerial).trim() : null;
    const mappedReporterName = rawReporterName ? String(rawReporterName).trim() : null;
    const mappedReporterPhone = this.normalizePhone(rawReporterPhone);
    const mappedRegisteredDate = this.normalizeDate(rawDate);
    const mappedRemarks = rawRemarks ? String(rawRemarks).trim() : null;

    // 3. Mandatory-field validation
    const errors: string[] = [];

    // Problem description is mandatory
    if (!mappedIssueText || mappedIssueText.length === 0) {
      errors.push('MISSING_REQUIRED_FIELD: Problem/complaint description is missing or empty.');
    }

    // UDISE code is mandatory and must be exactly 11 digits
    if (!rawUdise || String(rawUdise).trim() === '') {
      errors.push('INVALID_UDISE: School UDISE code is missing.');
    } else {
      const trimmedUdise = String(rawUdise).trim();
      if (!/^\d{11}$/.test(trimmedUdise)) {
        errors.push(`INVALID_UDISE: School UDISE code '${trimmedUdise}' must be exactly 11 digits.`);
      }
    }

    const isValid = errors.length === 0;
    const validationErrorMessage = isValid ? null : errors.join('; ');

    return {
      rowNumber,
      rawRowData: rawRow,
      mappedExternalTicketId,
      mappedUdiseCode,
      mappedSchoolName,
      mappedIssueText,
      mappedPriority,
      mappedEquipmentText,
      mappedSerialNumber,
      mappedReporterName,
      mappedReporterPhone,
      mappedRegisteredDate,
      mappedRemarks,
      isValid,
      validationErrorMessage,
    };
  }

  private normalizeUdise(val: unknown): string | null {
    if (!val) return null;
    const str = String(val).trim();
    const digitsOnly = str.replace(/\D/g, '');
    if (digitsOnly.length === 11) {
      return digitsOnly;
    }
    // Cap to 11 characters to fit varchar(11) database constraint safely
    return str.slice(0, 11);
  }

  private normalizePriority(val: unknown): string {
    if (!val) return 'MEDIUM';
    const s = String(val).trim().toUpperCase();
    if (['CRITICAL', 'URGENT', 'P1'].includes(s)) return 'CRITICAL';
    if (['HIGH', 'P2'].includes(s)) return 'HIGH';
    if (['MEDIUM', 'NORMAL', 'MODERATE', 'P3'].includes(s)) return 'MEDIUM';
    if (['LOW', 'MINOR', 'P4'].includes(s)) return 'LOW';
    return 'MEDIUM';
  }

  private normalizePhone(val: unknown): string | null {
    if (!val) return null;
    const str = String(val).trim();
    const digits = str.replace(/\D/g, '');
    if (digits.length >= 10) {
      return digits.slice(-10); // 10-digit Indian standard
    }
    return str;
  }

  private normalizeDate(val: unknown): Date {
    if (!val) return new Date();
    if (val instanceof Date && !isNaN(val.getTime())) {
      return val;
    }
    const d = new Date(String(val));
    if (!isNaN(d.getTime())) {
      return d;
    }
    return new Date();
  }

  private buildRowKeyMap(
    rawRow: Record<string, unknown>,
    customMapping?: Record<string, string>,
  ): Map<string, string> {
    // Maps standard field names -> actual row keys
    const result = new Map<string, string>();
    const rowKeys = Object.keys(rawRow);

    // Apply custom mapping first
    if (customMapping) {
      for (const [targetField, sourceColumn] of Object.entries(customMapping)) {
        if (rowKeys.includes(sourceColumn)) {
          result.set(targetField, sourceColumn);
        }
      }
    }

    // Auto-detect aliases for unmapped target fields
    for (const [targetField, aliases] of Object.entries(ALIAS_MAP)) {
      if (result.has(targetField)) continue;

      for (const key of rowKeys) {
        const sanitizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (aliases.includes(sanitizedKey)) {
          result.set(targetField, key);
          break;
        }
      }
    }

    return result;
  }

  private extractValue(
    rawRow: Record<string, unknown>,
    keyMap: Map<string, string>,
    targetField: string,
  ): unknown {
    const actualKey = keyMap.get(targetField);
    if (!actualKey) return undefined;
    return rawRow[actualKey];
  }
}

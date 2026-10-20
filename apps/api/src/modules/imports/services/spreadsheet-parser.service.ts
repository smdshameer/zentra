/**
 * ZENTRA — Spreadsheet Ingestion & Parser Service
 * apps/api/src/modules/imports/services/spreadsheet-parser.service.ts
 *
 * Implements safe, untrusted spreadsheet file ingestion for XLSX, XLS, and CSV.
 * Security guarantees:
 * - Extension and size verification (max 15MB)
 * - Safe parsing with zero macro execution
 * - Row limits enforcement (max 10,000 rows)
 * - Empty row and empty file filtering
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

export interface ParsedSpreadsheet {
  sheetName: string;
  totalRows: number;
  headers: string[];
  rows: Record<string, unknown>[];
}

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_ROW_LIMIT = 10000;

@Injectable()
export class SpreadsheetParserService {
  /**
   * Parses an XLSX, XLS, or CSV buffer safely.
   */
  parseBuffer(buffer: Buffer, fileName: string, fileType?: string): ParsedSpreadsheet {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty (0 bytes).');
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `File size (${(buffer.length / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size of 15MB.`,
      );
    }

    // Determine extension
    const extension = this.extractExtension(fileName, fileType);
    if (!['xlsx', 'xls', 'csv'].includes(extension)) {
      throw new BadRequestException(
        `Unsupported file type '.${extension}'. ZENTRA only accepts .xlsx, .xls, and .csv files.`,
      );
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        raw: false,
        dense: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Malformed file or parser error: ${msg}`);
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new BadRequestException('Spreadsheet contains no sheets or readable data.');
    }

    const firstSheetName = workbook.SheetNames[0]!;
    const worksheet = workbook.Sheets[firstSheetName];
    if (!worksheet) {
      throw new BadRequestException(`Sheet '${firstSheetName}' could not be read.`);
    }

    // Convert sheet to JSON array
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      raw: false,
      defval: '',
      blankrows: false,
    });

    if (rawRows.length === 0) {
      throw new BadRequestException(
        'Spreadsheet contains no data rows (empty sheet or only blank rows).',
      );
    }

    if (rawRows.length > MAX_ROW_LIMIT) {
      throw new BadRequestException(
        `Row count (${rawRows.length}) exceeds maximum batch limit of ${MAX_ROW_LIMIT} rows.`,
      );
    }

    // Filter completely empty rows and extract headers
    const headersSet = new Set<string>();
    const cleanedRows: Record<string, unknown>[] = [];

    for (const row of rawRows) {
      const hasContent = Object.values(row).some(
        (val) => val !== null && val !== undefined && String(val).trim() !== '',
      );
      if (hasContent) {
        cleanedRows.push(row);
        for (const key of Object.keys(row)) {
          headersSet.add(key.trim());
        }
      }
    }

    if (cleanedRows.length === 0) {
      throw new BadRequestException('All rows in the spreadsheet are blank.');
    }

    return {
      sheetName: firstSheetName,
      totalRows: cleanedRows.length,
      headers: Array.from(headersSet),
      rows: cleanedRows,
    };
  }

  /**
   * Parses CSV content string.
   */
  parseCsvString(csvContent: string, fileName = 'import.csv'): ParsedSpreadsheet {
    const buffer = Buffer.from(csvContent, 'utf-8');
    return this.parseBuffer(buffer, fileName, 'CSV');
  }

  private extractExtension(fileName: string, fileType?: string): string {
    if (fileType) {
      return fileType.toLowerCase().replace(/^\./, '');
    }
    const parts = fileName.split('.');
    if (parts.length > 1) {
      return parts[parts.length - 1]!.toLowerCase();
    }
    return 'csv';
  }
}

/**
 * ZENTRA — Five-Tier Duplicate Classification Engine
 * apps/api/src/modules/imports/services/duplicate-classification-engine.service.ts
 *
 * Implements the authoritative 5-tier duplicate classification hierarchy:
 * - Tier 1: EXACT_SOURCE_DUPLICATE (Identical source_system + external_ticket_id)
 * - Tier 2: NEW_UNIQUE (Valid school, zero conflicting active issues)
 * - Tier 3: NEW_ISSUE_DIFFERENT_EQUIPMENT (Same school, different hardware failure)
 * - Tier 4: ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT (Same school & equipment, active unresolved issue / Chaser)
 * - Tier 5: REOPENED_POST_SERVICE_FAILURE (Same school & equipment, resolved within 7 days)
 *
 * Also identifies in-file duplicates (DUPLICATE_IN_FILE).
 */

import { Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';
import type { SourceComplaintsTable } from '../../../database/database.types';
import type { DuplicateClassificationTier } from '@zentra/types';
import type { NormalizedRowResult } from './field-mapping-normalizer.service';

export interface ClassificationResult {
  tier: DuplicateClassificationTier;
  reason: string;
  confidence: number;
  recommendedAction: string;
  matchedEntityId?: string | null;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CLOSED_STATUSES = new Set(['closed', 'resolved', 'verified']);

@Injectable()
export class DuplicateClassificationEngineService {
  /**
   * Classifies an inbound row against existing source complaints and in-batch tracking.
   */
  classifyRow(
    row: NormalizedRowResult,
    resolvedSchoolId: string | null,
    sourceSystemId: string,
    existingComplaintsForSchool: Selectable<SourceComplaintsTable>[],
    exactSourceMatches: Map<string, Selectable<SourceComplaintsTable>>,
    seenBatchTicketKeys: Map<string, number>,
    seenBatchSchoolEquipmentKeys: Map<string, number>,
  ): ClassificationResult {
    // 1. Check for in-batch duplicate external ticket ID
    if (row.mappedExternalTicketId) {
      const batchTicketKey = `${sourceSystemId}:${row.mappedExternalTicketId.toLowerCase()}`;
      if (seenBatchTicketKeys.has(batchTicketKey)) {
        const priorRow = seenBatchTicketKeys.get(batchTicketKey);
        return {
          tier: 'DUPLICATE_IN_FILE',
          reason: `Duplicate external ticket ID within the same import batch (matches Row ${priorRow}).`,
          confidence: 0.95,
          recommendedAction: 'REJECT_DUPLICATE',
        };
      }
      seenBatchTicketKeys.set(batchTicketKey, row.rowNumber);
    }

    // 2. Tier 1: Exact Source Identity Match
    if (row.mappedExternalTicketId) {
      const matchKey = `${sourceSystemId}:${row.mappedExternalTicketId.toLowerCase()}`;
      const exactMatch = exactSourceMatches.get(matchKey);
      if (exactMatch) {
        return {
          tier: 'EXACT_SOURCE_DUPLICATE',
          reason: `Exact source system and external ticket ID match in source complaints database (${exactMatch.external_ticket_id}).`,
          confidence: 1.0,
          recommendedAction: 'REJECT_DUPLICATE',
          matchedEntityId: exactMatch.source_complaint_id,
        };
      }
    }

    // 3. If school is not resolved, fallback to NEW_UNIQUE with 0.0 confidence (flagged for review)
    if (!resolvedSchoolId) {
      return {
        tier: 'NEW_UNIQUE',
        reason: 'School could not be resolved from UDISE code; requires administrative manual review.',
        confidence: 0.0,
        recommendedAction: 'REVIEW_UNRESOLVED_SCHOOL',
      };
    }

    // 4. Check for in-batch duplicate on same school + equipment
    const equipKey = (row.mappedEquipmentText || '').trim().toLowerCase();
    if (equipKey) {
      const batchSchoolEquipKey = `${resolvedSchoolId}:${equipKey}`;
      if (seenBatchSchoolEquipmentKeys.has(batchSchoolEquipKey)) {
        const priorRow = seenBatchSchoolEquipmentKeys.get(batchSchoolEquipKey);
        return {
          tier: 'ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT',
          reason: `Multiple complaints reported for identical equipment in the same batch (matches Row ${priorRow}).`,
          confidence: 0.85,
          recommendedAction: 'REVIEW_ACTIVE_CHASER',
        };
      }
      seenBatchSchoolEquipmentKeys.set(batchSchoolEquipKey, row.rowNumber);
    }

    // 5. Evaluate existing complaints for this school
    if (!existingComplaintsForSchool || existingComplaintsForSchool.length === 0) {
      return {
        tier: 'NEW_UNIQUE',
        reason:
          'Unique complaint for school with no existing active issues in database; recommended for Phase 9 service-case processing.',
        confidence: 1.0,
        recommendedAction: 'RECOMMEND_APPROVE',
      };
    }

    // Separate active complaints vs closed complaints
    const activeComplaints = existingComplaintsForSchool.filter(
      (sc) => !CLOSED_STATUSES.has((sc.source_status || '').toLowerCase()),
    );
    const closedComplaints = existingComplaintsForSchool.filter((sc) =>
      CLOSED_STATUSES.has((sc.source_status || '').toLowerCase()),
    );

    // 6. Check for active issue on same equipment (Tier 4: Chaser)
    for (const active of activeComplaints) {
      if (this.isEquipmentOrIssueMatch(row, active)) {
        return {
          tier: 'ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT',
          reason: `Active unresolved physical issue exists for same equipment in school (Complaint ${active.external_ticket_id}; Chaser candidate).`,
          confidence: 0.85,
          recommendedAction: 'REVIEW_ACTIVE_CHASER',
          matchedEntityId: active.source_complaint_id,
        };
      }
    }

    // 7. Check for recently resolved issue on same equipment (Tier 5: Reopened / Recurring fault)
    const now = Date.now();
    for (const closed of closedComplaints) {
      if (this.isEquipmentOrIssueMatch(row, closed)) {
        const closedTime = closed.updated_at
          ? new Date(closed.updated_at).getTime()
          : new Date(closed.registered_at).getTime();
        const elapsed = now - closedTime;

        if (elapsed <= SEVEN_DAYS_MS) {
          const daysAgo = Math.max(1, Math.round(elapsed / (24 * 60 * 60 * 1000)));
          return {
            tier: 'REOPENED_POST_SERVICE_FAILURE',
            reason: `Prior service complaint on same equipment was resolved ${daysAgo} day(s) ago (within 7-day window); potential recurring fault requiring coordinator review.`,
            confidence: 0.75,
            recommendedAction: 'REVIEW_WARRANTY_CALLBACK',
            matchedEntityId: closed.source_complaint_id,
          };
        }
      }
    }

    // 8. If active complaints exist for the school on DIFFERENT equipment (Tier 3)
    if (activeComplaints.length > 0) {
      return {
        tier: 'NEW_ISSUE_DIFFERENT_EQUIPMENT',
        reason:
          'Different equipment failure in same school; distinct parallel service track with zero collision; recommended for Phase 9 service-case processing.',
        confidence: 0.9,
        recommendedAction: 'RECOMMEND_APPROVE',
      };
    }

    // 9. Default to Tier 2: New Unique Complaint
    return {
      tier: 'NEW_UNIQUE',
      reason:
        'Valid school with no active conflicting complaints; historical complaints outside recurring threshold; recommended for Phase 9 service-case processing.',
      confidence: 1.0,
      recommendedAction: 'RECOMMEND_APPROVE',
    };
  }

  private isEquipmentOrIssueMatch(
    inbound: NormalizedRowResult,
    existing: Selectable<SourceComplaintsTable>,
  ): boolean {
    const inEquip = (inbound.mappedEquipmentText || '').toLowerCase().trim();
    const exEquip = (existing.reported_equipment_text || '').toLowerCase().trim();

    // Direct equipment match
    if (inEquip && exEquip) {
      if (inEquip === exEquip || inEquip.includes(exEquip) || exEquip.includes(inEquip)) {
        return true;
      }
      // Equipment tokens (e.g. 'ups', 'router', 'camera', 'projector', 'switch')
      const tokens = ['ups', 'router', 'switch', 'camera', 'projector', 'computer', 'pc', 'monitor', 'table', 'rack'];
      for (const token of tokens) {
        if (inEquip.includes(token) && exEquip.includes(token)) {
          return true;
        }
      }
      return false;
    }

    // Serial number match
    if (inbound.mappedSerialNumber && existing.reported_serial_number) {
      if (
        inbound.mappedSerialNumber.trim().toLowerCase() ===
        existing.reported_serial_number.trim().toLowerCase()
      ) {
        return true;
      }
    }

    // Title / issue text similarity check if equipment text was blank in one of them
    const inIssue = (inbound.mappedIssueText || '').toLowerCase().trim();
    const exTitle = (existing.original_title || '').toLowerCase().trim();
    const exDesc = (existing.original_description || '').toLowerCase().trim();

    if (inIssue && (exTitle || exDesc)) {
      const keyWords = ['ups', 'beep', 'power', 'internet', 'switch', 'camera', 'cctv', 'projector', 'display'];
      for (const kw of keyWords) {
        if (inIssue.includes(kw) && (exTitle.includes(kw) || exDesc.includes(kw))) {
          return true;
        }
      }
    }

    return false;
  }
}

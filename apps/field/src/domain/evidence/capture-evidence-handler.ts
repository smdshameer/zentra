/**
 * ZENTRA Field — Explicit Evidence Capture Workflow Handler
 * apps/field/src/domain/evidence/capture-evidence-handler.ts
 *
 * Implements strict visit ID and service case ID scoping for evidence capture:
 * - Rejects missing, empty, or whitespace-only visitId or serviceCaseId (fail-closed)
 * - Queries the local database for the exact target visit via FieldVisitRepository
 * - Validates that targetVisit.serviceCaseId matches the supplied serviceCaseId
 * - Registers photo in TemporaryMediaManager only AFTER target identity validation succeeds
 * - Calls FieldEvidenceRepository.captureAndQueueEvidence using canonical target visit identities
 * - Completely eliminates unconstrained global queries and fallback inference
 */

import type { FieldVisitRepository } from '../repositories/field-visit.repository';
import type { FieldEvidenceRepository } from '../repositories/evidence.repository';
import type { TemporaryMediaManager } from '../../hardware/camera/temporary-media-manager';
import type { EvidenceModel } from '../../database/models/EvidenceModel';
import type { CaptureEvidenceCallbackParams } from '../../screens/FieldVisitScreen';

export interface CaptureEvidenceDependencies {
  fieldVisitRepo: FieldVisitRepository;
  fieldEvidenceRepo: FieldEvidenceRepository;
  temporaryMediaManager: TemporaryMediaManager;
}

export async function executeCaptureEvidence(
  deps: CaptureEvidenceDependencies,
  params: CaptureEvidenceCallbackParams,
): Promise<EvidenceModel> {
  // 1. Reject missing or blank identifiers (fail-closed)
  if (!params.visitId || !params.visitId.trim()) {
    throw new Error('Cannot capture evidence: visitId is required and cannot be blank');
  }
  if (!params.serviceCaseId || !params.serviceCaseId.trim()) {
    throw new Error('Cannot capture evidence: serviceCaseId is required and cannot be blank');
  }

  const cleanVisitId = params.visitId.trim();
  const cleanCaseId = params.serviceCaseId.trim();

  // 2. Resolve the exact target visit using the repository
  const targetVisit = await deps.fieldVisitRepo.findById(cleanVisitId);
  if (!targetVisit) {
    throw new Error(`Target field visit not found: ${cleanVisitId}`);
  }

  // 3. Verify that the supplied serviceCaseId matches the target visit's persisted serviceCaseId
  if (targetVisit.serviceCaseId !== cleanCaseId) {
    throw new Error(
      `Service case mismatch: target visit ${targetVisit.id} belongs to case ${targetVisit.serviceCaseId}, but received ${cleanCaseId}`,
    );
  }

  // 4. Register photo in temporary media manager only after identity validation succeeds
  const mediaItem = deps.temporaryMediaManager.register(params.photo);

  // 5. Persist evidence using target visit's canonical identity
  return deps.fieldEvidenceRepo.captureAndQueueEvidence({
    visitId: targetVisit.id,
    serviceCaseId: targetVisit.serviceCaseId,
    evidenceSlot: params.slot,
    mediaItem,
    gps: params.gps,
  });
}

/**
 * ZENTRA — Core Shared Types & Canonical Interfaces
 * packages/types
 */

/** Brand utility for nominal type safety */
export type Brand<K, T> = K & { readonly __brand: T };

/** UUIDv7 string representation (time-ordered 128-bit identifier) */
export type UUIDv7 = Brand<string, 'UUIDv7'>;

/** Standard ISO 8601 UTC Date-Time string */
export type ISODateTimeString = Brand<string, 'ISODateTimeString'>;

/** Request correlation identifier */
export type CorrelationId = Brand<string, 'CorrelationId'>;

/** Client-side idempotency mutation identifier */
export type ClientOperationId = Brand<string, 'ClientOperationId'>;

/** Supported runtime environment tiers */
export type AppEnvironment = 'local' | 'test' | 'development' | 'staging' | 'production';

/** Standardized API Error Categories matching Phase 2 ADR */
export type ErrorCategory =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'DEPENDENCY_FAILURE'
  | 'OFFLINE_SYNC_REJECTED';

/** Standard Pagination Metadata */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  cursor?: string;
}

/** Standard Pagination Query Parameters */
export interface PaginationQuery {
  page?: number;
  limit?: number;
  cursor?: string;
}

/** Canonical Success API Envelope */
export interface ApiResponseEnvelope<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
  correlationId: string;
  timestamp: string;
}

/** Individual error field detail */
export interface ApiErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

/** Canonical Error API Envelope */
export interface ApiErrorEnvelope {
  success: false;
  error: {
    category: ErrorCategory;
    code: string;
    message: string;
    details?: ApiErrorDetail[];
    isRetryable: boolean;
  };
  correlationId: string;
  timestamp: string;
}

/** Unified API Response type */
export type ApiResponse<T> = ApiResponseEnvelope<T> | ApiErrorEnvelope;

/** System Health Status */
export type HealthStatus = 'ok' | 'degraded' | 'down';

/** Health Check Response */
export interface ServiceHealthResponse {
  status: HealthStatus;
  uptime: number;
  timestamp: string;
  version: string;
  environment: AppEnvironment;
  services?: Record<string, { status: HealthStatus; message?: string }>;
}

/** Canonical ZENTRA Roles */
export type UserRole =
  | 'MASTER_ADMIN'
  | 'REPORTING_HEAD'
  | 'DISTRICT_COORDINATOR'
  | 'FIELD_ENGINEER'
  | 'AI'
  | 'HM';

/** Account Status Lifecycle */
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'ON_LEAVE' | 'TERMINATED';

/** Territory Assignment Model */
export interface TerritoryAssignment {
  assignmentId: string;
  userId: string;
  districtId: string;
  districtCode?: string;
  blockId: string | null;
  blockCode?: string | null;
  isPrimaryTerritory: boolean;
  validFrom: string;
  validTo: string | null;
}

/** Authenticated User Profile */
export interface UserProfile {
  userId: string;
  username: string;
  fullName: string;
  phoneNumber?: string | null;
  accountStatus: AccountStatus;
  roles: UserRole[];
  territories: TerritoryAssignment[];
}

/** Access Token JWT Claims */
export interface AccessTokenClaims {
  sub: string; // userId
  username: string;
  roles: UserRole[];
  activeRole?: UserRole; // Canonical Active-Role Model
  territoryDistrictIds: string[];
  iat: number;
  exp: number;
}

/** District Domain Model */
export interface District {
  districtId: string;
  districtCode: string;
  districtName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Block Domain Model */
export interface Block {
  blockId: string;
  districtId: string;
  blockCode: string;
  blockName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** School Category Classification */
export type SchoolCategory =
  | 'Higher Secondary'
  | 'High School'
  | 'Model School'
  | 'Girls High School'
  | 'Primary'
  | 'Middle School'
  | 'OTHER'
  | string;

/** School Domain Model */
export interface School {
  schoolId: string;
  udiseCode: string;
  schoolName: string;
  districtId: string;
  blockId: string;
  schoolCategory: SchoolCategory;
  basePincode?: string | null;
  isSpecialZone: boolean;
  latitude?: number | string | null;
  longitude?: number | string | null;
  hmName?: string | null;
  hmPhone?: string | null;
  aiName?: string | null;
  aiPhone?: string | null;
  aiEmpId?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Lab Type Classification */
export type LabType =
  | 'PRIMARY'
  | 'SECONDARY'
  | 'LANGUAGE_LAB'
  | 'ATAL_TINKERING'
  | 'OTHER'
  | string;

/** Hi-Tech Lab Domain Model */
export interface HiTechLab {
  labId: string;
  schoolId: string;
  labCode: string;
  labType: LabType;
  roomLocation?: string | null;
  activeComputersCount: number;
  commissioningDate?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** School with associated Hi-Tech Labs */
export interface SchoolWithLabs extends School {
  labs: HiTechLab[];
}

/** School Query Filters */
export interface SchoolQueryFilters {
  districtId?: string;
  blockId?: string;
  udiseCode?: string;
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

/** OEM Manufacturer Domain Model */
export interface OemManufacturer {
  oemId: string;
  oemName: string;
  oemCode: string | null;
  supportContactInfo: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Equipment Type / Category Domain Model */
export interface EquipmentType {
  equipmentTypeId: string;
  typeCode: string;
  typeName: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Supported Dynamic Attribute Data Types */
export type AttributeDataType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DROPDOWN';

/** Equipment Attribute Definition Domain Model */
export interface EquipmentAttributeDefinition {
  attributeDefId: string;
  equipmentTypeId: string;
  attributeKey: string;
  attributeLabel: string;
  dataType: AttributeDataType;
  dropdownOptions: string[] | null;
  isDiagnosticField: boolean;
  isRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Equipment Operational Condition States
 * Authoritative: OPERATIONAL, DEGRADED, CRITICAL_FAULT, REPLACED, DECOMMISSIONED (docs/ZENTRA_DATA_MODEL.md)
 * Candidate / Configurable: NON_OPERATIONAL, UNDER_MAINTENANCE
 * Note: RETIRED is not established in authoritative specifications and is removed.
 */
export type OperationalCondition =
  | 'OPERATIONAL'
  | 'DEGRADED'
  | 'CRITICAL_FAULT'
  | 'REPLACED'
  | 'DECOMMISSIONED'
  | 'NON_OPERATIONAL'
  | 'UNDER_MAINTENANCE'
  | string;

/** Lab Equipment Instance Domain Model */
export interface LabEquipment {
  labEquipmentId: string;
  labId: string;
  equipmentTypeId: string;
  oemId: string | null;
  oemName: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  assetBarcode: string | null;
  installationDate: string | null;
  warrantyEndDate: string | null;
  operationalCondition: OperationalCondition;
  customAttributes: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Lab Equipment Instance with Relational Hierarchy Details */
export interface LabEquipmentWithDetails extends LabEquipment {
  typeName?: string;
  typeCode?: string;
  oemCode?: string | null;
  labCode?: string;
  schoolId?: string;
  schoolName?: string;
  udiseCode?: string;
  districtId?: string;
  districtName?: string;
}

/** Equipment Query Filters */
export interface EquipmentQueryFilters {
  labId?: string;
  schoolId?: string;
  districtId?: string;
  equipmentTypeId?: string;
  oemId?: string;
  serialNumber?: string;
  assetBarcode?: string;
  operationalCondition?: string;
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

// ==========================================
// Phase 8: Staged Ingestion & Deduplication Domain Types
// ==========================================

/** Canonical 5-Tier Duplicate Classification Tiers */
export type DuplicateClassificationTier =
  | 'EXACT_SOURCE_DUPLICATE'
  | 'NEW_UNIQUE'
  | 'NEW_ISSUE_DIFFERENT_EQUIPMENT'
  | 'ACTIVE_ISSUE_EXISTS_SAME_EQUIPMENT'
  | 'REOPENED_POST_SERVICE_FAILURE'
  | 'DUPLICATE_IN_FILE';

/** Import Job Lifecycle Statuses */
export type ImportJobStatus =
  | 'RECEIVED'
  | 'PARSING'
  | 'STAGED'
  | 'VALIDATED'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'COMMITTED'
  | 'FAILED'
  | 'REJECTED'
  | 'UPLOADED'
  | 'DIFF_PREVIEWED'
  | 'ABORTED';

/** Supported File Types for Ingestion */
export type ImportFileType = 'XLSX' | 'XLS' | 'CSV';

/** Import Job Domain Entity */
export interface ImportJob {
  importJobId: string;
  uploadedByUserId: string | null;
  sourceSystemId: string | null;
  sourceSystemCode?: string;
  sourceFilename: string;
  fileType: ImportFileType | string;
  fileHashSha256?: string | null;
  fileSizeBytes?: number | null;
  totalRowsParsed: number;
  validRowsCount: number;
  duplicateRowsCount: number;
  errorRowsCount: number;
  jobStatus: ImportJobStatus;
  createdAt: string;
  committedAt: string | null;
}

/** Import Staging Record Domain Entity */
export interface ImportStagingRecord {
  stagingRecordId: string;
  importJobId: string;
  rowNumber?: number | null;
  rawRowData: Record<string, unknown>;
  mappedUdiseCode: string | null;
  resolvedSchoolId: string | null;
  schoolName?: string;
  districtName?: string;
  mappedExternalTicketId: string | null;
  mappedIssueText: string | null;
  mappedPriority: string | null;
  duplicateClassification: DuplicateClassificationTier | string;
  duplicateReason?: string | null;
  duplicateConfidence?: number | null;
  recommendedAction?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  matchedSourceComplaintId?: string | null;
  committedSourceComplaintId?: string | null;
  validationErrorMessage: string | null;
  isApprovedForCommit: boolean;
  createdAt: string;
}

/** Import Summary & Quality Statistics */
export interface ImportJobStatistics {
  importJobId: string;
  totalRowsParsed: number;
  validRowsCount: number;
  duplicateRowsCount: number;
  errorRowsCount: number;
  reviewRequiredCount: number;
  approvedCount: number;
  committedCount: number;
}

/** Authoritative 10-State Service Case Operational Lifecycle */
export type OperationalStatus =
  | 'REGISTERED'
  | 'ASSIGNED'
  | 'IN_TRANSIT'
  | 'VISIT_STARTED'
  | 'IN_PROGRESS'
  | 'PENDING_PARTS'
  | 'ESCALATED_OEM'
  | 'RESOLVED'
  | 'VERIFIED'
  | 'CLOSED';

/** Service Case Coordinator Verification Status */
export type VerificationStatus =
  | 'PENDING_REVIEW'
  | 'VERIFIED_BY_COORDINATOR'
  | 'REJECTED_NEEDS_REVISIT';

/** SLA Compliance and Breach Status */
export type SlaBreachStatus =
  | 'WITHIN_SLA'
  | 'APPROACHING_BREACH'
  | 'BREACHED'
  | 'MET';

/** Canonical Case Internal Priority */
export type CasePriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Engineer Assignment Role */
export type AssignmentRole = 'PRIMARY' | 'SECONDARY';

/** Dispatch Action Indicator */
export type AssignmentAction = 'ASSIGNED' | 'REASSIGNED' | 'UNASSIGNED';

/** SLA Policy Configuration */
export interface SlaPolicy {
  slaPolicyId: string;
  policyName: string;
  priorityLevel: CasePriority | string;
  targetResolutionHours: number;
  warningThresholdPercentage: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Service Case Operational Domain Entity */
export interface ServiceCase {
  serviceCaseId: string;
  sourceComplaintId: string;
  zentraCaseCode: string;
  schoolId: string;
  schoolName?: string;
  udiseCode?: string;
  districtId?: string;
  districtName?: string;
  labId: string;
  labCode?: string;
  labEquipmentId?: string | null;
  operationalStatus: OperationalStatus;
  internalPriority: CasePriority | string;
  assignedPrimaryEngineerId?: string | null;
  primaryEngineerName?: string | null;
  assignedSecondaryEngineerId?: string | null;
  secondaryEngineerName?: string | null;
  assignedAt?: string | null;
  slaPolicyId?: string | null;
  slaTargetAt?: string | null;
  slaBreachStatus: SlaBreachStatus;
  actualDiagnosisSummary?: string | null;
  actualActionTakenSummary?: string | null;
  verificationStatus: VerificationStatus;
  verifiedByUserId?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  isDeleted: boolean;
  version?: number;
  createdAt: string;
  updatedAt: string;
}

/** Append-Only Dispatch Assignment History Record */
export interface AssignmentHistoryEntry {
  assignmentHistoryId: string;
  serviceCaseId: string;
  assignedByUserId?: string | null;
  assignedByUserName?: string | null;
  engineerId: string;
  engineerName?: string | null;
  assignmentRole: AssignmentRole;
  previousEngineerId?: string | null;
  previousEngineerName?: string | null;
  action: AssignmentAction;
  assignedAt: string;
  reassignmentReason?: string | null;
  isEmergencyCrossDistrict: boolean;
  emergencyJustification?: string | null;
  createdAt: string;
}

/** Service Case State Machine Transition Record */
export interface ServiceCaseStatusHistoryEntry {
  statusHistoryId: string;
  serviceCaseId: string;
  fromStatus: OperationalStatus;
  toStatus: OperationalStatus;
  changedByUserId?: string | null;
  changedByUserName?: string | null;
  transitionReason?: string | null;
  createdAt: string;
}

/** Service Case Operational Query & Filter Parameters */
export interface ServiceCaseQueryFilters {
  districtId?: string;
  blockId?: string;
  schoolId?: string;
  labId?: string;
  operationalStatus?: OperationalStatus | string;
  internalPriority?: string;
  assignedEngineerId?: string;
  slaBreachStatus?: SlaBreachStatus | string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Engineer Workload & Availability Telemetry
 * NOTE: Availability evaluation is based on candidate threshold configuration.
 * CANDIDATE CONFIGURATION — REQUIRES OPERATIONAL CONFIRMATION.
 */
export interface EngineerWorkloadSummary {
  engineerId: string;
  fullName: string;
  email?: string;
  phoneNumber?: string | null;
  districtId: string;
  districtName: string;
  blockIds: string[];
  activeAssignedCasesCount: number;
  /** Evaluated based on configurable capacity threshold (CANDIDATE CONFIGURATION — REQUIRES OPERATIONAL CONFIRMATION). */
  isAvailable: boolean;
  /** Active threshold used for evaluation (candidate configuration default or caller-supplied). */
  configuredCapacityThreshold?: number;
}

// ==========================================
// Phase 12 — Delta Synchronization Types
// ==========================================

export type SyncConflictCode =
  | 'VERSION_CONFLICT'
  | 'RECORD_NOT_FOUND'
  | 'RECORD_INACTIVE'
  | 'AUTHORIZATION_CHANGED'
  | 'TERRITORY_ACCESS_CHANGED'
  | 'INVALID_STATE_TRANSITION'
  | 'DUPLICATE_OPERATION'
  | 'SERVER_VALIDATION_FAILED'
  | 'ENTITY_TOMBSTONED';

export type SyncMutationOperationType = 'INSERT' | 'UPDATE' | 'STATUS_TRANSITION' | 'SOFT_DELETE';

export interface SyncMutationItem {
  clientOperationId: string;
  entityType: string;
  entityId: string;
  operationType: SyncMutationOperationType;
  clientBaseVersion?: string;
  clientVersion?: string;
  payload: Record<string, unknown>;
  clientCreatedAt: string;
}

export interface SyncPushRequest {
  clientBatchId: string;
  mutations: SyncMutationItem[];
}

export type SyncMutationResultStatus = 'ACCEPTED' | 'REJECTED' | 'CONFLICT';

export interface SyncMutationResult {
  clientOperationId: string;
  status: SyncMutationResultStatus;
  serverVersion?: string;
  conflictCode?: SyncConflictCode;
  message?: string;
  serverTimestamp: string;
  data?: Record<string, unknown>;
}

export interface SyncPushResponseData {
  batchId: string;
  results: SyncMutationResult[];
  serverTimestamp: string;
}

export interface SyncDeltaRequestQuery {
  cursor?: string;
  limit?: number;
}

export interface SyncDeltaChangeItem {
  entityType: string;
  entityId: string;
  action: 'UPSERT' | 'TOMBSTONE';
  version: string;
  updatedAt: string;
  data: Record<string, unknown> | null;
}

export interface SyncTombstoneItem {
  entityType: string;
  entityId: string;
  deletedAt: string;
  reason?: string | null;
}

export interface SyncDeltaResponseData {
  changes: SyncDeltaChangeItem[];
  tombstones: SyncTombstoneItem[];
  nextCursor: string | null;
  hasMore: boolean;
  serverTimestamp: string;
}

// ==========================================
// Phase 13 — Field Visit Execution Types
// ==========================================

export type VisitStatus =
  | 'PLANNED'
  | 'EN_ROUTE'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'ABORTED'
  | 'PENDING_RETURN';

export type VisitOutcome =
  | 'RESOLVED_ON_SITE'
  | 'PENDING_PARTS'
  | 'PENDING_OEM_ESCALATION'
  | 'ABORTED_SCHOOL_CLOSED'
  | 'UNABLE_TO_REPRODUCE'
  | 'RETURN_VISIT_REQUIRED';

export interface FieldVisit {
  visitId: string;
  serviceCaseId: string;
  engineerId: string;
  engineerName?: string | null;
  visitSequenceNumber: number;
  visitDate: string;
  status: VisitStatus;
  checkInTimestamp?: string | null;
  checkInAtDevice?: string | null;
  checkInAtServer?: string | null;
  checkInLatitude?: number | string | null;
  checkInLongitude?: number | string | null;
  checkInAccuracyMeters?: number | string | null;
  checkInDistanceMeters?: number | string | null;
  checkInWithinGeofence?: boolean | null;
  equipmentConditionObserved?: string | null;
  onSiteDiagnosis?: string | null;
  workPerformed?: string | null;
  visitOutcome: VisitOutcome;
  pendingReasonText?: string | null;
  targetNextVisitDate?: string | null;
  checkOutTimestamp?: string | null;
  checkOutAtDevice?: string | null;
  checkOutAtServer?: string | null;
  checkOutLatitude?: number | string | null;
  checkOutLongitude?: number | string | null;
  checkOutAccuracyMeters?: number | string | null;
  notes?: string | null;
  version: number;
  clientOperationId?: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FieldVisitStatusHistoryEntry {
  historyId: string;
  visitId: string;
  fromStatus: VisitStatus;
  toStatus: VisitStatus;
  changedByUserId?: string | null;
  changedByUserName?: string | null;
  transitionReason?: string | null;
  clientOperationId?: string | null;
  createdAt: string;
}

export interface FieldVisitQueryFilters {
  serviceCaseId?: string;
  engineerId?: string;
  status?: VisitStatus;
  outcome?: VisitOutcome;
  page?: number;
  limit?: number;
}

// ==========================================
// Phase 14 — Evidence Pipeline & S3 Streaming Types
// ==========================================

export type EvidenceSlot =
  | 'SLOT_1_HM_SIGNED_REPORT'
  | 'SLOT_2_EQUIPMENT_WORKING_PHOTO'
  | 'SLOT_AUX_FAULT_PRE_SERVICE'
  | 'SLOT_AUX_SERIAL_PLATE'
  | 'SLOT_AUX_REPLACED_PARTS'
  | 'DIAGNOSTIC_PHOTO'
  | 'OTHER_ATTACHMENT'
  | 'SLOT_1_DEFECT'
  | 'SLOT_2_COMPLETION'
  | string;

export type EvidenceType = 'PHOTO' | 'DOCUMENT' | 'SIGNATURE' | string;

export type EvidenceUploadStatus =
  | 'LOCAL_CAPTURED'
  | 'QUEUED'
  | 'UPLOAD_SESSION_CREATED'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'FINALIZED'
  | 'VERIFIED'
  | 'UPLOAD_FAILED'
  | 'LEGACY_UNVERIFIED'
  | 'LEGACY_MIGRATED';

export interface EvidenceFile {
  evidenceId: string;
  visitId: string;
  serviceCaseId: string;
  evidenceSlot: EvidenceSlot;
  evidenceType: EvidenceType;
  localMediaId?: string | null;
  storagePath: string;
  objectStorageProvider: string;
  mimeType: string;
  fileSizeBytes: number;
  fileChecksumSha256: string;
  capturedAt: string;
  uploadedAt?: string | null;
  uploadStatus: EvidenceUploadStatus;
  gpsLatitude?: number | string | null;
  gpsLongitude?: number | string | null;
  gpsAccuracyMeters?: number | string | null;
  isVerified: boolean;
  verificationNotes?: string | null;
  createdByUserId?: string | null;
  version: number;
  clientOperationId?: string | null;
  isTombstoned: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceUploadSession {
  evidenceId: string;
  uploadSessionId: string;
  presignedUploadUrl: string;
  storagePath: string;
  expiresAt: string;
  maxFileSizeBytes: number;
  expectedChecksumSha256: string;
}

export interface EvidenceQueryFilters {
  visitId?: string;
  serviceCaseId?: string;
  evidenceSlot?: string;
  uploadStatus?: string;
  page?: number;
  limit?: number;
}

// ==========================================
// 15. CONVEYANCE CLAIMS DOMAIN (PHASE 15)
// ==========================================

export type TravelMode = 'BIKE' | 'BUS' | 'TRAIN' | 'AUTO' | 'OTHER';

export type ConveyanceClaimStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED_FOR_CORRECTION'
  | 'PAID';

export interface ConveyanceRatePolicy {
  policyId: string;
  tenantId?: string | null;
  districtId?: string | null;
  travelMode: TravelMode;
  ratePerKm: number;
  maxDailyDistanceKm?: number | null;
  maxDailyAmount?: number | null;
  requiresOdometer: boolean;
  requiresEvidence: boolean;
  description?: string | null;
  isProvisional: boolean;
  effectiveFrom: string;
  effectiveTo?: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConveyanceCalculationBreakdown {
  claimedDistanceKm: number;
  capturedDistanceKm?: number | null;
  appliedRatePerKm: number;
  ratePolicyVersion: number;
  isProvisionalPolicy: boolean;
  calculatedAmount: number;
  approvedDistanceKm?: number | null;
  approvedAmount?: number | null;
  explanation: string;
}

export interface ConveyanceClaim {
  conveyanceClaimId: string;
  visitId: string;
  serviceCaseId: string;
  engineerId: string;
  submittedByUserId?: string | null;
  policyId?: string | null;
  travelDate: string;
  fromLocation: string;
  toLocation: string;
  travelMode: TravelMode;
  startingOdometerKm?: number | null;
  endingOdometerKm?: number | null;
  calculatedOdometerDistanceKm?: number | null;
  gpsDistanceKm?: number | null;
  capturedDistanceKm?: number | null;
  claimedDistanceKm: number;
  approvedDistanceKm?: number | null;
  appliedRatePerKm: number;
  ratePolicyVersion: number;
  isProvisionalPolicy: boolean;
  calculatedAmount: number;
  claimedAmount: number;
  approvedAmount?: number | null;
  supportingEvidenceFileId?: string | null;
  claimStatus: ConveyanceClaimStatus;
  submittedAt?: string | null;
  reviewedByUserId?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  correctionNotes?: string | null;
  remarks?: string | null;
  version: number;
  clientOperationId?: string | null;
  isTombstoned: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  // Enriched fields for UI / reports
  engineerName?: string;
  serviceCaseNumber?: string;
  schoolName?: string;
  districtName?: string;
  reviewerName?: string;
  submittedByName?: string;
}

export interface ConveyanceSummaryStats {
  totalClaimsCount: number;
  draftCount: number;
  submittedCount: number;
  underReviewCount: number;
  approvedCount: number;
  rejectedCount: number;
  returnedCount: number;
  paidCount: number;
  totalClaimedAmount: number;
  totalApprovedAmount: number;
  totalPaidAmount: number;
  districtWiseBreakdown: Array<{
    districtId: string;
    districtName: string;
    claimsCount: number;
    totalClaimedAmount: number;
    totalApprovedAmount: number;
  }>;
}

export interface ConveyanceQueryFilters {
  status?: ConveyanceClaimStatus;
  travelMode?: TravelMode;
  engineerId?: string;
  districtId?: string;
  startDate?: string;
  endDate?: string;
  serviceCaseId?: string;
  visitId?: string;
  search?: string;
  page?: number;
  limit?: number;
}


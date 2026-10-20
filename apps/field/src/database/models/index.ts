/**
 * ZENTRA Field — Database Models Barrel
 * apps/field/src/database/models/index.ts
 */

import { DistrictModel } from './DistrictModel';
import { BlockModel } from './BlockModel';
import { SchoolModel } from './SchoolModel';
import { HiTechLabModel } from './HiTechLabModel';
import { EquipmentModel } from './EquipmentModel';
import { ServiceCaseModel } from './ServiceCaseModel';
import { LocalOperationModel } from './LocalOperationModel';
import { SyncMetadataModel } from './SyncMetadataModel';
import { FieldVisitModel } from './FieldVisitModel';
import { EvidenceModel } from './EvidenceModel';
import { ConveyanceClaimModel } from './ConveyanceClaimModel';

export {
  DistrictModel,
  BlockModel,
  SchoolModel,
  HiTechLabModel,
  EquipmentModel,
  ServiceCaseModel,
  LocalOperationModel,
  SyncMetadataModel,
  FieldVisitModel,
  EvidenceModel,
  ConveyanceClaimModel,
};

export const appModelClasses = [
  DistrictModel,
  BlockModel,
  SchoolModel,
  HiTechLabModel,
  EquipmentModel,
  ServiceCaseModel,
  LocalOperationModel,
  SyncMetadataModel,
  FieldVisitModel,
  EvidenceModel,
  ConveyanceClaimModel,
];

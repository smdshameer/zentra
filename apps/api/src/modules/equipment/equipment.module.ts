/**
 * ZENTRA — Equipment Master & Dynamic Attribute Engine Module
 * apps/api/src/modules/equipment/equipment.module.ts
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchoolsModule } from '../schools/schools.module';
import { OemsController } from './controllers/oems.controller';
import { EquipmentTypesController } from './controllers/equipment-types.controller';
import { LabEquipmentController } from './controllers/lab-equipment.controller';
import { OemsRepository } from './repositories/oems.repository';
import { EquipmentTypesRepository } from './repositories/equipment-types.repository';
import { AttributeDefinitionsRepository } from './repositories/attribute-definitions.repository';
import { LabEquipmentRepository } from './repositories/lab-equipment.repository';
import { DynamicAttributeEngineService } from './services/dynamic-attribute-engine.service';
import { OemsService } from './services/oems.service';
import { EquipmentTypesService } from './services/equipment-types.service';
import { LabEquipmentService } from './services/lab-equipment.service';

@Module({
  imports: [AuthModule, SchoolsModule],
  controllers: [
    OemsController,
    EquipmentTypesController,
    LabEquipmentController,
  ],
  providers: [
    OemsRepository,
    EquipmentTypesRepository,
    AttributeDefinitionsRepository,
    LabEquipmentRepository,
    DynamicAttributeEngineService,
    OemsService,
    EquipmentTypesService,
    LabEquipmentService,
  ],
  exports: [
    OemsRepository,
    EquipmentTypesRepository,
    AttributeDefinitionsRepository,
    LabEquipmentRepository,
    DynamicAttributeEngineService,
    OemsService,
    EquipmentTypesService,
    LabEquipmentService,
  ],
})
export class EquipmentModule {}

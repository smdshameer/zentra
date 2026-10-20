/**
 * ZENTRA — Root Application Module
 * apps/api/src/app.module.ts
 */

import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { SchoolsModule } from './modules/schools/schools.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { ImportsModule } from './modules/imports/imports.module';
import { ServiceCasesModule } from './modules/service-cases/service-cases.module';
import { SyncModule } from './modules/sync/sync.module';
import { VisitsModule } from './modules/visits/visits.module';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { ConveyanceModule } from './modules/conveyance/conveyance.module';

@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    AuthModule,
    SchoolsModule,
    EquipmentModule,
    ImportsModule,
    ServiceCasesModule,
    SyncModule,
    VisitsModule,
    EvidenceModule,
    ConveyanceModule,
  ],
})
export class AppModule {}

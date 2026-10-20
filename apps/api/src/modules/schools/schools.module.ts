/**
 * ZENTRA — School, Lab & Equipment Domain Module
 * apps/api/src/modules/schools/schools.module.ts
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DistrictsController } from './controllers/districts.controller';
import { BlocksController } from './controllers/blocks.controller';
import { SchoolsController } from './controllers/schools.controller';
import { LabsController } from './controllers/labs.controller';
import { DistrictsRepository } from './repositories/districts.repository';
import { BlocksRepository } from './repositories/blocks.repository';
import { SchoolsRepository } from './repositories/schools.repository';
import { LabsRepository } from './repositories/labs.repository';
import { TerritoryService } from './services/territory.service';
import { SchoolsService } from './services/schools.service';
import { LabsService } from './services/labs.service';

@Module({
  imports: [AuthModule],
  controllers: [
    DistrictsController,
    BlocksController,
    SchoolsController,
    LabsController,
  ],
  providers: [
    DistrictsRepository,
    BlocksRepository,
    SchoolsRepository,
    LabsRepository,
    TerritoryService,
    SchoolsService,
    LabsService,
  ],
  exports: [
    TerritoryService,
    SchoolsService,
    LabsService,
    DistrictsRepository,
    BlocksRepository,
    SchoolsRepository,
    LabsRepository,
  ],
})
export class SchoolsModule {}

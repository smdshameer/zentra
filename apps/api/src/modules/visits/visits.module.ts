/**
 * ZENTRA — Visits Module
 * apps/api/src/modules/visits/visits.module.ts
 *
 * Encapsulates Field Visit domain execution, repository persistence,
 * append-only status transition auditing, and REST controllers.
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { VisitsController } from './controllers/visits.controller';
import { VisitsService } from './services/visits.service';
import { VisitsRepository } from './repositories/visits.repository';
import { VisitStatusHistoryRepository } from './repositories/visit-status-history.repository';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [VisitsController],
  providers: [
    VisitsRepository,
    VisitStatusHistoryRepository,
    VisitsService,
  ],
  exports: [
    VisitsRepository,
    VisitStatusHistoryRepository,
    VisitsService,
  ],
})
export class VisitsModule {}

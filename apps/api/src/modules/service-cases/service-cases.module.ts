/**
 * ZENTRA — Service Cases & Dispatch Module
 * apps/api/src/modules/service-cases/service-cases.module.ts
 *
 * Encapsulates Phase 9 domain services, repositories, and controllers:
 * - Service case lifecycle & state machine
 * - Territory dispatch engine
 * - SLA resolution engine
 * - Append-only assignment ledger
 */

import { Module } from '@nestjs/common';
import { ServiceCasesController } from './controllers/service-cases.controller';
import { DispatchController } from './controllers/dispatch.controller';
import { SlaController } from './controllers/sla.controller';

import { ServiceCasesService } from './services/service-cases.service';
import { ServiceCaseStateMachineService } from './services/service-case-state-machine.service';
import { DispatchEngineService } from './services/dispatch-engine.service';
import { SlaEngineService } from './services/sla-engine.service';

import { ServiceCasesRepository } from './repositories/service-cases.repository';
import { AssignmentHistoryRepository } from './repositories/assignment-history.repository';
import { StatusHistoryRepository } from './repositories/status-history.repository';
import { SlaPoliciesRepository } from './repositories/sla-policies.repository';
import { CaseAuditEventsRepository } from './repositories/audit-events.repository';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    ServiceCasesController,
    DispatchController,
    SlaController,
  ],
  providers: [
    ServiceCasesRepository,
    AssignmentHistoryRepository,
    StatusHistoryRepository,
    SlaPoliciesRepository,
    CaseAuditEventsRepository,
    SlaEngineService,
    ServiceCaseStateMachineService,
    DispatchEngineService,
    ServiceCasesService,
  ],
  exports: [
    ServiceCasesService,
    ServiceCasesRepository,
    AssignmentHistoryRepository,
    StatusHistoryRepository,
    SlaPoliciesRepository,
    SlaEngineService,
    ServiceCaseStateMachineService,
    DispatchEngineService,
  ],
})
export class ServiceCasesModule {}

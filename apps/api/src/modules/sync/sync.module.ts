/**
 * ZENTRA — Sync Module
 * apps/api/src/modules/sync/sync.module.ts
 *
 * NestJS module wiring for Delta Synchronization & Conflict Arbitration subsystem.
 */

import { Module } from '@nestjs/common';
import { SyncController } from './controllers/sync.controller';
import { SyncPushService } from './services/sync-push.service';
import { SyncDeltaService } from './services/sync-delta.service';
import { ConflictArbitratorService } from './services/conflict-arbitrator.service';
import { IdempotencyRepository } from './repositories/idempotency.repository';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ConveyanceModule } from '../conveyance/conveyance.module';

@Module({
  imports: [DatabaseModule, AuthModule, ConveyanceModule],
  controllers: [SyncController],
  providers: [
    SyncPushService,
    SyncDeltaService,
    ConflictArbitratorService,
    IdempotencyRepository,
  ],
  exports: [
    SyncPushService,
    SyncDeltaService,
    ConflictArbitratorService,
    IdempotencyRepository,
  ],
})
export class SyncModule {}

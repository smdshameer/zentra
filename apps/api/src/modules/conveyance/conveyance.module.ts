/**
 * ZENTRA — Conveyance Module (Phase 15)
 * apps/api/src/modules/conveyance/conveyance.module.ts
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ConveyanceController } from './controllers/conveyance.controller';
import { ConveyanceService } from './services/conveyance.service';
import { ConveyanceRepository } from './repositories/conveyance.repository';
import { ConveyancePolicyService } from './services/conveyance-policy.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ConveyanceController],
  providers: [
    ConveyanceRepository,
    ConveyancePolicyService,
    ConveyanceService,
  ],
  exports: [
    ConveyanceRepository,
    ConveyancePolicyService,
    ConveyanceService,
  ],
})
export class ConveyanceModule {}

/**
 * ZENTRA — Evidence Module (Phase 14)
 * apps/api/src/modules/evidence/evidence.module.ts
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { EvidenceRepository } from './repositories/evidence.repository';
import { ObjectStorageService } from './services/object-storage.service';
import { EvidenceService } from './services/evidence.service';
import { EvidenceController } from './controllers/evidence.controller';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [EvidenceController],
  providers: [EvidenceRepository, ObjectStorageService, EvidenceService],
  exports: [EvidenceRepository, ObjectStorageService, EvidenceService],
})
export class EvidenceModule {}

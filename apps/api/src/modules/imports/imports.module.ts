/**
 * ZENTRA — Staged Ingestion & Deduplication Module
 * apps/api/src/modules/imports/imports.module.ts
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ImportsController } from './controllers/imports.controller';
import { ImportsService } from './services/imports.service';
import { SpreadsheetParserService } from './services/spreadsheet-parser.service';
import { FieldMappingNormalizerService } from './services/field-mapping-normalizer.service';
import { DuplicateClassificationEngineService } from './services/duplicate-classification-engine.service';
import { ImportJobsRepository } from './repositories/import-jobs.repository';
import { ImportStagingRepository } from './repositories/import-staging.repository';
import { SourceComplaintsRepository } from './repositories/source-complaints.repository';
import { AuditEventsRepository } from './repositories/audit-events.repository';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ImportsController],
  providers: [
    ImportsService,
    SpreadsheetParserService,
    FieldMappingNormalizerService,
    DuplicateClassificationEngineService,
    ImportJobsRepository,
    ImportStagingRepository,
    SourceComplaintsRepository,
    AuditEventsRepository,
  ],
  exports: [
    ImportsService,
    ImportJobsRepository,
    ImportStagingRepository,
    SourceComplaintsRepository,
    AuditEventsRepository,
  ],
})
export class ImportsModule {}

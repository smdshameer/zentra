/**
 * ZENTRA — Database Module
 * apps/api/src/database/database.module.ts
 */

import { Module, Global } from '@nestjs/common';
import { createDatabaseConnection, DATABASE_CONNECTION } from './database.connection';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useFactory: () => createDatabaseConnection(),
    },
  ],
  exports: [DATABASE_CONNECTION],
})
export class DatabaseModule {}

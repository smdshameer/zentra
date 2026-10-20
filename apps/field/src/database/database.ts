/**
 * ZENTRA Field — Database Factory
 * apps/field/src/database/database.ts
 *
 * Initializes WatermelonDB database instance:
 * - Uses SQLiteAdapter via native JSI in React Native mobile runtime
 * - Uses LokiJSAdapter in Node / test / headless environments
 */

import { Database } from '@nozbe/watermelondb';
import { appDatabaseSchema } from './schema';
import { appDatabaseMigrations } from './migrations';
import { appModelClasses } from './models';

export interface DatabaseFactoryOptions {
  inMemory?: boolean;
  dbName?: string;
}

export function createAppDatabase(options: DatabaseFactoryOptions = {}): Database {
  const dbName = options.dbName || 'zentra_field_v1';
  let adapter: any;

  if (options.inMemory || typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    // In-memory adapter for unit testing and headless environments
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- load the in-memory adapter conditionally for test/headless execution
    const LokiJSAdapter = require('@nozbe/watermelondb/adapters/lokijs').default;
    adapter = new LokiJSAdapter({
      schema: appDatabaseSchema,
      migrations: appDatabaseMigrations,
      useWebWorker: false,
      useIncrementalIndexedDB: false,
      dbName,
    });
  } else {
    // Native SQLite adapter on mobile devices with fallback to LokiJS
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- avoid eagerly loading the SQLite adapter where its Node dependency is unavailable
      const SQLiteAdapter = require('@nozbe/watermelondb/adapters/sqlite').default;
      adapter = new SQLiteAdapter({
        schema: appDatabaseSchema,
        migrations: appDatabaseMigrations,
        jsi: true, // Native JSI execution
        dbName,
        onSetUpError: (error: Error) => {
          console.error('[WatermelonDB] Database setup error:', error);
        },
      });
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- load the in-memory adapter conditionally for test/headless execution
      const LokiJSAdapter = require('@nozbe/watermelondb/adapters/lokijs').default;
      adapter = new LokiJSAdapter({
        schema: appDatabaseSchema,
        migrations: appDatabaseMigrations,
        useWebWorker: false,
        useIncrementalIndexedDB: false,
        dbName,
      });
    }
  }

  return new Database({
    adapter,
    modelClasses: appModelClasses,
  });
}

/**
 * Resets local database by dropping and recreating all collections
 */
export async function resetAppDatabase(database: Database): Promise<void> {
  await database.write(async () => {
    await database.unsafeResetDatabase();
  });
}

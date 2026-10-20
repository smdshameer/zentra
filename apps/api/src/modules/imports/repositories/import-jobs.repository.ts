/**
 * ZENTRA — Import Jobs Repository
 * apps/api/src/modules/imports/repositories/import-jobs.repository.ts
 *
 * Handles persistence for batch spreadsheet intake sessions.
 */

import { Injectable, Inject } from '@nestjs/common';
import { Kysely, type Transaction, type Insertable, type Selectable, type Updateable } from 'kysely';
import type { DatabaseSchema, ImportJobsTable } from '../../../database/database.types';
import { DATABASE_CONNECTION } from '../../../database/database.connection';

@Injectable()
export class ImportJobsRepository {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  async create(
    job: Insertable<ImportJobsTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<ImportJobsTable>> {
    const client = trx || this.db;
    return await client
      .insertInto('import_jobs')
      .values(job)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(
    importJobId: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<ImportJobsTable> | undefined> {
    const client = trx || this.db;
    return await client
      .selectFrom('import_jobs')
      .where('import_job_id', '=', importJobId)
      .selectAll()
      .executeTakeFirst();
  }

  async findByHash(
    fileHash: string,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<ImportJobsTable> | undefined> {
    const client = trx || this.db;
    return await client
      .selectFrom('import_jobs')
      .where('file_hash_sha256', '=', fileHash)
      .selectAll()
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
  }

  async findAll(
    filters: {
      status?: string;
      search?: string;
      page: number;
      limit: number;
    },
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<ImportJobsTable>[]> {
    const client = trx || this.db;
    let query = client.selectFrom('import_jobs').selectAll();

    if (filters.status) {
      query = query.where('job_status', '=', filters.status);
    }
    if (filters.search) {
      const pattern = `%${filters.search}%`;
      query = query.where('source_filename', 'ilike', pattern);
    }

    const offset = (filters.page - 1) * filters.limit;
    return await query
      .orderBy('created_at', 'desc')
      .limit(filters.limit)
      .offset(offset)
      .execute();
  }

  async count(
    filters: {
      status?: string;
      search?: string;
    },
    trx?: Transaction<DatabaseSchema>,
  ): Promise<number> {
    const client = trx || this.db;
    let query = client
      .selectFrom('import_jobs')
      .select((eb) => eb.fn.count<string>('import_job_id').as('count'));

    if (filters.status) {
      query = query.where('job_status', '=', filters.status);
    }
    if (filters.search) {
      const pattern = `%${filters.search}%`;
      query = query.where('source_filename', 'ilike', pattern);
    }

    const res = await query.executeTakeFirst();
    return Number(res?.count || 0);
  }

  async update(
    importJobId: string,
    updates: Updateable<ImportJobsTable>,
    trx?: Transaction<DatabaseSchema>,
  ): Promise<Selectable<ImportJobsTable>> {
    const client = trx || this.db;
    return await client
      .updateTable('import_jobs')
      .set(updates)
      .where('import_job_id', '=', importJobId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}

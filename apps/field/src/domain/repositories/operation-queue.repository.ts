/**
 * ZENTRA Field — Operation Queue Repository
 * apps/field/src/domain/repositories/operation-queue.repository.ts
 *
 * Exposes repository interface for the persistent local operation queue.
 */

import { Database } from '@nozbe/watermelondb';
import { OperationQueue } from '../queue/operation-queue';
import { LocalOperationModel } from '../../database/models/LocalOperationModel';
import type { EnqueueOperationInput, OperationQueueStats } from '../queue/operation-types';

export class OperationQueueRepository {
  private readonly queue: OperationQueue;

  constructor(database: Database) {
    this.queue = new OperationQueue(database);
  }

  async enqueue(input: EnqueueOperationInput): Promise<LocalOperationModel> {
    return await this.queue.enqueueStandalone(input);
  }

  async getPendingOperations(): Promise<LocalOperationModel[]> {
    return await this.queue.getPendingOperations();
  }

  async markInFlight(operationId: string): Promise<void> {
    await this.queue.markInFlight(operationId);
  }

  async markFailed(operationId: string, errorMessage: string): Promise<void> {
    await this.queue.markFailed(operationId, errorMessage);
  }

  async markAcknowledged(operationId: string): Promise<void> {
    await this.queue.markAcknowledged(operationId);
  }

  async requeueFailedOperations(): Promise<number> {
    return await this.queue.requeueFailedOperations();
  }

  async getStats(): Promise<OperationQueueStats> {
    return await this.queue.getQueueStats();
  }
}

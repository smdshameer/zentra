/**
 * ZENTRA Field — Public Mobile Module Exports
 * apps/field/src/index.ts
 *
 * Exposes Phase 10 local-first core, Phase 11 mobile hardware GPS & camera,
 * and Phase 12 delta synchronization & conflict arbitration subsystem.
 * NOTE: Phase 13 (Visit Execution), Phase 14 (S3 Evidence),
 * and Phase 15 (Conveyance) are deferred to subsequent phases.
 */

export * from './api';
export * from './auth';
export * from './database';
export * from './domain/identity/identity-map';
export * from './domain/queue/operation-queue';
export * from './domain/queue/operation-types';
export * from './domain/repositories';
export * from './domain/preload/preload-manager';
export * from './network/network-monitor';
export * from './hardware';
export * from './sync';

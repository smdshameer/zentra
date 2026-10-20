/**
 * ZENTRA — SLA Engine Service
 * apps/api/src/modules/service-cases/services/sla-engine.service.ts
 *
 * Computes deterministic resolution target hours, warning thresholds,
 * elapsed times, remaining hours, and SLA breach statuses.
 *
 * NOTE: SLA breach is an operational condition/metric, NEVER an automatic
 * lifecycle state machine transition.
 */

import { Injectable, Inject } from '@nestjs/common';
import type { SlaPolicy, SlaBreachStatus, CasePriority, OperationalStatus } from '@zentra/types';
import { SlaPoliciesRepository } from '../repositories/sla-policies.repository';

/**
 * CANDIDATE CONFIGURATION — REQUIRES OPERATIONAL CONFIRMATION:
 * Default SLA warning threshold percentage (75%).
 * SLA status is strictly an analytical/operational indicator and NEVER mutates the operational state machine.
 */
export const CONFIGURABLE_SLA_WARNING_THRESHOLD_DEFAULT = 75;

export interface SlaEvaluationResult {
  slaPolicyId: string;
  targetResolutionHours: number;
  slaTargetAt: Date;
  elapsedHours: number;
  remainingHours: number;
  percentageElapsed: number;
  isBreached: boolean;
  isApproachingBreach: boolean;
  breachStatus: SlaBreachStatus;
}

@Injectable()
export class SlaEngineService {
  constructor(
    @Inject(SlaPoliciesRepository)
    private readonly slaPoliciesRepo: SlaPoliciesRepository,
  ) {}

  /**
   * Determine SLA policy by priority level or fallback to default
   */
  async resolvePolicyForPriority(priority: CasePriority | string): Promise<SlaPolicy | null> {
    const policy = await this.slaPoliciesRepo.findByPriority(priority);
    return policy;
  }

  /**
   * Calculate SLA target timestamp from registration/start date and policy hours
   */
  calculateTargetDate(startDate: Date, targetHours: number): Date {
    const targetMs = startDate.getTime() + targetHours * 60 * 60 * 1000;
    return new Date(targetMs);
  }

  /**
   * Evaluates current SLA condition for a case
   */
  evaluateSlaStatus(
    registeredAt: Date,
    slaTargetAt: Date,
    operationalStatus: OperationalStatus | string,
    warningThresholdPercentage: number = CONFIGURABLE_SLA_WARNING_THRESHOLD_DEFAULT,
    resolvedAt?: Date | null,
    now: Date = new Date(),
  ): SlaEvaluationResult {
    const totalDurationMs = slaTargetAt.getTime() - registeredAt.getTime();
    const totalHours = totalDurationMs > 0 ? totalDurationMs / (1000 * 60 * 60) : 1;

    const evaluationPoint = resolvedAt ? resolvedAt.getTime() : now.getTime();
    const elapsedMs = Math.max(0, evaluationPoint - registeredAt.getTime());
    const elapsedHours = Number((elapsedMs / (1000 * 60 * 60)).toFixed(2));

    const remainingMs = slaTargetAt.getTime() - evaluationPoint;
    const remainingHours = Number((remainingMs / (1000 * 60 * 60)).toFixed(2));

    const percentageElapsed = Math.min(
      999,
      Number(((elapsedMs / totalDurationMs) * 100).toFixed(2)),
    );

    const isTerminalOrResolved = [
      'RESOLVED',
      'VERIFIED',
      'CLOSED',
    ].includes(operationalStatus);

    let breachStatus: SlaBreachStatus = 'WITHIN_SLA';
    let isBreached = false;
    let isApproachingBreach = false;

    if (isTerminalOrResolved) {
      if (evaluationPoint <= slaTargetAt.getTime()) {
        breachStatus = 'MET';
      } else {
        breachStatus = 'BREACHED';
        isBreached = true;
      }
    } else {
      if (now.getTime() > slaTargetAt.getTime()) {
        breachStatus = 'BREACHED';
        isBreached = true;
      } else if (percentageElapsed >= warningThresholdPercentage) {
        breachStatus = 'APPROACHING_BREACH';
        isApproachingBreach = true;
      } else {
        breachStatus = 'WITHIN_SLA';
      }
    }

    return {
      slaPolicyId: '',
      targetResolutionHours: totalHours,
      slaTargetAt,
      elapsedHours,
      remainingHours,
      percentageElapsed,
      isBreached,
      isApproachingBreach,
      breachStatus,
    };
  }
}

/**
 * ZENTRA — Conveyance Rate Policy Service (Phase 15 Correction Pass)
 * apps/api/src/modules/conveyance/services/conveyance-policy.service.ts
 *
 * Provides configuration-driven reimbursement rates with deterministic selection precedence:
 *
 * PRECEDENCE RULES:
 * 1. Filter: is_active = true
 * 2. Effective date validity: effective_from <= atDate AND (effective_to IS NULL OR effective_to >= atDate)
 *    - Strictly excludes future policies (effective_from > atDate)
 *    - Strictly excludes inactive policies (is_active = false)
 *    - Inclusive on boundary dates (effective_from == atDate, effective_to == atDate)
 * 3. Scope Hierarchy:
 *    - Tier 1: District-specific policy (district_id = options.districtId)
 *    - Tier 2: Tenant/global default policy (district_id IS NULL)
 * 4. Deterministic Tie-Breaker:
 *    - effective_from DESC (latest applicable effective start date)
 *    - version DESC
 *    - created_at DESC
 *    - policy_id DESC (guarantees zero arbitrary database row ordering)
 * 5. Fallback:
 *    - Falls back to PROVISIONAL_DEFAULT_CONVEYANCE_RATES
 *    - Strictly labeled: PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY
 */

import { Injectable, Inject, Logger } from '@nestjs/common';
import { Kysely } from 'kysely';
import { DATABASE_CONNECTION } from '../../../database/database.connection';
import type { DatabaseSchema } from '../../../database/database.types';
import {
  PROVISIONAL_DEFAULT_CONVEYANCE_RATES,
  type TravelMode,
} from '@zentra/contracts';

export interface ResolvePolicyOptions {
  districtId?: string | null;
  tenantId?: string | null;
  effectiveDate?: Date | string | null;
}

export interface ResolvedPolicy {
  policyId: string | null;
  travelMode: TravelMode;
  ratePerKm: number;
  policyVersion: number;
  isProvisional: boolean;
  districtId: string | null;
  description: string;
}

@Injectable()
export class ConveyancePolicyService {
  private readonly logger = new Logger(ConveyancePolicyService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Kysely<DatabaseSchema>,
  ) {}

  /**
   * Resolves the authoritative rate policy with deterministic precedence.
   */
  async resolveRatePolicy(
    travelMode: TravelMode,
    options?: ResolvePolicyOptions,
  ): Promise<ResolvedPolicy> {
    const atDate = options?.effectiveDate
      ? new Date(options.effectiveDate)
      : new Date();

    // 1. Attempt District-Specific Policy (Tier 1 Priority)
    if (options?.districtId) {
      let districtQuery = this.db
        .selectFrom('conveyance_rate_policies')
        .selectAll()
        .where('travel_mode', '=', travelMode)
        .where('is_active', '=', true)
        .where('district_id', '=', options.districtId)
        .where('effective_from', '<=', atDate)
        .where((eb) =>
          eb.or([
            eb('effective_to', 'is', null),
            eb('effective_to', '>=', atDate),
          ]),
        );

      if (options.tenantId) {
        districtQuery = districtQuery.where((eb) =>
          eb.or([
            eb('tenant_id', 'is', null),
            eb('tenant_id', '=', options.tenantId!),
          ]),
        );
      }

      const districtPolicy = await districtQuery
        .orderBy('effective_from', 'desc')
        .orderBy('version', 'desc')
        .orderBy('created_at', 'desc')
        .orderBy('policy_id', 'desc')
        .executeTakeFirst();

      if (districtPolicy) {
        return {
          policyId: districtPolicy.policy_id,
          travelMode,
          ratePerKm: Number(districtPolicy.rate_per_km),
          policyVersion: districtPolicy.version,
          isProvisional: districtPolicy.is_provisional,
          districtId: districtPolicy.district_id ?? null,
          description:
            districtPolicy.description ||
            `District-specific policy for ${travelMode} (District: ${districtPolicy.district_id}, v${districtPolicy.version})`,
        };
      }
    }

    // 2. Attempt Tenant / Broader Default Policy (Tier 2 Priority: district_id IS NULL)
    let globalQuery = this.db
      .selectFrom('conveyance_rate_policies')
      .selectAll()
      .where('travel_mode', '=', travelMode)
      .where('is_active', '=', true)
      .where('district_id', 'is', null)
      .where('effective_from', '<=', atDate)
      .where((eb) =>
        eb.or([
          eb('effective_to', 'is', null),
          eb('effective_to', '>=', atDate),
        ]),
      );

    if (options?.tenantId) {
      globalQuery = globalQuery.where((eb) =>
        eb.or([
          eb('tenant_id', 'is', null),
          eb('tenant_id', '=', options.tenantId!),
        ]),
      );
    }

    const defaultPolicy = await globalQuery
      .orderBy('effective_from', 'desc')
      .orderBy('version', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('policy_id', 'desc')
      .executeTakeFirst();

    if (defaultPolicy) {
      return {
        policyId: defaultPolicy.policy_id,
        travelMode,
        ratePerKm: Number(defaultPolicy.rate_per_km),
        policyVersion: defaultPolicy.version,
        isProvisional: defaultPolicy.is_provisional,
        districtId: null,
        description:
          defaultPolicy.description ||
          `Configured default policy for ${travelMode} (v${defaultPolicy.version})`,
      };
    }

    // 3. Fallback to Provisional Default Rate
    const fallbackRate = PROVISIONAL_DEFAULT_CONVEYANCE_RATES[travelMode] || 5.0;
    this.logger.warn(
      `No active database policy found for ${travelMode}; falling back to provisional default ₹${fallbackRate}/km`,
    );

    return {
      policyId: null,
      travelMode,
      ratePerKm: fallbackRate,
      policyVersion: 1,
      isProvisional: true,
      districtId: null,
      description: `PROVISIONAL / CONFIGURABLE DEFAULT — NOT AN APPROVED OPERATIONAL POLICY (₹${fallbackRate}/km)`,
    };
  }

  /**
   * Lists all configured rate policies in the database.
   */
  async listPolicies() {
    return this.db
      .selectFrom('conveyance_rate_policies')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('travel_mode', 'asc')
      .orderBy('district_id', 'asc')
      .orderBy('effective_from', 'desc')
      .execute();
  }
}

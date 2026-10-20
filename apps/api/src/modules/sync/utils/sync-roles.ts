/**
 * ZENTRA — Sync Security Role Resolution Utility
 * apps/api/src/modules/sync/utils/sync-roles.ts
 *
 * Resolves and validates the active security role for RLS context evaluation.
 * Enforces server-side authority: client-supplied roles are rejected unless
 * authenticated claims verify membership.
 */

import { ForbiddenException } from '@nestjs/common';

export const RECOGNIZED_ROLES = new Set<string>([
  'MASTER_ADMIN',
  'REPORTING_HEAD',
  'DISTRICT_COORDINATOR',
  'FIELD_ENGINEER',
  'AI',
  'HM',
]);

const ROLE_PRECEDENCE = [
  'MASTER_ADMIN',
  'REPORTING_HEAD',
  'DISTRICT_COORDINATOR',
  'FIELD_ENGINEER',
  'AI',
  'HM',
];

/**
 * Resolves the effective security role for PostgreSQL Row-Level Security.
 *
 * @param userRoles Array of roles verified from JWT claims
 * @param activeRole Optional active role requested by authenticated principal
 * @returns Validated role string for zentra.current_role session setting
 * @throws ForbiddenException if no roles assigned, role unrecognized, or activeRole not possessed
 */
export function resolveSecurityRole(userRoles: string[], activeRole?: string): string {
  if (!userRoles || !Array.isArray(userRoles) || userRoles.length === 0) {
    throw new ForbiddenException('Forbidden resource: principal has no assigned security roles');
  }

  if (activeRole) {
    if (!RECOGNIZED_ROLES.has(activeRole)) {
      throw new ForbiddenException(`Forbidden resource: invalid active role '${activeRole}'`);
    }
    if (!userRoles.includes(activeRole)) {
      throw new ForbiddenException(
        `Forbidden resource: active role '${activeRole}' is not an authorized role for principal`,
      );
    }
    return activeRole;
  }

  for (const role of ROLE_PRECEDENCE) {
    if (userRoles.includes(role)) {
      return role;
    }
  }

  const candidateRole = userRoles[0]!;
  if (!RECOGNIZED_ROLES.has(candidateRole)) {
    throw new ForbiddenException(`Forbidden resource: invalid role '${candidateRole}'`);
  }
  return candidateRole;
}

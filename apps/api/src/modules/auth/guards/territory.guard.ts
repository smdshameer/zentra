/**
 * ZENTRA — Territory Scoping Guard
 * apps/api/src/modules/auth/guards/territory.guard.ts
 *
 * Enforces strict district and block boundary verification:
 * - MASTER_ADMIN and REPORTING_HEAD bypass district scoping (statewide scope)
 * - DISTRICT_COORDINATOR and FIELD_ENGINEER are restricted to assigned district IDs
 * - Requests targeting outside assigned districts are rejected with 403 Forbidden
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_TERRITORY_KEY,
  type RequireTerritoryOptions,
} from '../decorators/require-territory.decorator';
import type { AuthenticatedRequest } from './jwt-auth.guard';

@Injectable()
export class TerritoryGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RequireTerritoryOptions>(
      REQUIRE_TERRITORY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Forbidden resource: unauthenticated user');
    }

    // Global roles bypass district boundary checks
    const isGlobalAdmin = user.roles.some((r) => r === 'MASTER_ADMIN' || r === 'REPORTING_HEAD');
    if (isGlobalAdmin) {
      return true;
    }

    // Extract target district ID
    let targetDistrictId: string | undefined;

    if (options.paramName && request.params) {
      targetDistrictId = (request.params as Record<string, string>)[options.paramName];
    }

    if (!targetDistrictId && options.queryName && request.query) {
      targetDistrictId = (request.query as Record<string, string>)[options.queryName];
    }

    if (!targetDistrictId && options.bodyField && request.body) {
      targetDistrictId = (request.body as Record<string, string>)[options.bodyField];
    }

    if (!targetDistrictId) {
      throw new ForbiddenException('Forbidden resource: target district could not be resolved');
    }

    // Verify user's assigned districts include the target
    const isAssigned = user.territoryDistrictIds.includes(targetDistrictId);
    if (!isAssigned) {
      throw new ForbiddenException(
        'Forbidden resource: user is not assigned to this district territory',
      );
    }

    return true;
  }
}

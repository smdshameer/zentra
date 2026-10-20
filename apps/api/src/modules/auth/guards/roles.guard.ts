/**
 * ZENTRA — Role-Based Access Control (RBAC) Guard
 * apps/api/src/modules/auth/guards/roles.guard.ts
 *
 * Verifies that the authenticated user possesses at least one of the
 * roles specified in the @Roles() decorator.
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { UserRole } from '@zentra/types';
import type { AuthenticatedRequest } from './jwt-auth.guard';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user || !user.roles || user.roles.length === 0) {
      throw new ForbiddenException('Forbidden resource: user has no assigned roles');
    }

    const hasPermission = user.roles.some((role) => requiredRoles.includes(role));
    if (!hasPermission) {
      throw new ForbiddenException('Forbidden resource: insufficient role privileges');
    }

    return true;
  }
}

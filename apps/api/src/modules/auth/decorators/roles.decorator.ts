/**
 * ZENTRA — Roles Decorator
 * apps/api/src/modules/auth/decorators/roles.decorator.ts
 */

import { SetMetadata, CustomDecorator } from '@nestjs/common';
import type { UserRole } from '@zentra/types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);

/**
 * ZENTRA — Territory Scoping Decorator
 * apps/api/src/modules/auth/decorators/require-territory.decorator.ts
 */

import { SetMetadata, CustomDecorator } from '@nestjs/common';

export const REQUIRE_TERRITORY_KEY = 'require_territory';

export interface RequireTerritoryOptions {
  paramName?: string;
  bodyField?: string;
  queryName?: string;
}

export const RequireTerritory = (
  options: RequireTerritoryOptions = { paramName: 'districtId' },
): CustomDecorator<string> => SetMetadata(REQUIRE_TERRITORY_KEY, options);

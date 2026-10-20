/**
 * ZENTRA — JWT Authentication Guard
 * apps/api/src/modules/auth/guards/jwt-auth.guard.ts
 *
 * Validates Bearer access tokens on incoming requests.
 * Attaches validated AccessTokenClaims to `request.user`.
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { TokenService } from '../token.service';
import type { AccessTokenClaims } from '@zentra/types';

export interface AuthenticatedRequest extends FastifyRequest {
  user: AccessTokenClaims;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(TokenService)
    private readonly tokenService: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Authorization header missing');
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization scheme, Bearer expected');
    }

    const claims = this.tokenService.verifyAccessToken(token);
    request.user = claims;
    return true;
  }
}

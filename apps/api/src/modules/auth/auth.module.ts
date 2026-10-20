/**
 * ZENTRA — Authentication & Multi-District RBAC Module
 * apps/api/src/modules/auth/auth.module.ts
 */

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { RlsService } from './rls.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { TerritoryGuard } from './guards/territory.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    RlsService,
    JwtAuthGuard,
    RolesGuard,
    TerritoryGuard,
  ],
  exports: [
    AuthService,
    PasswordService,
    TokenService,
    RlsService,
    JwtAuthGuard,
    RolesGuard,
    TerritoryGuard,
  ],
})
export class AuthModule {}

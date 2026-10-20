/**
 * ZENTRA — Central API Bootstrap (NestJS + Fastify)
 * apps/api/src/main.ts
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger, HttpException, HttpStatus } from '@nestjs/common';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { AppModule } from './app.module';
import { loadAppConfig, type EnvConfig } from '@zentra/config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';
import { nowUtcIso, generateCorrelationId } from '@zentra/shared';

/**
 * Configures the Fastify application pipeline with production security hardening:
 * - Fastify Helmet: protective HTTP headers (X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy)
 * - Fastify Rate Limit: tiered request throttling protecting auth routes while preserving mobile sync headroom
 * - Global versioning prefix (/api/v1)
 * - Canonical interceptors, filters, and pipes
 * - Strict CORS policy
 */
export async function configureApp(
  app: NestFastifyApplication,
  customConfig?: Partial<EnvConfig>,
): Promise<void> {
  const config = { ...loadAppConfig(), ...customConfig };

  // 1. Fastify Helmet Security Headers
  await app.register(helmet as any, {
    contentSecurityPolicy: false, // APIs return JSON; HTML CSP is disabled to preserve web portal CORS
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Enables CORS access from Web Portal and mobile clients
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'sameorigin' },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: false,
    },
    noSniff: true,
    referrerPolicy: { policy: 'no-referrer' },
  });

  // 2. Fastify Rate Limiting (Provisional & Configurable)
  await app.register(rateLimit as any, {
    global: true,
    max: (req: any) => {
      const url = (req.url as string) || '';
      // Sensitive authentication routes receive tighter threshold to prevent brute-force attacks
      if (
        url.includes('/auth/login') ||
        url.includes('/auth/refresh') ||
        url.includes('/auth/switch-role') ||
        url.includes('/auth/logout')
      ) {
        return config.RATE_LIMIT_AUTH_MAX;
      }
      // General API routes have generous threshold ensuring zero interference with mobile sync & evidence streaming
      return config.RATE_LIMIT_GLOBAL_MAX;
    },
    timeWindow: config.RATE_LIMIT_TIME_WINDOW_MS,
    allowList: () => false,
    errorResponseBuilder: (req: any, context: any) => {
      const correlationId =
        (req as unknown as { correlationId?: string }).correlationId || generateCorrelationId();
      const err = new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Too many requests. Rate limit of ${context.max} requests per ${Math.round(
            context.ttl / 1000,
          )}s exceeded. Please retry after ${Math.ceil(context.ttl / 1000)} seconds.`,
          code: 'ERR_RATE_LIMIT_EXCEEDED',
          correlationId,
          timestamp: nowUtcIso(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
      (err as any).statusCode = HttpStatus.TOO_MANY_REQUESTS;
      (err as any).code = 'ERR_RATE_LIMIT_EXCEEDED';
      return err;
    },
  });

  // 3. Global API Version Prefix: /api/v1
  app.setGlobalPrefix(config.API_PREFIX.replace(/^\//, ''));

  // 4. Global Interceptors, Filters & Pipes
  app.useGlobalInterceptors(new CorrelationIdInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ZodValidationPipe());

  // 5. CORS Configuration
  app.enableCors({
    origin: config.CORS_ORIGIN === '*' ? '*' : config.CORS_ORIGIN.split(','),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
}

async function bootstrap(): Promise<NestFastifyApplication> {
  const logger = new Logger('ZentraBootstrap');
  const config = loadAppConfig();

  const fastifyAdapter = new FastifyAdapter({
    logger: config.PRETTY_LOGGING,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, fastifyAdapter);
  await configureApp(app, config);

  await app.listen(config.API_PORT, config.API_HOST);
  logger.log(
    `ZENTRA API active on http://${config.API_HOST}:${config.API_PORT}${config.API_PREFIX} [${config.APP_ENV}]`,
  );
  return app;
}

// Auto-run bootstrap if executed directly
if (require.main === module) {
  bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal API bootstrap error:', err);
    process.exit(1);
  });
}

export { bootstrap };

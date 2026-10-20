import { describe, it, expect, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { HealthController } from '../src/modules/health/health.controller';
import { assertTestEnvironmentIsSafe } from '@zentra/testing';

describe('ZENTRA API Foundation Smoke Tests', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zentra_test';
    assertTestEnvironmentIsSafe();
  });
  it('successfully compiles AppModule in NestJS DI container', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    const healthController = moduleRef.get<HealthController>(HealthController);
    expect(healthController).toBeDefined();
  });

  it('verifies HealthController liveness handler returns ok', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({
      method: 'GET',
      url: '/health/liveness',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.environment).toBeDefined();

    await app.close();
  });

  it('verifies HealthController readiness handler returns ready', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({
      method: 'GET',
      url: '/health/readiness',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.services).toBeDefined();
    expect(body.data.services.api_event_loop.status).toBe('ok');
    expect(body.data.environment).toBeDefined();

    await app.close();
  });
});

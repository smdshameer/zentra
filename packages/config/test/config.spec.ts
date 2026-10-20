import { describe, it, expect } from 'vitest';
import { loadAppConfig, envSchema } from '../src/index';

describe('Configuration Foundation Smoke Tests', () => {
  it('loads valid development configuration with defaults', () => {
    const mockEnv = {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/zentra_dev',
      NODE_ENV: 'development',
      APP_ENV: 'local',
    };

    const config = loadAppConfig(mockEnv);
    expect(config.APP_ENV).toBe('local');
    expect(config.API_PORT).toBe(4000);
    expect(config.S3_BUCKET_NAME).toBe('zentra-local-evidence');
  });

  it('fails closed when production credentials use mock/dev secrets', () => {
    const dangerousProdEnv = {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/zentra_dev',
      NODE_ENV: 'production',
      APP_ENV: 'production',
      JWT_ACCESS_SECRET: 'dev_mock_jwt_secret',
    };

    expect(() => loadAppConfig(dangerousProdEnv)).toThrow(
      /CRITICAL: Configuration validation failed/,
    );
  });

  it('rejects missing DATABASE_URL', () => {
    const invalidEnv = {
      DATABASE_URL: '',
    };

    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
  });

  it('fails closed when staging credentials use mock/dev secrets or default bucket', () => {
    const dangerousStagingEnv = {
      DATABASE_URL: 'postgresql://zentra_app:secure_pass@staging-db.internal:5432/zentra_staging',
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      JWT_ACCESS_SECRET: 'dev_mock_jwt_secret',
      JWT_REFRESH_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
      OFFLINE_PERMIT_SIGNING_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef',
      S3_BUCKET_NAME: 'zentra-staging-evidence',
    };

    expect(() => loadAppConfig(dangerousStagingEnv)).toThrow(
      /CRITICAL: Configuration validation failed/,
    );
  });

  it('loads valid staging configuration with production-grade secrets and rate limits', () => {
    const validStagingEnv = {
      DATABASE_URL: 'postgresql://zentra_app:secure_pass@staging-db.internal:5432/zentra_staging',
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      JWT_ACCESS_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
      JWT_REFRESH_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
      OFFLINE_PERMIT_SIGNING_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef',
      S3_BUCKET_NAME: 'zentra-staging-evidence',
      RATE_LIMIT_GLOBAL_MAX: '500',
      RATE_LIMIT_AUTH_MAX: '10',
    };

    const config = loadAppConfig(validStagingEnv);
    expect(config.APP_ENV).toBe('staging');
    expect(config.RATE_LIMIT_GLOBAL_MAX).toBe(500);
    expect(config.RATE_LIMIT_AUTH_MAX).toBe(10);
    expect(config.S3_BUCKET_NAME).toBe('zentra-staging-evidence');
  });
});

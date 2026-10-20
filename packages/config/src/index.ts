/**
 * ZENTRA — Validated Environment and Application Configuration
 * packages/config
 */

import { envSchema, type EnvConfig } from './env.schema';
export * from './constants';
export * from './env.schema';

/**
 * Loads and validates environment variables.
 * Throws a formatted error if required variables are missing or invalid.
 */
export function loadAppConfig(
  envSource: Record<string, string | undefined> = process.env,
): EnvConfig {
  const result = envSchema.safeParse(envSource);

  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `  - [${err.path.join('.')}]: ${err.message}`)
      .join('\n');
    throw new Error(`CRITICAL: Configuration validation failed:\n${errorDetails}`);
  }

  return result.data;
}

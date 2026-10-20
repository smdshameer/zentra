import { describe, it, expect } from 'vitest';
import {
  apiErrorEnvelopeSchema,
  createSuccessEnvelopeSchema,
  paginationMetaSchema,
} from '../src/common/envelopes.contract';
import { z } from 'zod';

describe('Contracts Foundation Smoke Tests', () => {
  it('validates a structured API Error envelope', () => {
    const mockError = {
      success: false,
      error: {
        category: 'VALIDATION_ERROR',
        code: 'ERR_INVALID_PAYLOAD',
        message: 'The submitted payload was invalid',
        details: [{ field: 'email', message: 'Invalid format' }],
        isRetryable: false,
      },
      correlationId: '01925b42-8e19-72aa-98ff-778899aabbcc',
      timestamp: '2026-10-05T07:00:00.000Z',
    };

    const parsed = apiErrorEnvelopeSchema.safeParse(mockError);
    expect(parsed.success).toBe(true);
  });

  it('validates a structured API Success envelope with pagination', () => {
    const dataSchema = z.object({ id: z.string(), name: z.string() });
    const successSchema = createSuccessEnvelopeSchema(dataSchema);

    const mockSuccess = {
      success: true,
      data: { id: 'test-123', name: 'Zentra Unit Test' },
      meta: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
      correlationId: '01925b42-8e19-72aa-98ff-778899aabbcc',
      timestamp: '2026-10-05T07:00:00.000Z',
    };

    const parsed = successSchema.safeParse(mockSuccess);
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid pagination metadata', () => {
    const invalidMeta = {
      page: 0, // must be min 1
      limit: 10,
      total: -1, // must be min 0
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    };

    const parsed = paginationMetaSchema.safeParse(invalidMeta);
    expect(parsed.success).toBe(false);
  });
});

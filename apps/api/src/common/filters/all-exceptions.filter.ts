/**
 * ZENTRA — Global Canonical Exception Filter
 * apps/api/src/common/filters/all-exceptions.filter.ts
 */

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { nowUtcIso, generateCorrelationId } from '@zentra/shared';
import type { ApiErrorEnvelope, ErrorCategory } from '@zentra/types';
import { ZodError } from 'zod';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const correlationId =
      (request as unknown as { correlationId?: string }).correlationId || generateCorrelationId();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let category: ErrorCategory = 'INTERNAL_ERROR';
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected internal error occurred.';
    let details: Array<{ field?: string; message: string; code?: string }> | undefined;
    let isRetryable = false;

    if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      category = 'VALIDATION_ERROR';
      code = 'ERR_VALIDATION_FAILED';
      message = 'Request payload or parameter validation failed.';
      details = exception.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
        code: e.code,
      }));
      isRetryable = false;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, unknown>;
        message = (obj['message'] as string) || exception.message;
        code = (obj['code'] as string) || (obj['error'] as string) || `HTTP_${status}`;
      }

      if (status === HttpStatus.BAD_REQUEST) {
        category = 'VALIDATION_ERROR';
      } else if (status === HttpStatus.UNAUTHORIZED) {
        category = 'AUTHENTICATION_ERROR';
      } else if (status === HttpStatus.FORBIDDEN) {
        category = 'AUTHORIZATION_ERROR';
      } else if (status === HttpStatus.NOT_FOUND) {
        category = 'NOT_FOUND';
      } else if (status === HttpStatus.CONFLICT) {
        category = 'CONFLICT';
      } else if (status === HttpStatus.TOO_MANY_REQUESTS) {
        category = 'RATE_LIMITED';
        isRetryable = true;
      } else if (status >= 500) {
        category = 'INTERNAL_ERROR';
        isRetryable = status === 503;
      }
    } else if (exception instanceof Error) {
      const pgErr = exception as { code?: string };
      if (pgErr.code === '22P02' || exception.message?.includes('invalid input syntax for type uuid')) {
        status = HttpStatus.BAD_REQUEST;
        category = 'VALIDATION_ERROR';
        code = 'ERR_INVALID_UUID_SYNTAX';
        message = 'Invalid parameter syntax: expected a valid UUID.';
      } else {
        this.logger.error(
          `Unhandled error [${correlationId}]: ${exception.message}`,
          exception.stack,
        );
        message = 'An internal system error occurred.';
      }
    } else if (
      typeof exception === 'object' &&
      exception !== null &&
      (('statusCode' in exception && (exception as any).statusCode === HttpStatus.TOO_MANY_REQUESTS) ||
        ('status' in exception && (exception as any).status === HttpStatus.TOO_MANY_REQUESTS))
    ) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      category = 'RATE_LIMITED';
      code = (exception as any).code || 'ERR_RATE_LIMIT_EXCEEDED';
      message = (exception as any).message || 'Rate limit exceeded.';
      isRetryable = true;
    }

    const errorEnvelope: ApiErrorEnvelope = {
      success: false,
      error: {
        category,
        code,
        message,
        details,
        isRetryable,
      },
      correlationId,
      timestamp: nowUtcIso(),
    };

    reply.status(status).send(errorEnvelope);
  }
}

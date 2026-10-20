/**
 * ZENTRA — Correlation ID Interceptor
 * apps/api/src/common/interceptors/correlation-id.interceptor.ts
 */

import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { generateCorrelationId } from '@zentra/shared';
import type { FastifyRequest, FastifyReply } from 'fastify';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const incomingHeader = request.headers[CORRELATION_ID_HEADER];
    const correlationId =
      typeof incomingHeader === 'string' && incomingHeader.length > 0
        ? incomingHeader
        : generateCorrelationId();

    // Attach to request context
    (request as unknown as { correlationId: string }).correlationId = correlationId;

    // Echo back in response header
    reply.header(CORRELATION_ID_HEADER, correlationId);

    return next.handle();
  }
}

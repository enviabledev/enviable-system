import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { Principal } from '../auth/auth.service';
import { AUDIT_KEY, AuditMetadata } from '../common/decorators';
import { AuditService } from './audit.service';

/**
 * Global interceptor. For handlers annotated with @Audit, it writes one
 * immutable audit row on a SUCCESSFUL response only. The RxJS tap fires on next
 * emission, so a thrown handler or a guard rejection (which never emits next)
 * audits nothing. The full response is captured as afterState; this runs before
 * the cost-visibility stripping so the audit keeps the complete computed result.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMetadata>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: Principal }>();

    return next.handle().pipe(
      tap((result) => {
        void this.record(meta, request, result);
      }),
    );
  }

  private async record(
    meta: AuditMetadata,
    request: Request & { user?: Principal },
    result: unknown,
  ): Promise<void> {
    try {
      await this.audit.write({
        actorUserId: request.user?.id ?? null,
        action: meta.action,
        entityType: meta.entityType,
        entityId: this.extractEntityId(result),
        afterState: this.toJson(result),
        context: this.toJson({
          method: request.method,
          path: request.originalUrl ?? request.url,
          params: request.params,
          query: request.query,
        }),
      });
    } catch (err) {
      // An audit failure must never break an already-successful response.
      this.logger.error('Failed to write audit row', err as Error);
    }
  }

  private extractEntityId(result: unknown): string | null {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const id = (result as { id?: unknown }).id;
      if (typeof id === 'string') {
        return id;
      }
      if (typeof id === 'number') {
        return String(id);
      }
    }
    return null;
  }

  private toJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === undefined || value === null) {
      return null;
    }
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

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
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

/**
 * Global interceptor. For handlers annotated with @Audit, it writes one
 * immutable audit row on a SUCCESSFUL response only. The RxJS tap fires on next
 * emission, so a thrown handler or a guard rejection (which never emits next)
 * audits nothing. The full response is captured as afterState; this runs before
 * the cost-visibility stripping so the audit keeps the complete computed result.
 *
 * beforeState capture: a best-effort findUnique by `req.params.id` on the
 * @Audit-declared entityType runs BEFORE next.handle() so the read sees the
 * pre-mutation row. The result threads into the audit write as beforeState. For
 * routes without :id (POST to a collection: creates), entity-type mismatches
 * (e.g. `salesorder.invoice` has entityType 'Invoice' but :id is the parent SO,
 * so the Invoice is genuinely being created), or any read error, beforeState
 * stays null and the audit row still records action + afterState. Routes whose
 * id-bearing param is named other than `:id` (the historical-load
 * /units/:shipmentId endpoint) also yield null beforeState; this is acceptable
 * for the bulk-load case (a create-many action) and tracked in BACKLOG.md.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
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

    // Pre-handler snapshot. Awaited (not parallelised with the handler) so the
    // read is guaranteed to observe the pre-mutation row, not race with the
    // handler's write. Cost is one indexed-PK findUnique per audited mutation.
    const beforeState = await this.captureBeforeState(meta, request);

    return next.handle().pipe(
      tap((result) => {
        void this.record(meta, request, result, beforeState);
      }),
    );
  }

  /**
   * Read the entity as it stands before the handler mutates it. Returns null
   * (a) when the route has no :id param (POST to a collection: the action is
   * creating, no prior state exists), (b) when the @Audit entityType doesn't
   * resolve to a Prisma client model (defensive against typos), (c) when
   * findUnique returns no row (the :id refers to a different entity than the
   * @Audit entityType: the action is creating, e.g. salesorder.invoice creates
   * an Invoice with the SO id in :id), or (d) when the read errors (logged,
   * swallowed). The captured row is the FULL Prisma row including any cost
   * fields; I-8 privacy is enforced at audit.read time by gating, not by
   * sanitising what gets persisted (consistent with afterState).
   */
  private async captureBeforeState(
    meta: AuditMetadata,
    request: Request,
  ): Promise<Prisma.InputJsonValue | null> {
    const id =
      typeof request.params?.id === 'string' ? request.params.id : null;
    if (!id) return null;
    const modelKey =
      meta.entityType.charAt(0).toLowerCase() + meta.entityType.slice(1);
    const model = (this.prisma as unknown as Record<string, unknown>)[modelKey];
    if (
      !model ||
      typeof (model as { findUnique?: unknown }).findUnique !== 'function'
    ) {
      return null;
    }
    try {
      const row = await (
        model as {
          findUnique: (args: { where: { id: string } }) => Promise<unknown>;
        }
      ).findUnique({ where: { id } });
      return this.toJson(row);
    } catch (err) {
      this.logger.warn(
        `Pre-audit findUnique on ${meta.entityType}#${id} failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async record(
    meta: AuditMetadata,
    request: Request & { user?: Principal },
    result: unknown,
    beforeState: Prisma.InputJsonValue | null,
  ): Promise<void> {
    try {
      await this.audit.write({
        actorUserId: request.user?.id ?? null,
        action: meta.action,
        entityType: meta.entityType,
        // Fall back to the route's :id when the response body carries no id of
        // its own (e.g. the admin-reset endpoint returns only { initialPassword }).
        entityId:
          this.extractEntityId(result) ??
          (typeof request.params?.id === 'string' ? request.params.id : null),
        beforeState,
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
      const direct = (result as { id?: unknown }).id;
      if (typeof direct === 'string') {
        return direct;
      }
      if (typeof direct === 'number') {
        return String(direct);
      }
      // Responses that wrap the entity (e.g. create returns
      // { user, initialPassword }) expose the id one level down.
      const nested = (result as { user?: { id?: unknown } }).user?.id;
      if (typeof nested === 'string') {
        return nested;
      }
    }
    return null;
  }

  private toJson(value: unknown): Prisma.InputJsonValue | null {
    if (value === undefined || value === null) {
      return null;
    }
    const plain = JSON.parse(JSON.stringify(value)) as unknown;
    return this.redactSensitive(plain) as Prisma.InputJsonValue;
  }

  // Strip security-sensitive keys from any captured state before it is written.
  // The before-state path does a bare findUnique, so a User mutation would
  // otherwise persist the argon2 hash into the audit row; this keeps the hash
  // (and any future secret-shaped column) out of the audit log entirely.
  private redactSensitive(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactSensitive(item));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        out[key] = SENSITIVE_KEYS.has(key)
          ? REDACTED
          : this.redactSensitive(val);
      }
      return out;
    }
    return value;
  }
}

const REDACTED = '[redacted]';
// passwordHash: never persist the stored hash. password/initialPassword: never
// persist a cleartext credential that a response body may transiently carry
// (the admin create/reset responses include initialPassword, the deployment
// default, which must not land in the audit row).
const SENSITIVE_KEYS = new Set(['passwordHash', 'password', 'initialPassword']);

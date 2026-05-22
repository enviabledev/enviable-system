import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { map, Observable } from 'rxjs';
import { Principal } from '../../auth/auth.service';
import { SKIP_COST_STRIP_KEY } from '../decorators';

export const COST_VIEW_PERMISSION = 'costdata.view';

// Cost-bearing keys stripped for callers without costdata.view. These live on
// different models (landedCost on Unit/LandedCost, landedCostPerUnit on lines),
// hence both belong here (Invariant I-8).
export const SENSITIVE_KEYS = new Set<string>([
  'landedCost',
  'landedCostPerUnit',
]);

/**
 * Global interceptor enforcing Invariant I-8: a caller lacking costdata.view
 * never sees cost-bearing fields. When the principal holds the permission the
 * walk is bypassed entirely. Otherwise the response is recursively walked and
 * the sensitive keys are removed.
 *
 * The audit log still records the full, unstripped response: see the ordering
 * note where this interceptor is registered. The audit-log READ endpoint is
 * additionally exempt via @SkipCostStrip(): it must return the complete record
 * (cost data included) to any audit.read holder, even one lacking costdata.view.
 */
@Injectable()
export class CostVisibilityInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Route-level exemption: handlers marked @SkipCostStrip() (the audit-log
    // read) return full data by design, gated by their own permission.
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_COST_STRIP_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: Principal }>();
    const canSeeCost =
      request.user?.permissions.includes(COST_VIEW_PERMISSION) ?? false;

    if (canSeeCost) {
      // Cost-permitted caller: bypass the walk entirely.
      return next.handle();
    }

    return next.handle().pipe(map((value) => this.strip(value)));
  }

  private strip(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.strip(item));
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }
    // CRITICAL: skip non-plain objects. Date, Prisma.Decimal, and other class
    // instances must be left untouched. Rebuilding or spreading them destroys
    // their prototype and corrupts JSON serialization (Date becomes {}, Decimal
    // becomes { s, e, d, ... }). Only plain object literals are walked.
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return value;
    }
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (SENSITIVE_KEYS.has(key)) {
        // Omit the key entirely (absent, not null).
        continue;
      }
      result[key] = this.strip(source[key]);
    }
    return result;
  }
}

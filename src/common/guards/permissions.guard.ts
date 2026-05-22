import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Principal } from '../../auth/auth.service';
import { PERMISSIONS_KEY } from '../decorators';

/**
 * Global guard, runs SECOND (after AuthGuard has attached the principal). If a
 * route declares no @RequirePermissions, it allows. Otherwise the principal
 * must hold every listed key, checked against its deduplicated permission union
 * (Invariant I-13). Returns 403 naming the missing key(s) when it does not.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: Principal }>();
    const principal = request.user;
    if (!principal) {
      // AuthGuard runs first and attaches the principal. Its absence here means
      // a misconfigured guard order, or @RequirePermissions on a @Public route.
      throw new ForbiddenException('No authenticated principal');
    }

    const held = new Set(principal.permissions);
    const missing = required.filter((key) => !held.has(key));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing permission(s): ${missing.join(', ')}`,
      );
    }
    return true;
  }
}

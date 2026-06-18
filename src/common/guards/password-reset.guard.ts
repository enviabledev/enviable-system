import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Principal } from '../../auth/auth.service';
import { PASSWORD_RESET_EXEMPT_KEY } from '../decorators';

/**
 * Global guard, runs AFTER AuthGuard (which attaches the principal) and BEFORE
 * PermissionsGuard. It enforces the forced-password-reset gate: a user whose
 * `mustResetPassword` flag is set may reach ONLY routes marked
 * @PasswordResetExempt (the reset endpoint and read-only session resolution);
 * every other authenticated request is rejected with a stable, frontend-
 * interpretable body so the UI can redirect to the reset screen.
 *
 * This gate is the security property that makes a known, shared default initial
 * password acceptable: the default can be used to authenticate, but it unlocks
 * nothing except the means to replace itself.
 */
@Injectable()
export class PasswordResetGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: Principal }>();
    const principal = request.user;

    // No principal => a @Public route AuthGuard already allowed; nothing to gate.
    if (!principal || !principal.mustResetPassword) {
      return true;
    }

    const exempt = this.reflector.getAllAndOverride<boolean>(
      PASSWORD_RESET_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (exempt) {
      return true;
    }

    throw new ForbiddenException({
      error: 'PASSWORD_RESET_REQUIRED',
      message: 'You must reset your password before accessing the system.',
    });
  }
}

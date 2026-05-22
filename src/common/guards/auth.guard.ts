import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService, Principal } from '../../auth/auth.service';
import { IS_PUBLIC_KEY } from '../decorators';

/**
 * Global guard, runs FIRST. Lets @Public() routes through unauthenticated.
 * Otherwise it requires a valid session, resolves the principal fresh via the
 * auth service, and attaches it to the request so @CurrentUser() and the
 * PermissionsGuard (which runs second) can read it. Returns 401 when there is
 * no valid session.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: Principal }>();
    const userId = request.session?.userId;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const principal = await this.auth.getPrincipal(userId);
    if (!principal) {
      throw new UnauthorizedException('Authentication required');
    }

    request.user = principal;
    return true;
  }
}

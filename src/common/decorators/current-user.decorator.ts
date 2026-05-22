import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Principal } from '../../auth/auth.service';

/**
 * Inject the resolved principal that the global AuthGuard attaches to the
 * request. Undefined on public routes that carry no authenticated principal.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: Principal }>();
    return request.user;
  },
);

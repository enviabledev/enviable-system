import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { PASSWORD_RESET_EXEMPT_KEY } from './metadata-keys';

/**
 * Marks a route as reachable by a user whose `mustResetPassword` flag is set.
 * The PasswordResetGuard blocks all other authenticated routes for such a user;
 * apply this only to the reset endpoint and read-only session resolution so the
 * forced-reset flow can complete.
 */
export const PasswordResetExempt = (): CustomDecorator =>
  SetMetadata(PASSWORD_RESET_EXEMPT_KEY, true);

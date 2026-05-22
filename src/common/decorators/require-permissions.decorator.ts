import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { PERMISSIONS_KEY } from './metadata-keys';

/**
 * Declare the permission keys a route requires. The global PermissionsGuard
 * checks them against the principal's permission union (Invariant I-13).
 */
export const RequirePermissions = (...keys: string[]): CustomDecorator =>
  SetMetadata(PERMISSIONS_KEY, keys);

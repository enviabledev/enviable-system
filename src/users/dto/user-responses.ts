import { Prisma } from '@prisma/client';

// The user shape every endpoint returns: every scalar except passwordHash, plus
// the role id+name resolved through the junction. Derived from the service's
// USER_VIEW so the two never drift.
export type SafeUser = Prisma.UserGetPayload<{
  omit: { passwordHash: true };
  include: { userRoles: { include: { role: { select: { id: true; name: true } } } } };
}>;

/**
 * Response of POST /api/users. Carries the freshly-created user PLUS the
 * deployment-wide initial password, so the admin can communicate it to the new
 * user once at the moment of creation.
 *
 * `initialPassword` is the deployment bootstrap default (DEFAULT_INITIAL_PASSWORD),
 * NOT a per-user secret. It is returned ONLY here and on the admin reset
 * endpoint, both gated on user.manage, and NEVER on a read (list/detail) or in
 * the offline mirror. It is also redacted from the audit row. The frontend shows
 * it transiently and never persists it.
 */
export interface CreateUserResponse {
  user: SafeUser;
  initialPassword: string;
}

/**
 * Response of POST /api/users/:id/reset-password-required. The admin reset sets
 * the user's password back to the deployment default and forces a change on next
 * login; this returns that default so the admin can relay it, consumed
 * identically to CreateUserResponse.initialPassword. Same exposure rules apply.
 */
export interface AdminResetResponse {
  initialPassword: string;
}

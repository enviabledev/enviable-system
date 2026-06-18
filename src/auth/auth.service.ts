import { Injectable, UnauthorizedException } from '@nestjs/common';
import { User, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password.util';

/**
 * The authenticated principal consumed by guards and @CurrentUser(). It never
 * carries the password hash. `permissions` is the deduplicated union of every
 * permission key across all of the user's roles (Invariant I-13: additive only,
 * no deny-list). `mustResetPassword` is carried so the PasswordResetGuard can
 * gate the user to the reset endpoint without a second DB read per request.
 */
export interface Principal {
  id: string;
  fullName: string;
  email: string;
  roles: string[];
  permissions: string[];
  mustResetPassword: boolean;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Load an active, non-deleted user and verify the supplied password. Returns
   * the user on success, otherwise null. A placeholder-hash (not-yet-activated)
   * user fails verification cleanly and yields null.
   */
  async validateCredentials(
    email: string,
    plainPassword: string,
  ): Promise<User | null> {
    const user = await this.prisma.user.findFirst({
      where: { email, status: UserStatus.ACTIVE, deletedAt: null },
    });
    if (!user) {
      return null;
    }
    const ok = await verifyPassword(user.passwordHash, plainPassword);
    return ok ? user : null;
  }

  /**
   * Build the principal for an active, non-deleted user: identity plus the
   * union of all permission keys granted by any of the user's roles,
   * deduplicated. There is no mechanism to subtract a permission (I-13).
   */
  async getPrincipal(userId: string): Promise<Principal | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: UserStatus.ACTIVE, deletedAt: null },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });
    if (!user) {
      return null;
    }

    const roles = user.userRoles.map((ur) => ur.role.name).sort();

    const permissionSet = new Set<string>();
    for (const userRole of user.userRoles) {
      for (const rolePermission of userRole.role.rolePermissions) {
        permissionSet.add(rolePermission.permission.key);
      }
    }
    const permissions = Array.from(permissionSet).sort();

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      roles,
      permissions,
      mustResetPassword: user.mustResetPassword,
    };
  }

  /**
   * Self-service password change. Verifies the caller's current password (the
   * known default for a first-time user, or whatever they last set), then stores
   * the new hash and clears mustResetPassword. This is the only mutation a user
   * in the must-reset state is permitted to perform; the PasswordResetGuard lets
   * it through. Returns the refreshed principal so the caller can proceed
   * immediately. The new password is never logged or echoed.
   */
  async resetPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<Principal> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: UserStatus.ACTIVE, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    const ok = await verifyPassword(user.passwordHash, currentPassword);
    if (!ok) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustResetPassword: false },
    });
    const principal = await this.getPrincipal(userId);
    if (!principal) {
      throw new UnauthorizedException();
    }
    return principal;
  }
}

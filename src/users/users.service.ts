import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserStatus } from '@prisma/client';
import { hashPassword } from '../auth/password.util';
import { isUniqueViolationOn } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';

// The permission that confers user/role administration. The system must never
// be left with zero active users holding it (single-point-of-failure guard).
const MANAGE_PERMISSION = 'user.manage';

// The view shape returned by every endpoint: every scalar EXCEPT passwordHash
// (omit keeps the hash out of API responses entirely), plus each role's id+name
// resolved through the junction. mustResetPassword/status/deactivated* are
// admin-facing fields and intentionally included here (this is the gated API,
// not the offline mirror).
const USER_VIEW = {
  omit: { passwordHash: true },
  include: {
    userRoles: {
      include: { role: { select: { id: true, name: true } } },
      orderBy: { assignedAt: 'asc' },
    },
  },
} satisfies Prisma.UserDefaultArgs;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async findAll(query: QueryUsersDto) {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.roleId) where.userRoles = { some: { roleId: query.roleId } };
    if (query.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { fullName: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        ...USER_VIEW,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      ...USER_VIEW,
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async create(dto: CreateUserDto, actorId: string) {
    const initialPassword = this.config.get<string>('DEFAULT_INITIAL_PASSWORD');
    if (!initialPassword || initialPassword.trim().length === 0) {
      // A server misconfiguration, not a client error: ops must set the var
      // intentionally. There is deliberately no hardcoded fallback.
      throw new InternalServerErrorException(
        'DEFAULT_INITIAL_PASSWORD must be configured before users can be created',
      );
    }
    await this.assertRolesExist(dto.roleIds);

    const passwordHash = await hashPassword(initialPassword);
    try {
      return await this.prisma.user.create({
        data: {
          fullName: dto.fullName,
          email: dto.email,
          passwordHash,
          // The known default is never a usable credential beyond the reset gate.
          mustResetPassword: true,
          createdById: actorId,
          userRoles: { create: dto.roleIds.map((roleId) => ({ roleId })) },
        },
        ...USER_VIEW,
      });
    } catch (err) {
      if (isUniqueViolationOn(err, { index: 'users_email_key', fields: ['email'] })) {
        throw new ConflictException(`A user with email ${dto.email} already exists`);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    await this.findOne(id); // 404 if missing or already soft-deleted
    const isSelf = id === actorId;

    if (dto.roleIds !== undefined) {
      await this.assertRolesExist(dto.roleIds);
      // Footgun guard: an admin cannot strip their own management permission and
      // lock themselves out of recovery.
      if (isSelf && !(await this.rolesGrantManage(dto.roleIds))) {
        throw new ForbiddenException(
          'You cannot remove your own user.manage permission',
        );
      }
    }
    if (isSelf && dto.status === UserStatus.INACTIVE) {
      throw new ForbiddenException('You cannot deactivate yourself');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.roleIds !== undefined) {
          await tx.userRole.deleteMany({ where: { userId: id } });
          if (dto.roleIds.length > 0) {
            await tx.userRole.createMany({
              data: dto.roleIds.map((roleId) => ({ userId: id, roleId })),
            });
          }
        }

        const data: Prisma.UserUpdateInput = {};
        if (dto.fullName !== undefined) data.fullName = dto.fullName;
        if (dto.email !== undefined) data.email = dto.email;
        if (dto.status !== undefined) {
          data.status = dto.status;
          if (dto.status === UserStatus.INACTIVE) {
            data.deactivatedAt = new Date();
            data.deactivatedById = actorId;
          } else if (dto.status === UserStatus.ACTIVE) {
            // Reactivation clears the deactivation marker.
            data.deactivatedAt = null;
            data.deactivatedById = null;
          }
        }
        if (Object.keys(data).length > 0) {
          await tx.user.update({ where: { id }, data });
        }

        // System-wide backstop: no role/status change may leave the system with
        // zero active managers. Runs inside the tx so a violation rolls back.
        await this.assertManagementCoverage(tx);

        return tx.user.findUniqueOrThrow({ where: { id }, ...USER_VIEW });
      });
    } catch (err) {
      if (isUniqueViolationOn(err, { index: 'users_email_key', fields: ['email'] })) {
        throw new ConflictException(`A user with email ${dto.email} already exists`);
      }
      throw err;
    }
  }

  async softDelete(id: string, actorId: string) {
    await this.findOne(id);
    if (id === actorId) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: UserStatus.INACTIVE,
          deactivatedAt: new Date(),
          deactivatedById: actorId,
        },
      });
      await this.assertManagementCoverage(tx);
      // Returns the now-soft-deleted row (USER_VIEW has no deletedAt filter) so
      // the audit interceptor can snapshot it as afterState.
      return tx.user.findUniqueOrThrow({ where: { id }, ...USER_VIEW });
    });
  }

  /**
   * Admin-triggered "this user must reset on next login" without changing the
   * password. Cannot target oneself (the UI never offers it; enforced here as
   * defence in depth).
   */
  async requirePasswordReset(id: string, actorId: string) {
    await this.findOne(id);
    if (id === actorId) {
      throw new ForbiddenException(
        'You cannot set a forced password reset on yourself',
      );
    }
    await this.prisma.user.update({
      where: { id },
      data: { mustResetPassword: true },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id }, ...USER_VIEW });
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private async assertRolesExist(roleIds: string[]): Promise<void> {
    if (roleIds.length === 0) return;
    const ids = [...new Set(roleIds)];
    const count = await this.prisma.role.count({
      where: { id: { in: ids }, deletedAt: null },
    });
    if (count !== ids.length) {
      throw new BadRequestException('One or more roleIds are invalid');
    }
  }

  private async rolesGrantManage(roleIds: string[]): Promise<boolean> {
    if (roleIds.length === 0) return false;
    const count = await this.prisma.rolePermission.count({
      where: {
        roleId: { in: roleIds },
        permission: { key: MANAGE_PERMISSION },
      },
    });
    return count > 0;
  }

  private async assertManagementCoverage(
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const managers = await tx.user.count({
      where: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
        userRoles: {
          some: {
            role: {
              deletedAt: null,
              rolePermissions: { some: { permission: { key: MANAGE_PERMISSION } } },
            },
          },
        },
      },
    });
    if (managers === 0) {
      throw new ForbiddenException(
        'This change would leave no active user with the user.manage permission',
      );
    }
  }
}

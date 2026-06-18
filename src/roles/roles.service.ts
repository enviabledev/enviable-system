import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUniqueViolationOn } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const ROLE_VIEW = {
  include: {
    rolePermissions: {
      include: {
        permission: {
          select: { id: true, key: true, description: true, category: true },
        },
      },
    },
  },
} satisfies Prisma.RoleDefaultArgs;

type RoleWithPermissions = Prisma.RoleGetPayload<typeof ROLE_VIEW>;

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const roles = await this.prisma.role.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      ...ROLE_VIEW,
    });
    return roles.map((r) => this.toView(r));
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null },
      ...ROLE_VIEW,
    });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return this.toView(role);
  }

  async create(dto: CreateRoleDto) {
    await this.assertPermissionsExist(dto.permissionIds);
    try {
      const role = await this.prisma.role.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          rolePermissions: {
            create: dto.permissionIds.map((permissionId) => ({ permissionId })),
          },
        },
        ...ROLE_VIEW,
      });
      return this.toView(role);
    } catch (err) {
      if (isUniqueViolationOn(err, { index: 'roles_name_key', fields: ['name'] })) {
        throw new ConflictException(`A role named "${dto.name}" already exists`);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateRoleDto) {
    await this.findOne(id);
    if (dto.permissionIds !== undefined) {
      await this.assertPermissionsExist(dto.permissionIds);
    }
    try {
      const role = await this.prisma.$transaction(async (tx) => {
        if (dto.permissionIds !== undefined) {
          await tx.rolePermission.deleteMany({ where: { roleId: id } });
          if (dto.permissionIds.length > 0) {
            await tx.rolePermission.createMany({
              data: dto.permissionIds.map((permissionId) => ({
                roleId: id,
                permissionId,
              })),
            });
          }
        }
        const data: Prisma.RoleUpdateInput = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.description !== undefined) data.description = dto.description;
        if (Object.keys(data).length > 0) {
          await tx.role.update({ where: { id }, data });
        }
        return tx.role.findUniqueOrThrow({ where: { id }, ...ROLE_VIEW });
      });
      return this.toView(role);
    } catch (err) {
      if (isUniqueViolationOn(err, { index: 'roles_name_key', fields: ['name'] })) {
        throw new ConflictException(`A role named "${dto.name}" already exists`);
      }
      throw err;
    }
  }

  async softDelete(id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null },
    });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    // Foundational roles are not deletable: the seeded catalogue is the system's
    // baseline access model.
    if (role.isSystemRole) {
      throw new ConflictException('A system role cannot be deleted');
    }
    // Cannot delete a role still assigned to any non-deleted user. Surfaced as a
    // validation error so the caller can unassign first.
    const assignments = await this.prisma.userRole.count({
      where: { roleId: id, user: { deletedAt: null } },
    });
    if (assignments > 0) {
      throw new ConflictException(
        `Role is assigned to ${assignments} user(s); unassign it before deleting`,
      );
    }
    const deleted = await this.prisma.role.update({
      where: { id },
      data: { deletedAt: new Date() },
      ...ROLE_VIEW,
    });
    return this.toView(deleted);
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private async assertPermissionsExist(permissionIds: string[]): Promise<void> {
    if (permissionIds.length === 0) return;
    const ids = [...new Set(permissionIds)];
    const count = await this.prisma.permission.count({
      where: { id: { in: ids } },
    });
    if (count !== ids.length) {
      throw new BadRequestException('One or more permissionIds are invalid');
    }
  }

  /** Flatten the junction into a plain permissions array for the response. */
  private toView(role: RoleWithPermissions) {
    const { rolePermissions, ...rest } = role;
    return {
      ...rest,
      permissions: rolePermissions.map((rp) => rp.permission),
    };
  }
}

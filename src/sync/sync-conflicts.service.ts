import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConflictStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyEntityField } from './apply-entity-field';
import { ConflictChoice, ResolveConflictDto } from './dto/resolve-conflict.dto';

@Injectable()
export class SyncConflictsService {
  constructor(private readonly prisma: PrismaService) {}

  /** List OPEN conflict review items, oldest first. */
  listOpen() {
    return this.prisma.conflictReviewItem.findMany({
      where: { status: ConflictStatus.OPEN },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.conflictReviewItem.findUnique({
      where: { id },
    });
    if (!item) {
      throw new NotFoundException(`Conflict ${id} not found`);
    }
    return item;
  }

  /**
   * Resolve an OPEN conflict. In one transaction: pick the chosen value (version
   * A, version B, or a supplied merged value), apply it to the entity field
   * (unit status routes through transitionUnit, honouring I-3), and mark the
   * item RESOLVED with resolvedById, resolvedAt, and the resolution record. A
   * non-OPEN item is rejected (terminal-state guard): a resolved or rejected
   * item cannot be re-resolved. The resolution is audited by the global
   * AuditInterceptor via the @Audit-annotated handler.
   */
  async resolve(id: string, dto: ResolveConflictDto, actorId: string) {
    const item = await this.findOne(id);
    if (item.status !== ConflictStatus.OPEN) {
      throw new ConflictException(
        `Conflict ${id} is ${item.status}; only an OPEN conflict can be resolved.`,
      );
    }
    if (!item.fieldPath) {
      throw new BadRequestException(
        `Conflict ${id} has no fieldPath; cannot apply a field resolution.`,
      );
    }

    const appliedValue = this.chosenValue(item, dto);

    return this.prisma.$transaction(async (tx) => {
      await applyEntityField(
        tx,
        item.entityType,
        item.entityId,
        item.fieldPath!,
        appliedValue,
        actorId,
      );
      return tx.conflictReviewItem.update({
        where: { id },
        data: {
          status: ConflictStatus.RESOLVED,
          resolvedById: actorId,
          resolvedAt: new Date(),
          resolution: {
            choice: dto.choice,
            appliedValue: (appliedValue ?? null) as Prisma.InputJsonValue,
          } as Prisma.InputJsonValue,
        },
      });
    });
  }

  private chosenValue(
    item: { versionA: Prisma.JsonValue; versionB: Prisma.JsonValue },
    dto: ResolveConflictDto,
  ): unknown {
    if (dto.choice === ConflictChoice.MERGED) {
      return dto.mergedValue;
    }
    const version =
      dto.choice === ConflictChoice.A ? item.versionA : item.versionB;
    // Versions are stored as { value: ... }.
    if (
      version &&
      typeof version === 'object' &&
      !Array.isArray(version) &&
      'value' in version
    ) {
      return (version as { value: unknown }).value;
    }
    return version;
  }
}

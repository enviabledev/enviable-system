import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConflictStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyEntityField } from './apply-entity-field';
import { FieldChangeDto, UpdateEntityPayloadDto } from './dto/update-entity.dto';
import { policyFor } from './sync-conflict-policy';

// Per-entity field allowlist. Only these fields may be patched via sync.
const FIELD_ALLOWLIST: Record<string, string[]> = {
  customer: ['name', 'phone', 'email', 'taxId', 'status', 'address'],
  // unit status (state machine, high-stakes) plus identity corrections.
  unit: ['status', 'engineNumber', 'chassisNumber'],
};

export interface MergeContext {
  actorId: string;
  deviceId?: string;
  clientTimestamp?: string;
}

export interface LwwOutcome {
  path: string;
  policy: 'LAST_WRITE_WINS';
  winner: 'incoming' | 'server';
  appliedValue: unknown;
  discardedValue: unknown;
}

export interface ReviewRef {
  path: string;
  conflictId: string;
}

export interface MergeResult {
  recordId: string;
  applied: string[];
  lastWriteWins: LwwOutcome[];
  reviews: ReviewRef[];
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

@Injectable()
export class SyncMergeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Field-level merge with per-field conflict policy. Each named field is
   * evaluated independently against its base (oldValue):
   * - server already equals newValue: no-op (idempotent).
   * - server still equals base (or no base given): CLEAN apply.
   * - server differs from both base and newValue: SAME-FIELD COLLISION, resolved
   *   by the field's policy:
   *     LAST_WRITE_WINS (low-stakes): apply the later client timestamp's value
   *       (incoming clientTimestamp vs the record's last server write), recording
   *       which value lost. Never goes to review.
   *     REVIEW (high-stakes): create an OPEN ConflictReviewItem capturing both
   *       versions and their contexts; do NOT overwrite. A supervisor resolves it.
   *
   * Everything happens in one transaction: clean applies, last-write-wins
   * applies, and review-item creation commit together (and a unique violation on
   * an applied field rolls the whole action back).
   */
  async applyFieldMerge(
    dto: UpdateEntityPayloadDto,
    ctx: MergeContext,
  ): Promise<MergeResult> {
    const allowed = FIELD_ALLOWLIST[dto.entityType];
    for (const change of dto.changes) {
      if (!allowed.includes(change.path)) {
        throw new BadRequestException(
          `Field ${change.path} is not updatable on ${dto.entityType}`,
        );
      }
    }

    const current = await this.loadCurrent(dto.entityType, dto.entityId);
    const serverUpdatedAt = (current['updatedAt'] as Date) ?? new Date(0);

    const applied: string[] = [];
    const lastWriteWins: LwwOutcome[] = [];
    // Field values to write this run (clean applies + incoming-wins LWW).
    const toApply: { path: string; value: unknown }[] = [];
    // Review items to create.
    const toReview: { change: FieldChangeDto; serverVal: unknown }[] = [];

    for (const change of dto.changes) {
      const serverVal = current[change.path];
      if (valuesEqual(serverVal, change.newValue)) {
        continue; // already at desired value
      }
      const isCollision =
        change.oldValue !== undefined &&
        !valuesEqual(serverVal, change.oldValue);

      if (!isCollision) {
        toApply.push({ path: change.path, value: change.newValue });
        applied.push(change.path);
        continue;
      }

      // Same-field collision: consult the per-field policy.
      if (policyFor(dto.entityType, change.path) === 'LAST_WRITE_WINS') {
        const incomingTs = ctx.clientTimestamp
          ? new Date(ctx.clientTimestamp)
          : new Date();
        const incomingWins = incomingTs.getTime() > serverUpdatedAt.getTime();
        if (incomingWins) {
          toApply.push({ path: change.path, value: change.newValue });
          lastWriteWins.push({
            path: change.path,
            policy: 'LAST_WRITE_WINS',
            winner: 'incoming',
            appliedValue: change.newValue,
            discardedValue: serverVal,
          });
        } else {
          lastWriteWins.push({
            path: change.path,
            policy: 'LAST_WRITE_WINS',
            winner: 'server',
            appliedValue: serverVal,
            discardedValue: change.newValue,
          });
        }
      } else {
        toReview.push({ change, serverVal });
      }
    }

    const reviews: ReviewRef[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const { path, value } of toApply) {
        await applyEntityField(
          tx,
          dto.entityType,
          dto.entityId,
          path,
          value,
          ctx.actorId,
        );
      }
      for (const { change, serverVal } of toReview) {
        const item = await tx.conflictReviewItem.create({
          data: {
            entityType: dto.entityType,
            entityId: dto.entityId,
            fieldPath: change.path,
            versionA: { value: serverVal ?? null } as Prisma.InputJsonValue,
            versionB: { value: change.newValue ?? null } as Prisma.InputJsonValue,
            contextA: {
              source: 'server',
              updatedAt: serverUpdatedAt.toISOString(),
            } as Prisma.InputJsonValue,
            contextB: {
              actorId: ctx.actorId,
              deviceId: ctx.deviceId ?? null,
              clientTimestamp: ctx.clientTimestamp ?? null,
            } as Prisma.InputJsonValue,
            status: ConflictStatus.OPEN,
          },
        });
        reviews.push({ path: change.path, conflictId: item.id });
      }
    });

    return { recordId: dto.entityId, applied, lastWriteWins, reviews };
  }

  private async loadCurrent(
    entityType: string,
    entityId: string,
  ): Promise<Record<string, unknown>> {
    if (entityType === 'customer') {
      const c = await this.prisma.customer.findUnique({ where: { id: entityId } });
      if (!c) throw new NotFoundException(`Customer ${entityId} not found`);
      return c as unknown as Record<string, unknown>;
    }
    const u = await this.prisma.unit.findUnique({ where: { id: entityId } });
    if (!u) throw new NotFoundException(`Unit ${entityId} not found`);
    return u as unknown as Record<string, unknown>;
  }
}

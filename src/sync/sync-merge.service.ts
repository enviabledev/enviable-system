import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FieldChangeDto, UpdateEntityPayloadDto } from './dto/update-entity.dto';
import { detectUniqueField, SyncUniqueConflictError } from './sync-conflicts';

// Per-entity field allowlist. Only these fields may be patched via sync.
const FIELD_ALLOWLIST: Record<string, string[]> = {
  customer: ['name', 'phone', 'email', 'taxId', 'status', 'address'],
  // engine/chassis edits are corrections to supplier-captured numbers; a
  // collision with an existing number must surface as a unique conflict.
  unit: ['engineNumber', 'chassisNumber'],
};

export interface FieldCollision {
  path: string;
  serverValue: unknown;
  attemptedValue: unknown;
  baseValue: unknown;
}

export interface MergeResult {
  recordId: string;
  applied: string[];
  collisions: FieldCollision[];
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Covers null, objects (JSON address), and primitive coercion symmetry.
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

@Injectable()
export class SyncMergeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Field-level merge. Loads the current server record and applies ONLY the
   * named fields, each independently against its base (oldValue):
   * - server already equals newValue: nothing to do (idempotent).
   * - server still equals the device's base oldValue: apply newValue.
   * - server differs from both base and newValue: SAME-FIELD COLLISION. The
   *   field is NOT overwritten; it is flagged for the per-field policy (next
   *   prompt). Other fields in the same action still apply.
   *
   * Two devices editing DIFFERENT fields both land (each applies cleanly). A
   * unique-constraint violation on an applied field (e.g. a duplicate engine
   * number) is detected via isUniqueViolationOn and rethrown as a
   * SyncUniqueConflictError for the batch to report as a structured conflict.
   */
  async applyFieldMerge(
    dto: UpdateEntityPayloadDto,
    _userId: string,
  ): Promise<MergeResult> {
    const allowed = FIELD_ALLOWLIST[dto.entityType];
    for (const change of dto.changes) {
      if (!allowed.includes(change.path)) {
        throw new BadRequestException(
          `Field ${change.path} is not updatable on ${dto.entityType}`,
        );
      }
    }

    if (dto.entityType === 'customer') {
      const current = await this.prisma.customer.findUnique({
        where: { id: dto.entityId },
      });
      if (!current) {
        throw new NotFoundException(`Customer ${dto.entityId} not found`);
      }
      const { data, applied, collisions } = this.computeMerge(
        current as unknown as Record<string, unknown>,
        dto.changes,
      );
      if (Object.keys(data).length > 0) {
        await this.runUpdate(
          () =>
            this.prisma.customer.update({
              where: { id: dto.entityId },
              data: data as Prisma.CustomerUncheckedUpdateInput,
            }),
          data,
        );
      }
      return { recordId: dto.entityId, applied, collisions };
    }

    // entityType === 'unit'
    const current = await this.prisma.unit.findUnique({
      where: { id: dto.entityId },
    });
    if (!current) {
      throw new NotFoundException(`Unit ${dto.entityId} not found`);
    }
    const { data, applied, collisions } = this.computeMerge(
      current as unknown as Record<string, unknown>,
      dto.changes,
    );
    if (Object.keys(data).length > 0) {
      await this.runUpdate(
        () =>
          this.prisma.unit.update({
            where: { id: dto.entityId },
            data: data as Prisma.UnitUncheckedUpdateInput,
          }),
        data,
      );
    }
    return { recordId: dto.entityId, applied, collisions };
  }

  private computeMerge(
    current: Record<string, unknown>,
    changes: FieldChangeDto[],
  ): { data: Record<string, unknown>; applied: string[]; collisions: FieldCollision[] } {
    const data: Record<string, unknown> = {};
    const applied: string[] = [];
    const collisions: FieldCollision[] = [];

    for (const change of changes) {
      const serverVal = current[change.path];
      if (valuesEqual(serverVal, change.newValue)) {
        // Already at the desired value; idempotent no-op.
        continue;
      }
      if (
        change.oldValue !== undefined &&
        !valuesEqual(serverVal, change.oldValue)
      ) {
        collisions.push({
          path: change.path,
          serverValue: serverVal,
          attemptedValue: change.newValue,
          baseValue: change.oldValue,
        });
        continue;
      }
      data[change.path] = change.newValue;
      applied.push(change.path);
    }
    return { data, applied, collisions };
  }

  // Run a field-set update, rewrapping a unique violation (detected via
  // isUniqueViolationOn) as a SyncUniqueConflictError carrying field and the
  // attempted value (read back from the data being set).
  private async runUpdate(
    fn: () => Promise<unknown>,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const field = detectUniqueField(err);
      if (field) {
        throw new SyncUniqueConflictError(field, data[field]);
      }
      throw err;
    }
  }
}

import { MovementType, Prisma, UnitStatus } from '@prisma/client';
import { transitionUnit } from '../units/transition-unit';
import { detectUniqueField, SyncUniqueConflictError } from './sync-conflicts';

/**
 * Apply a single field value to an entity inside a caller-supplied transaction.
 * Shared by the field merge (clean applies) and the conflict resolver.
 *
 * Unit STATUS is special: it routes through transitionUnit so the status change
 * and its StockMovement commit together (Invariant I-3, every unit state change
 * writes a movement). The movement type is ADJUSTMENT because a sync apply or a
 * supervisor resolution is an administrative correction. transitionUnit also
 * asserts the transition is legal, so an illegal target is rejected. Plain
 * fields (customer.*, unit engine/chassis) are a direct update; a unique
 * violation is rewrapped via isUniqueViolationOn as a SyncUniqueConflictError.
 */
export async function applyEntityField(
  tx: Prisma.TransactionClient,
  entityType: string,
  entityId: string,
  fieldPath: string,
  value: unknown,
  actorId: string,
): Promise<void> {
  if (entityType === 'unit' && fieldPath === 'status') {
    await transitionUnit(tx, entityId, value as UnitStatus, MovementType.ADJUSTMENT, {
      actorId,
      notes: 'Sync conflict resolution / field apply',
    });
    return;
  }

  try {
    if (entityType === 'customer') {
      await tx.customer.update({
        where: { id: entityId },
        data: { [fieldPath]: value } as Prisma.CustomerUncheckedUpdateInput,
      });
    } else if (entityType === 'unit') {
      await tx.unit.update({
        where: { id: entityId },
        data: { [fieldPath]: value } as Prisma.UnitUncheckedUpdateInput,
      });
    } else {
      throw new Error(`Unsupported entityType for field apply: ${entityType}`);
    }
  } catch (err) {
    const field = detectUniqueField(err);
    if (field) {
      throw new SyncUniqueConflictError(field, value);
    }
    throw err;
  }
}

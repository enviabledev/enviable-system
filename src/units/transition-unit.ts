import { NotFoundException } from '@nestjs/common';
import {
  MovementReferenceType,
  MovementType,
  Prisma,
  StockMovement,
  Unit,
  UnitStatus,
} from '@prisma/client';
import { assertUnitTransition } from './unit-state-machine';

export interface TransitionUnitOptions {
  // Required: the user responsible for the state change (movement actor).
  actorId: string;
  referenceType?: MovementReferenceType;
  referenceId?: string;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  notes?: string;
  // Extra unit fields to set alongside the status change (e.g. assembledAt,
  // assembledById, soldAt). status is set by this helper and cannot be
  // overridden through here.
  unitData?: Omit<Prisma.UnitUncheckedUpdateInput, 'status'>;
}

/**
 * THE single code path for unit state changes. Inside a caller-supplied
 * transaction it reads the current status, asserts the transition against the
 * complete state machine, updates the unit, and writes the corresponding
 * StockMovement (fromState old, toState new) in the same transaction. This is
 * how Invariant I-3 (every unit state change writes a movement, atomically) is
 * guaranteed and cannot be bypassed: nothing else should set Unit.status.
 *
 * Always call within prisma.$transaction so the unit update and the movement
 * commit together.
 */
export async function transitionUnit(
  tx: Prisma.TransactionClient,
  unitId: string,
  toStatus: UnitStatus,
  movementType: MovementType,
  options: TransitionUnitOptions,
): Promise<{ unit: Unit; movement: StockMovement }> {
  const current = await tx.unit.findUnique({ where: { id: unitId } });
  if (!current) {
    throw new NotFoundException(`Unit ${unitId} not found`);
  }
  const fromStatus = current.status;
  assertUnitTransition(fromStatus, toStatus);

  const unit = await tx.unit.update({
    where: { id: unitId },
    data: { ...(options.unitData ?? {}), status: toStatus },
  });

  const movement = await tx.stockMovement.create({
    data: {
      unitId,
      movementType,
      fromState: fromStatus,
      toState: toStatus,
      fromWarehouseId: options.fromWarehouseId ?? null,
      toWarehouseId: options.toWarehouseId ?? null,
      referenceType: options.referenceType ?? null,
      referenceId: options.referenceId ?? null,
      actorId: options.actorId,
      notes: options.notes ?? null,
    },
  });

  return { unit, movement };
}

import { MovementType, UnitStatus } from '@prisma/client';

const S = UnitStatus;
const M = MovementType;

/**
 * The explicit (from -> to) -> MovementType table for transitions performed via
 * the IT-admin adjustment endpoint. A transition that is legal per the unit
 * state machine but absent here is NOT an adjustment (it belongs to a workflow,
 * e.g. IN_WAREHOUSE_CKD -> IN_ASSEMBLY is assembly, *-> SOLD_* is sales,
 * SOLD_* -> RETURNED and RETURNED -> * are the returns flow). adjustmentMovementType
 * returns undefined for those, and the handler answers 400 directing to the
 * right endpoint. Every entry here must also be legal in UNIT_STATE_TRANSITIONS.
 */
const ADJUSTMENT_MOVEMENTS: Partial<
  Record<UnitStatus, Partial<Record<UnitStatus, MovementType>>>
> = {
  [S.IN_TRANSIT]: {
    [S.DAMAGED]: M.DAMAGE,
  },
  [S.IN_WAREHOUSE_CKD]: {
    [S.DAMAGED]: M.DAMAGE,
    [S.DEMO]: M.DEMO,
    [S.INTERNAL_USE]: M.INTERNAL_USE,
    [S.WRITTEN_OFF]: M.WRITE_OFF,
  },
  [S.IN_WAREHOUSE_CBU]: {
    [S.DAMAGED]: M.DAMAGE,
    [S.DEMO]: M.DEMO,
    [S.INTERNAL_USE]: M.INTERNAL_USE,
    [S.IN_REPAIR]: M.REPAIR_IN,
    [S.WRITTEN_OFF]: M.WRITE_OFF,
  },
  // SKD mirrors CBU's adjustment edges (a semi-knocked-down 3-wheeler diverts
  // exactly as a CBU unit does). Sale (SKD -> SOLD_AS_CBU) and the SKD -> CBU
  // upgrade (SKD -> IN_ASSEMBLY) are workflow paths, not adjustments, so they are
  // deliberately absent here, consistent with CBU -> SOLD and CKD -> IN_ASSEMBLY.
  [S.IN_WAREHOUSE_SKD]: {
    [S.DAMAGED]: M.DAMAGE,
    [S.DEMO]: M.DEMO,
    [S.INTERNAL_USE]: M.INTERNAL_USE,
    [S.IN_REPAIR]: M.REPAIR_IN,
    [S.WRITTEN_OFF]: M.WRITE_OFF,
  },
  [S.DAMAGED]: {
    [S.IN_REPAIR]: M.REPAIR_IN,
    [S.WRITTEN_OFF]: M.WRITE_OFF,
  },
  [S.IN_REPAIR]: {
    [S.IN_WAREHOUSE_CKD]: M.RESTOCK_FROM_REPAIR,
    [S.IN_WAREHOUSE_SKD]: M.RESTOCK_FROM_REPAIR,
    [S.IN_WAREHOUSE_CBU]: M.RESTOCK_FROM_REPAIR,
    [S.WRITTEN_OFF]: M.WRITE_OFF,
  },
  [S.DEMO]: {
    // Return-to-warehouse from demo is a RETURN-style movement.
    [S.IN_WAREHOUSE_CKD]: M.RETURN,
    [S.IN_WAREHOUSE_SKD]: M.RETURN,
    [S.IN_WAREHOUSE_CBU]: M.RETURN,
    [S.INTERNAL_USE]: M.INTERNAL_USE,
    [S.WRITTEN_OFF]: M.WRITE_OFF,
  },
  [S.INTERNAL_USE]: {
    [S.IN_WAREHOUSE_CKD]: M.RETURN,
    [S.IN_WAREHOUSE_SKD]: M.RETURN,
    [S.IN_WAREHOUSE_CBU]: M.RETURN,
    [S.WRITTEN_OFF]: M.WRITE_OFF,
  },
};

/**
 * MovementType for an adjustment transition, or undefined if (from -> to) is not
 * an IT-admin adjustment.
 */
export function adjustmentMovementType(
  from: UnitStatus,
  to: UnitStatus,
): MovementType | undefined {
  return ADJUSTMENT_MOVEMENTS[from]?.[to];
}

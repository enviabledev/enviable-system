import { ConflictException } from '@nestjs/common';
import { UnitStatus } from '@prisma/client';

const S = UnitStatus;

/**
 * The COMPLETE legal unit state transition map. Every one of the 13 states is a
 * key. This prompt (M3) only exposes the assembly edges as endpoints, but the
 * map is the full domain truth: M4 reuses it for sale (IN_WAREHOUSE_CKD ->
 * SOLD_AS_CKD, IN_WAREHOUSE_CBU -> SOLD_AS_CBU) and return (SOLD_* -> RETURNED,
 * Invariant I-15). Keep it complete; do not trim to the currently-exposed edges.
 *
 * CANCELLED has no analogue for units (units are never deleted; WRITTEN_OFF is
 * the terminal write-off state). TRANSFERRED is modelled for the deferred
 * multi-warehouse feature.
 */
export const UNIT_STATE_TRANSITIONS: Record<UnitStatus, UnitStatus[]> = {
  // En route from supplier. Receipt normally creates units directly in
  // IN_WAREHOUSE_CKD; this edge covers units ever created IN_TRANSIT.
  [S.IN_TRANSIT]: [S.IN_WAREHOUSE_CKD, S.DAMAGED],

  // A CKD kit in the warehouse: assemble, sell as a kit, or divert.
  [S.IN_WAREHOUSE_CKD]: [
    S.IN_ASSEMBLY,
    S.SOLD_AS_CKD,
    S.DAMAGED,
    S.DEMO,
    S.INTERNAL_USE,
    S.TRANSFERRED,
    S.WRITTEN_OFF,
  ],

  // Mid-assembly: complete to CBU, fail to DAMAGED, or cancel back to a kit.
  [S.IN_ASSEMBLY]: [S.IN_WAREHOUSE_CBU, S.DAMAGED, S.IN_WAREHOUSE_CKD],

  // An assembled unit in the warehouse: sell, divert, or send to repair.
  [S.IN_WAREHOUSE_CBU]: [
    S.SOLD_AS_CBU,
    S.DAMAGED,
    S.DEMO,
    S.INTERNAL_USE,
    S.TRANSFERRED,
    S.IN_REPAIR,
    S.WRITTEN_OFF,
  ],

  // Sold units can only come back via a return (I-15).
  [S.SOLD_AS_CKD]: [S.RETURNED],
  [S.SOLD_AS_CBU]: [S.RETURNED],

  // Damaged: repair it or write it off.
  [S.DAMAGED]: [S.IN_REPAIR, S.WRITTEN_OFF],

  // Under repair: restock as kit or assembled, or write off if unrepairable.
  [S.IN_REPAIR]: [S.IN_WAREHOUSE_CKD, S.IN_WAREHOUSE_CBU, S.WRITTEN_OFF],

  // Demo unit: return to stock, convert to internal use, or write off.
  [S.DEMO]: [
    S.IN_WAREHOUSE_CBU,
    S.IN_WAREHOUSE_CKD,
    S.INTERNAL_USE,
    S.WRITTEN_OFF,
  ],

  // Consumed internally: only a write-off remains.
  [S.INTERNAL_USE]: [S.WRITTEN_OFF],

  // Transferred to another warehouse: arrives as stock at the destination.
  [S.TRANSFERRED]: [S.IN_WAREHOUSE_CKD, S.IN_WAREHOUSE_CBU],

  // Returned by a customer: inspected then restocked, repaired, or written off.
  [S.RETURNED]: [
    S.IN_WAREHOUSE_CKD,
    S.IN_WAREHOUSE_CBU,
    S.DAMAGED,
    S.IN_REPAIR,
    S.WRITTEN_OFF,
  ],

  // Terminal.
  [S.WRITTEN_OFF]: [],
};

/** Throws 409 if the transition is not legal, naming the allowed next states. */
export function assertUnitTransition(
  from: UnitStatus,
  to: UnitStatus,
): void {
  const allowed = UNIT_STATE_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    const list =
      allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)';
    throw new ConflictException(
      `Illegal unit transition from ${from} to ${to}. Allowed next states: ${list}.`,
    );
  }
}

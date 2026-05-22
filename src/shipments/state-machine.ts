import { ConflictException } from '@nestjs/common';
import { ShipmentStatus } from '@prisma/client';

const T = ShipmentStatus;

/** Legal shipment transitions. Strictly linear; no skipping. */
export const SHIPMENT_STATE_TRANSITIONS: Record<
  ShipmentStatus,
  ShipmentStatus[]
> = {
  [T.IN_TRANSIT]: [T.AT_PORT],
  [T.AT_PORT]: [T.CLEARING],
  [T.CLEARING]: [T.CLEARED],
  [T.CLEARED]: [T.RECEIVED],
  [T.RECEIVED]: [T.CLOSED],
  [T.CLOSED]: [],
};

/**
 * Targets PATCH may set. Receipt (RECEIVED) and close (CLOSED) are deliberately
 * excluded: they belong to dedicated endpoints (receipt does serialisation in
 * the next prompt). PATCH only drives the clearing progression.
 */
export const PATCH_ALLOWED_TARGETS: ShipmentStatus[] = [
  T.AT_PORT,
  T.CLEARING,
  T.CLEARED,
];

/** Throws 409 if the transition is not legal, naming allowed next states. */
export function assertShipmentTransition(
  from: ShipmentStatus,
  to: ShipmentStatus,
): void {
  const allowed = SHIPMENT_STATE_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    const list =
      allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)';
    throw new ConflictException(
      `Illegal shipment transition from ${from} to ${to}. Allowed next states: ${list}.`,
    );
  }
}

/**
 * Caps PATCH status targets at the clearing progression. RECEIVED and CLOSED
 * are routed to their dedicated endpoints with a directing 409.
 */
export function assertReachableViaPatch(to: ShipmentStatus): void {
  if (to === T.RECEIVED) {
    throw new ConflictException(
      'Move a shipment to RECEIVED via the receipt endpoint (POST /shipments/:id/receive), not PATCH.',
    );
  }
  if (to === T.CLOSED) {
    throw new ConflictException(
      'Close a shipment via the close endpoint, not PATCH.',
    );
  }
  if (!PATCH_ALLOWED_TARGETS.includes(to)) {
    throw new ConflictException(
      `PATCH cannot set shipment status to ${to}. Allowed via PATCH: ${PATCH_ALLOWED_TARGETS.join(', ')}.`,
    );
  }
}

/** Blocks manifest replacement once the shipment is RECEIVED or CLOSED. */
export function assertManifestEditable(status: ShipmentStatus): void {
  if (status === T.RECEIVED || status === T.CLOSED) {
    throw new ConflictException(
      `Manifest lines cannot be edited once the shipment is ${status}.`,
    );
  }
}

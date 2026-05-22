import { ConflictException } from '@nestjs/common';
import { PurchaseOrderStatus } from '@prisma/client';

const S = PurchaseOrderStatus;

/**
 * Legal PO state transitions. Later milestones drive the post-approval states
 * (SENT_TO_SUPPLIER through CLOSED); this prompt exercises DRAFT and the
 * submit/approve edges. CANCELLED is reachable from every non-terminal state.
 */
export const PO_STATE_TRANSITIONS: Record<
  PurchaseOrderStatus,
  PurchaseOrderStatus[]
> = {
  [S.DRAFT]: [S.PENDING_APPROVAL, S.CANCELLED],
  [S.PENDING_APPROVAL]: [S.APPROVED, S.DRAFT, S.CANCELLED],
  [S.APPROVED]: [S.SENT_TO_SUPPLIER, S.CANCELLED],
  [S.SENT_TO_SUPPLIER]: [S.PI_RECEIVED, S.CANCELLED],
  [S.PI_RECEIVED]: [S.AWAITING_SHIPMENT, S.CANCELLED],
  [S.AWAITING_SHIPMENT]: [S.PARTIALLY_RECEIVED, S.FULLY_RECEIVED, S.CANCELLED],
  [S.PARTIALLY_RECEIVED]: [S.PARTIALLY_RECEIVED, S.FULLY_RECEIVED, S.CANCELLED],
  [S.FULLY_RECEIVED]: [S.CLOSED],
  [S.CLOSED]: [],
  [S.CANCELLED]: [],
};

/** Throws 409 if the transition is not in the legal map, naming allowed states. */
export function assertPoTransition(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): void {
  const allowed = PO_STATE_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    const list = allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)';
    throw new ConflictException(
      `Illegal purchase order transition from ${from} to ${to}. Allowed next states: ${list}.`,
    );
  }
}

/** Throws 409 unless the PO is editable (DRAFT only). */
export function assertPoEditable(status: PurchaseOrderStatus): void {
  if (status !== S.DRAFT) {
    throw new ConflictException(
      `Purchase order can only be edited while DRAFT (current status: ${status}).`,
    );
  }
}

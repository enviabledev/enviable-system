import { ConflictException } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';

const S = SalesOrderStatus;

/**
 * Complete 11-state sales order transition map. This prompt exposes only the
 * DRAFT to AWAITING_PAYMENT (submit) edge; later M4 prompts drive payment,
 * release, picking, dispatch, delivery, cancel, and refund.
 *
 * CANCELLED is listed from RELEASE_AUTHORISED and PICKING for a hypothetical
 * admin/override path. The user-facing cancel endpoint (later) does NOT use
 * those: it allowlist-checks {DRAFT, AWAITING_PAYMENT, PAYMENT_RECEIVED} before
 * reaching assertSoTransition, because reversing a released order (units sold,
 * physically committed) is the returns/refund flow, not cancellation. Keep that
 * layering: do not collapse the service-layer allowlist into this map.
 */
export const SO_STATE_TRANSITIONS: Record<
  SalesOrderStatus,
  SalesOrderStatus[]
> = {
  [S.DRAFT]: [S.AWAITING_PAYMENT, S.CANCELLED],
  [S.AWAITING_PAYMENT]: [S.PAYMENT_RECEIVED, S.CANCELLED],
  [S.PAYMENT_RECEIVED]: [S.RELEASE_AUTHORISED, S.CANCELLED],
  [S.RELEASE_AUTHORISED]: [S.PICKING, S.CANCELLED],
  [S.PICKING]: [S.READY_FOR_DISPATCH, S.CANCELLED],
  [S.READY_FOR_DISPATCH]: [S.DISPATCHED],
  [S.DISPATCHED]: [S.DELIVERED],
  [S.DELIVERED]: [S.CLOSED, S.REFUNDED],
  [S.CLOSED]: [S.REFUNDED],
  [S.CANCELLED]: [],
  [S.REFUNDED]: [],
};

export function assertSoTransition(
  from: SalesOrderStatus,
  to: SalesOrderStatus,
): void {
  const allowed = SO_STATE_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    const list =
      allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)';
    throw new ConflictException(
      `Illegal sales order transition from ${from} to ${to}. Allowed next states: ${list}.`,
    );
  }
}

/** A sales order is editable only while DRAFT. */
export function assertSoEditable(status: SalesOrderStatus): void {
  if (status !== S.DRAFT) {
    throw new ConflictException(
      `Sales order can only be edited while DRAFT (current status: ${status}).`,
    );
  }
}

import { Prisma } from '@prisma/client';

/**
 * Advisory-lock key for PO-number allocation. Distinct from every other
 * generator (shipmentReference uses 49002). First use of this pattern in the
 * codebase; it recurs for other human-facing identifiers.
 */
export const PO_NUMBER_LOCK_KEY = 49001;

/**
 * Allocate the next poNumber as PO-YYYY-NNNN (zero-padded to 4). Must run inside
 * a transaction: pg_advisory_xact_lock serialises concurrent allocators and is
 * released on commit/rollback. We parse the numeric suffix of the current-year
 * MAX rather than counting rows, so deletes or gaps never cause a collision.
 *
 * Raw-SQL column names are quoted camelCase ("poNumber"): @@map renames the
 * table, not the columns.
 *
 * CONCURRENCY: correct by construction via the advisory lock. A focused
 * contention test is deferred to M5 (CLAUDE.md hardening backlog: "ID
 * generators under concurrency"); that test attaches here.
 */
export async function generatePoNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PO_NUMBER_LOCK_KEY})`;

  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;

  const rows = await tx.$queryRaw<{ max: string | null }[]>`
    SELECT MAX("poNumber") AS max
    FROM purchase_orders
    WHERE "poNumber" LIKE ${prefix + '%'}
  `;

  const currentMax = rows[0]?.max ?? null;
  const lastSeq = currentMax
    ? parseInt(currentMax.slice(prefix.length), 10)
    : 0;
  const next = lastSeq + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

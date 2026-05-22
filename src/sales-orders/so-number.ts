import { Prisma } from '@prisma/client';

/** Advisory-lock key for SO-number allocation. Distinct: PO 49001, shipment 49002. */
export const SO_NUMBER_LOCK_KEY = 49004;

/**
 * Allocate the next soNumber as SO-YYYY-NNNN (zero-padded to 4). Must run inside
 * a transaction: pg_advisory_xact_lock serialises concurrent allocators and
 * releases on commit/rollback. Parses the numeric suffix of the current-year
 * MAX (no naive count). camelCase raw-SQL columns. M5 contention test attaches
 * here as for the other generators.
 */
export async function generateSoNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SO_NUMBER_LOCK_KEY})`;

  const year = new Date().getFullYear();
  const prefix = `SO-${year}-`;

  const rows = await tx.$queryRaw<{ max: string | null }[]>`
    SELECT MAX("soNumber") AS max
    FROM sales_orders
    WHERE "soNumber" LIKE ${prefix + '%'}
  `;

  const currentMax = rows[0]?.max ?? null;
  const lastSeq = currentMax
    ? parseInt(currentMax.slice(prefix.length), 10)
    : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

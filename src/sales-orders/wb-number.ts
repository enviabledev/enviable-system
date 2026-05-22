import { Prisma } from '@prisma/client';

/** Advisory-lock key for waybill numbering. Distinct across generators. */
export const WB_NUMBER_LOCK_KEY = 49007;

/**
 * Allocate the next wbNumber as WB-YYYY-NNNN. Must run inside a transaction:
 * pg_advisory_xact_lock serialises concurrent allocators. Parses the numeric
 * suffix of the current-year MAX (no naive count). camelCase raw-SQL columns.
 */
export async function generateWbNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WB_NUMBER_LOCK_KEY})`;
  const year = new Date().getFullYear();
  const prefix = `WB-${year}-`;
  const rows = await tx.$queryRaw<{ max: string | null }[]>`
    SELECT MAX("wbNumber") AS max FROM waybills WHERE "wbNumber" LIKE ${prefix + '%'}
  `;
  const lastSeq = rows[0]?.max
    ? parseInt(rows[0].max.slice(prefix.length), 10)
    : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

import { Prisma } from '@prisma/client';

/** Advisory-lock key for delivery-note numbering. Distinct across generators. */
export const DN_NUMBER_LOCK_KEY = 49006;

/**
 * Allocate the next dnNumber as DN-YYYY-NNNN. Must run inside a transaction:
 * pg_advisory_xact_lock serialises concurrent allocators. Parses the numeric
 * suffix of the current-year MAX (no naive count). camelCase raw-SQL columns.
 */
export async function generateDnNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DN_NUMBER_LOCK_KEY})`;
  const year = new Date().getFullYear();
  const prefix = `DN-${year}-`;
  const rows = await tx.$queryRaw<{ max: string | null }[]>`
    SELECT MAX("dnNumber") AS max FROM delivery_notes WHERE "dnNumber" LIKE ${prefix + '%'}
  `;
  const lastSeq = rows[0]?.max
    ? parseInt(rows[0].max.slice(prefix.length), 10)
    : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

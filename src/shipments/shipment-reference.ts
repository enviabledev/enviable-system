import { Prisma } from '@prisma/client';

/**
 * Advisory-lock key for shipmentReference allocation. Distinct from the PO
 * generator (49001). Second use of the advisory-lock ID pattern.
 */
export const SHIPMENT_REFERENCE_LOCK_KEY = 49002;

/**
 * Allocate the next shipmentReference as SH-YYYY-NNNN (zero-padded to 4). Must
 * run inside a transaction: pg_advisory_xact_lock serialises concurrent
 * allocators and releases on commit/rollback. We parse the numeric suffix of
 * the current-year MAX rather than counting rows. Columns are quoted camelCase.
 *
 * CONCURRENCY: correct by construction; the M5 contention test (CLAUDE.md
 * hardening backlog) attaches here, the same as the PO generator.
 */
export async function generateShipmentReference(
  tx: Prisma.TransactionClient,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SHIPMENT_REFERENCE_LOCK_KEY})`;

  const year = new Date().getFullYear();
  const prefix = `SH-${year}-`;

  const rows = await tx.$queryRaw<{ max: string | null }[]>`
    SELECT MAX("shipmentReference") AS max
    FROM shipments
    WHERE "shipmentReference" LIKE ${prefix + '%'}
  `;

  const currentMax = rows[0]?.max ?? null;
  const lastSeq = currentMax
    ? parseInt(currentMax.slice(prefix.length), 10)
    : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

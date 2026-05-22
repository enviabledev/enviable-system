import { Prisma } from '@prisma/client';

/** Advisory-lock key for invoice numbering. Distinct: PO 49001, shipment 49002, SO 49004. */
export const INVOICE_NUMBER_LOCK_KEY = 49005;

/**
 * Allocate the next invoiceNumber as INV-YYYY-NNNN (zero-padded to 4). Must run
 * inside a transaction: pg_advisory_xact_lock serialises concurrent allocators
 * and releases on commit/rollback. Parses the numeric suffix of the current-year
 * MAX (no naive count). camelCase raw-SQL columns.
 */
export async function generateInvoiceNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INVOICE_NUMBER_LOCK_KEY})`;

  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;

  const rows = await tx.$queryRaw<{ max: string | null }[]>`
    SELECT MAX("invoiceNumber") AS max
    FROM invoices
    WHERE "invoiceNumber" LIKE ${prefix + '%'}
  `;

  const currentMax = rows[0]?.max ?? null;
  const lastSeq = currentMax
    ? parseInt(currentMax.slice(prefix.length), 10)
    : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

import { Prisma } from '@prisma/client';

/**
 * Advisory-lock key for sales-PI-number allocation. Distinct from every other
 * generator: PO 49001, shipment 49002, SO 49004, invoice 49005, delivery note
 * 49006, waybill 49007.
 */
export const SALES_PI_NUMBER_LOCK_KEY = 49008;

/**
 * Allocate the next sales-side PI number as PI-YYYY-NNNN (zero-padded to 4).
 * Must run inside a transaction: pg_advisory_xact_lock serialises concurrent
 * allocators and releases on commit/rollback. Parses the numeric suffix of the
 * current-year MAX (no naive row count), so deletes or gaps never cause a
 * collision. NNNN resets at the year boundary, matching the PO/SH/SO/invoice
 * convention (the LIKE filter is scoped to the current-year prefix).
 *
 * Scoped to the sales_proforma_invoices table, so it is independent of the
 * procurement-side ProformaInvoice.piNumber (supplier-supplied free text in a
 * different table). camelCase raw-SQL columns: @@map renames the table only.
 */
export async function generateSalesPiNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SALES_PI_NUMBER_LOCK_KEY})`;

  const year = new Date().getFullYear();
  const prefix = `PI-${year}-`;

  const rows = await tx.$queryRaw<{ max: string | null }[]>`
    SELECT MAX("piNumber") AS max
    FROM sales_proforma_invoices
    WHERE "piNumber" LIKE ${prefix + '%'}
  `;

  const currentMax = rows[0]?.max ?? null;
  const lastSeq = currentMax
    ? parseInt(currentMax.slice(prefix.length), 10)
    : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

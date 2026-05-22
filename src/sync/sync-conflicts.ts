import { isUniqueViolationOn } from '../common/prisma-errors';

/**
 * Thrown by the sync layer when a wrapped write hits a unique constraint. Carries
 * the offending field and attempted value so the batch can report a structured
 * conflict rather than a 500. The detection runs through the canonical
 * isUniqueViolationOn helper (the M4 lesson: the rewrap path must be exercised by
 * a real violation, not just compiled).
 */
export class SyncUniqueConflictError extends Error {
  constructor(
    readonly field: string,
    readonly value: unknown,
  ) {
    super(`Unique constraint violated on ${field}`);
    this.name = 'SyncUniqueConflictError';
  }
}

// Unique constraints reachable through sync writes. Matched primarily on the
// field-name array (the shape Prisma 6 reports), with the index name as a
// fallback. Add an entry here when a new sync-reachable unique field appears.
const KNOWN_UNIQUE: { index: string; fields: string[]; label: string }[] = [
  { index: 'units_engineNumber_key', fields: ['engineNumber'], label: 'engineNumber' },
  { index: 'units_chassisNumber_key', fields: ['chassisNumber'], label: 'chassisNumber' },
  { index: 'customers_email_key', fields: ['email'], label: 'email' },
  { index: 'sales_orders_soNumber_key', fields: ['soNumber'], label: 'soNumber' },
  { index: 'one_active_so_line_per_unit', fields: ['unitId'], label: 'unitId' },
];

/**
 * If err is a P2002 on a known sync-reachable unique field, return that field's
 * label, else null. Uses isUniqueViolationOn for each candidate.
 */
export function detectUniqueField(err: unknown): string | null {
  for (const c of KNOWN_UNIQUE) {
    if (isUniqueViolationOn(err, { index: c.index, fields: c.fields })) {
      return c.label;
    }
  }
  return null;
}

import { Prisma } from '@prisma/client';

/**
 * Detect a P2002 unique-constraint violation for a specific index. Prisma 6
 * reports the offender in different shapes depending on the index, so we check
 * all of them:
 *   - meta.target as the field-name array, e.g. ["unitId"] (the common Prisma 6
 *     shape, including for raw partial unique indexes): matches when every one
 *     of the index's fields is present;
 *   - meta.target as the index name (string or array containing it);
 *   - meta.constraint as the index name.
 *
 * Pass both the index name and its column field name(s) so the detector is
 * correct regardless of which shape this Prisma version emits.
 */
export function isUniqueViolationOn(
  err: unknown,
  opts: { index: string; fields: string[] },
): boolean {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== 'P2002'
  ) {
    return false;
  }
  const meta = (err.meta ?? {}) as { target?: unknown; constraint?: unknown };
  const { target, constraint } = meta;

  if (typeof target === 'string' && target.includes(opts.index)) return true;
  if (Array.isArray(target) && target.includes(opts.index)) return true;
  if (typeof constraint === 'string' && constraint.includes(opts.index))
    return true;

  // Field-name array shape: every indexed field must be present.
  if (
    Array.isArray(target) &&
    opts.fields.length > 0 &&
    opts.fields.every((f) => (target as unknown[]).includes(f))
  ) {
    return true;
  }
  return false;
}

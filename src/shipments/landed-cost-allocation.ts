/**
 * EQUAL_PER_UNIT allocation in integer cents. Splits totalCents across
 * unitCount units; the indivisible remainder pennies go to the first
 * `remainder` units (callers pass units pre-sorted by engineNumber for
 * determinism). The returned cents sum exactly to totalCents, so no penny is
 * lost or invented.
 */
export function allocateEqualPerUnitCents(
  totalCents: number,
  unitCount: number,
): number[] {
  if (unitCount <= 0) {
    return [];
  }
  const base = Math.floor(totalCents / unitCount);
  const remainder = totalCents - base * unitCount;
  return Array.from({ length: unitCount }, (_, i) =>
    i < remainder ? base + 1 : base,
  );
}

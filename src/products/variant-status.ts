import { ConflictException } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';

/**
 * The noun a consuming flow is trying to create. Keeps the discontinued-variant
 * message consistent across flows (only the noun changes).
 */
export type VariantUsageNoun =
  | 'units'
  | 'sales orders'
  | 'price entries'
  | 'purchase order lines';

/** The single source of truth for the discontinued-variant message. */
export function discontinuedVariantMessage(
  skus: string[],
  noun: VariantUsageNoun,
): string {
  const list = skus.join(', ');
  const subject = skus.length > 1 ? 'Variants' : 'Variant';
  const verb = skus.length > 1 ? 'are' : 'is';
  return (
    `${subject} ${list} ${verb} discontinued and cannot be used for new ${noun}. ` +
    `Existing references to this variant continue to function. ` +
    `To re-enable, reactivate the variant via product management.`
  );
}

/**
 * Gate a creation flow on variant status: every referenced variant that exists
 * must be ACTIVE. DISCONTINUED is the deactivated state, so a new unit, sales
 * order or price entry against it is rejected (409). Existence is each flow's
 * own concern (a missing variant is its 404/400, preserved); this only checks
 * the status of variants that DO exist, so it never changes existence handling.
 *
 * The client is typed as a transaction client so it works with both
 * `this.prisma` and a `$transaction` tx, letting the check sit inside the same
 * transactional boundary as the persistence it guards.
 */
export async function assertVariantsActive(
  client: Prisma.TransactionClient,
  variantIds: string[],
  noun: VariantUsageNoun,
): Promise<void> {
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (ids.length === 0) return;
  const variants = await client.productVariant.findMany({
    where: { id: { in: ids } },
    select: { supplierSkuCode: true, status: true },
  });
  const discontinued = variants
    .filter((v) => v.status === ProductStatus.DISCONTINUED)
    .map((v) => v.supplierSkuCode);
  if (discontinued.length > 0) {
    throw new ConflictException(discontinuedVariantMessage(discontinued, noun));
  }
}

import { ConflictException } from '@nestjs/common';
import { Prisma, ProductStatus, ProductType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';

/**
 * Variant auto-create at supply-side entry points.
 *
 * The system used to treat ProductVariant as pre-defined reference data that
 * had to exist before any transaction could reference it. Operational reality
 * is the opposite: variants enter the catalogue THROUGH procurement activity,
 * so pre-seeding meant guessing the supplier's SKUs, and the guess-vs-reality
 * gap is what broke real uploads. The supply side (historical-load, PO line)
 * now auto-creates a variant the first time an unknown supplier SKU appears;
 * the next reference to that SKU finds the existing variant. The catalogue
 * emerges from operations instead of gating them.
 *
 * The SALES side (sales-order lines, assembly, pricing) is deliberately NOT
 * wired here: sales transacts against what supply already brought in, so an
 * unknown SKU there is an error, not a discovery.
 *
 * Permission model: auto-create inherits the calling operation's permission.
 * A user who may run historical-load or create a PO line may, as a downstream
 * consequence, introduce a variant. There is NO separate variant-create
 * permission gate; requiring one would stop a Procurement Officer from
 * recording supply for a SKU the catalogue has not seen yet, which defeats the
 * purpose.
 */

/**
 * Sentinel product that owns every auto-created variant until an admin
 * reclassifies it. Seeded as `seed-product-pending-classification` ("Pending
 * Classification") in prisma/seed.ts. ProductVariant.productId is NON-null in
 * the schema, so an auto-created variant (which carries no product context from
 * a CSV row or PO line) attaches here rather than to a real product. Likewise
 * currentMarketPrice is NON-null, so it is seeded to 0 as the "not yet priced"
 * sentinel: selling is PriceListEntry-driven and never reads currentMarketPrice,
 * so a 0 here cannot leak into any sale price.
 */
export const SENTINEL_PRODUCT_ID = 'seed-product-pending-classification';

/** The supply-side flow that triggered an auto-create. Recorded in the audit. */
export type AutoCreateSource =
  | 'historical-load'
  | 'po-line-create'
  | 'shipment-receive';

/** A single best similarity match against an existing ACTIVE variant. */
export interface SimilarVariantMatch {
  id: string;
  supplierSkuCode: string;
  /** Levenshtein edit distance between the incoming SKU and this match. */
  distance: number;
  /** Why this counted as similar. */
  reason: 'edit-distance' | 'shared-prefix';
}

/** A candidate to compare an incoming SKU against (existing ACTIVE variants). */
export interface VariantCandidate {
  id: string;
  supplierSkuCode: string;
}

/**
 * 409 thrown when a single-item caller (PO line) hits a similar existing
 * variant and did not opt into overriding. The structured body lets the caller
 * (frontend) offer "use existing variant X" vs "create new anyway". Carries a
 * machine-readable `kind` so it is distinguishable from generic validation
 * conflicts and from the discontinued-variant conflict.
 */
export class SimilarVariantError extends ConflictException {
  constructor(incomingSku: string, match: SimilarVariantMatch) {
    super({
      statusCode: 409,
      error: 'Conflict',
      kind: 'similar-variant',
      message:
        `SKU "${incomingSku}" is similar to existing variant ` +
        `"${match.supplierSkuCode}" (id: ${match.id}). Use the existing ` +
        `variant, or resubmit with overrideSimilarityCheck to create a new one.`,
      incomingSku,
      match,
    });
  }
}

const SHARED_PREFIX_MIN = 15;

/** Classic Levenshtein edit distance (insert/delete/substitute = 1). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Single-row rolling buffer: O(min) space.
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function sharedPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/**
 * The edit-distance threshold under which two SKUs count as suspiciously close.
 * Longer SKUs tolerate more drift (a 35-char supplier code can differ by a few
 * characters and still be the same kit typed twice); short codes must be near
 * exact. Comparison is case-sensitive on purpose: SKUs are preserved verbatim,
 * so a case-only difference is itself a likely duplicate and should be flagged.
 */
function distanceThreshold(skuLength: number): number {
  if (skuLength > 20) return 3;
  if (skuLength > 10) return 2;
  return 1;
}

/**
 * Find the single best existing ACTIVE variant that the incoming SKU is
 * suspiciously close to, or null. Pure: no DB, no side effects, so both the
 * throw-style orchestrator and the collect-style bulk caller (historical-load)
 * share one definition of "similar". Exact matches are the caller's concern and
 * are excluded here (distance 0 is skipped). DISCONTINUED variants are NOT
 * candidates: re-introducing a previously retired SKU is a legitimate new
 * variant, not a typo collision.
 */
export function findSimilarVariant(
  sku: string,
  candidates: VariantCandidate[],
): SimilarVariantMatch | null {
  const threshold = distanceThreshold(sku.length);
  let best: SimilarVariantMatch | null = null;
  for (const c of candidates) {
    if (c.supplierSkuCode === sku) continue; // exact match is not "similar"
    const distance = levenshtein(sku, c.supplierSkuCode);
    const prefix = sharedPrefixLength(sku, c.supplierSkuCode);
    const byDistance = distance <= threshold;
    const byPrefix = prefix >= SHARED_PREFIX_MIN;
    if (!byDistance && !byPrefix) continue;
    const reason: SimilarVariantMatch['reason'] = byDistance
      ? 'edit-distance'
      : 'shared-prefix';
    if (best === null || distance < best.distance) {
      best = { id: c.id, supplierSkuCode: c.supplierSkuCode, distance, reason };
    }
  }
  return best;
}

/** JSON-safe snapshot of a row (Decimal -> string, Date -> ISO) for the audit. */
function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Create the variant on the sentinel product and write its auto-create audit
 * row inside the SAME transaction, so the variant and its audit trail commit or
 * roll back together with the source operation. Callers must have already
 * resolved that no exact match exists and that similarity is cleared or
 * overridden. `similarityChecked` records whether the similarity gate ran
 * (false when the caller passed overrideSimilarityCheck).
 */
export async function createAutoVariant(args: {
  tx: Prisma.TransactionClient;
  audit: AuditService;
  sku: string;
  source: AutoCreateSource;
  sourceEntityId: string | null;
  actorUserId: string | null;
  similarityChecked: boolean;
}) {
  const { tx, audit, sku, source, sourceEntityId, actorUserId } = args;
  const variant = await tx.productVariant.create({
    data: {
      productId: SENTINEL_PRODUCT_ID,
      supplierSkuCode: sku,
      // productType defaults to THREE_WHEELER: every supply-side entry point that
      // auto-creates (historical-load, PO line, shipment receive) deals in TVS
      // King tricycles today, and the supply flows are deliberately non-blocking
      // (a CSV row or PO line carries no wheeler-type field to require). An admin
      // reclassifies the type via PATCH /product-variants/:id alongside lifting
      // the variant off the "Pending Classification" sentinel product.
      productType: ProductType.THREE_WHEELER,
      variantAttributes: {},
      currentMarketPrice: new Prisma.Decimal(0),
      status: ProductStatus.ACTIVE,
    },
  });
  await audit.write(
    {
      actorUserId,
      action: 'productvariant.autocreate',
      entityType: 'ProductVariant',
      entityId: variant.id,
      afterState: toInputJson(variant),
      context: {
        triggeredBy: actorUserId,
        source,
        sourceEntityId,
        sku,
        similarityChecked: args.similarityChecked,
      },
    },
    tx,
  );
  return variant;
}

/**
 * Resolve a single supplier SKU to a variant, auto-creating it if unknown.
 * Throw-style, for single-item callers (PO line):
 *   - exact match exists  -> return it ({ created: false })
 *   - similar match exists and not overridden -> throw SimilarVariantError
 *   - otherwise            -> create on the sentinel product ({ created: true })
 *
 * Bulk callers that must collect findings across many rows (historical-load)
 * use findSimilarVariant + createAutoVariant directly instead of this.
 */
export async function resolveOrCreateVariant(args: {
  tx: Prisma.TransactionClient;
  audit: AuditService;
  sku: string;
  source: AutoCreateSource;
  sourceEntityId: string | null;
  actorUserId: string | null;
  overrideSimilarityCheck?: boolean;
}): Promise<{
  variant: { id: string; supplierSkuCode: string; status: ProductStatus };
  created: boolean;
}> {
  const { tx, sku, overrideSimilarityCheck } = args;
  const existing = await tx.productVariant.findFirst({
    where: { supplierSkuCode: sku },
    select: { id: true, supplierSkuCode: true, status: true },
  });
  if (existing) {
    return { variant: existing, created: false };
  }
  if (!overrideSimilarityCheck) {
    const candidates = await tx.productVariant.findMany({
      where: { status: ProductStatus.ACTIVE },
      select: { id: true, supplierSkuCode: true },
    });
    const match = findSimilarVariant(sku, candidates);
    if (match) {
      throw new SimilarVariantError(sku, match);
    }
  }
  const variant = await createAutoVariant({
    tx,
    audit: args.audit,
    sku,
    source: args.source,
    sourceEntityId: args.sourceEntityId,
    actorUserId: args.actorUserId,
    similarityChecked: !overrideSimilarityCheck,
  });
  return {
    variant: {
      id: variant.id,
      supplierSkuCode: variant.supplierSkuCode,
      status: variant.status,
    },
    created: true,
  };
}

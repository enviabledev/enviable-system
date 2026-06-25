import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma, UnitStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Bucket = 'ckd' | 'inAssembly' | 'skd' | 'cbu' | 'sold' | 'other';

// Every UnitStatus maps to exactly one of the five lifecycle buckets. Typing
// this as Record<UnitStatus, Bucket> forces ALL enum values to be present:
// adding a new UnitStatus without giving it a bucket is a compile error, so no
// unit can ever go uncounted. The "Other" bucket deliberately absorbs every
// status that is neither warehouse stock, in-assembly, nor sold.
const STATUS_BUCKET: Record<UnitStatus, Bucket> = {
  [UnitStatus.IN_WAREHOUSE_CKD]: 'ckd',
  [UnitStatus.IN_ASSEMBLY]: 'inAssembly',
  [UnitStatus.IN_WAREHOUSE_SKD]: 'skd',
  [UnitStatus.IN_WAREHOUSE_CBU]: 'cbu',
  [UnitStatus.SOLD_AS_CKD]: 'sold',
  [UnitStatus.SOLD_AS_CBU]: 'sold',
  [UnitStatus.IN_TRANSIT]: 'other',
  [UnitStatus.DAMAGED]: 'other',
  [UnitStatus.IN_REPAIR]: 'other',
  [UnitStatus.DEMO]: 'other',
  [UnitStatus.INTERNAL_USE]: 'other',
  [UnitStatus.TRANSFERRED]: 'other',
  [UnitStatus.RETURNED]: 'other',
  [UnitStatus.CLAIMED_TO_SUPPLIER]: 'other',
  [UnitStatus.WRITTEN_OFF]: 'other',
};

// Buckets that count as on-hand inventory for market valuation. Sold units are
// realised (no longer stock); the Other bucket (damaged, written-off, in-transit,
// demo, in-repair, internal-use, returned, transferred) is not valued as
// sellable on-hand stock. Market value = currentMarketPrice times the count of
// CKD + InAssembly + SKD + CBU units. SKD and CBU are reported as distinct
// buckets but both are sellable on-hand stock. This is a deliberate definition
// of "in-stock value"; the per-variant rows expose inStockCount so the figure is
// auditable.
const IN_STOCK_BUCKETS: Bucket[] = ['ckd', 'inAssembly', 'skd', 'cbu'];

function emptyCounts(): Record<Bucket, number> {
  return { ckd: 0, inAssembly: 0, skd: 0, cbu: 0, sold: 0, other: 0 };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * As-of stocks snapshot. Returns KPIs (total units, total variants, total
   * on-hand market value), a per-variant five-bucket lifecycle breakdown with
   * market price and on-hand market value, and a spare-parts section valued at
   * landed cost. Read-only, not audited.
   *
   * The spare-parts landed-cost valuation is cost data (Invariant I-8): it is
   * computed and returned ONLY when the caller holds costdata.view. A caller
   * without it sees the spare parts and their quantities but no cost figure. The
   * per-variant currentMarketPrice is selling-side, not cost, and is visible to
   * all (the CostVisibilityInterceptor does not strip it).
   */
  async stocksReport(warehouseId: string | undefined, canViewCost: boolean) {
    const unitWhere: Prisma.UnitWhereInput = warehouseId
      ? { currentWarehouseId: warehouseId }
      : {};

    const grouped = await this.prisma.unit.groupBy({
      by: ['productVariantId', 'status'],
      where: unitWhere,
      _count: { _all: true },
    });

    const variantIds = [...new Set(grouped.map((g) => g.productVariantId))];
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        supplierSkuCode: true,
        variantAttributes: true,
        currentMarketPrice: true,
      },
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));

    // Accumulate counts per variant per bucket.
    const countsByVariant = new Map<string, Record<Bucket, number>>();
    for (const row of grouped) {
      const counts =
        countsByVariant.get(row.productVariantId) ?? emptyCounts();
      counts[STATUS_BUCKET[row.status]] += row._count._all;
      countsByVariant.set(row.productVariantId, counts);
    }

    let totalMarketValue = new Prisma.Decimal(0);
    let bucketGrandTotal = 0;

    const variantRows = variantIds
      .map((id) => {
        const variant = variantById.get(id);
        if (!variant) {
          // groupBy returned a variant the variant table does not have: a FK
          // would prevent this, so it is a genuine internal inconsistency.
          throw new InternalServerErrorException(
            `Stocks report: unit references unknown variant ${id}`,
          );
        }
        const counts = countsByVariant.get(id) ?? emptyCounts();
        const total =
          counts.ckd +
          counts.inAssembly +
          counts.skd +
          counts.cbu +
          counts.sold +
          counts.other;
        const inStockCount = IN_STOCK_BUCKETS.reduce(
          (acc, b) => acc + counts[b],
          0,
        );
        const marketValue = variant.currentMarketPrice.mul(inStockCount);

        totalMarketValue = totalMarketValue.add(marketValue);
        bucketGrandTotal += total;

        return {
          productVariantId: variant.id,
          sku: variant.supplierSkuCode,
          attributes: variant.variantAttributes,
          currentMarketPrice: variant.currentMarketPrice,
          counts: { ...counts, total },
          inStockCount,
          marketValue,
        };
      })
      .sort((a, b) => a.sku.localeCompare(b.sku));

    // Partition assertion: the sum of all bucket counts must equal an
    // independent count of the units in scope. If they differ, a unit was
    // double-counted or dropped, which would silently corrupt the report.
    const totalUnits = await this.prisma.unit.count({ where: unitWhere });
    if (bucketGrandTotal !== totalUnits) {
      throw new InternalServerErrorException(
        `Stocks report partition mismatch: buckets summed to ${bucketGrandTotal} but ${totalUnits} units are in scope.`,
      );
    }

    return {
      asOf: new Date(),
      warehouseId: warehouseId ?? null,
      kpis: {
        totalUnits,
        totalVariants: variantIds.length,
        totalMarketValue,
      },
      variants: variantRows,
      spareParts: await this.spareParts(canViewCost),
    };
  }

  private async spareParts(canViewCost: boolean) {
    const parts = await this.prisma.sparePart.findMany({
      orderBy: { sku: 'asc' },
      select: {
        id: true,
        sku: true,
        name: true,
        quantityOnHand: true,
        landedCostPerUnit: true,
      },
    });

    if (!canViewCost) {
      // Omit all cost figures server-side. The caller sees parts and quantities
      // but no landed-cost valuation (Invariant I-8).
      return {
        items: parts.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          quantityOnHand: p.quantityOnHand,
        })),
      };
    }

    let totalLandedCostValue = new Prisma.Decimal(0);
    const items = parts.map((p) => {
      const perUnit = p.landedCostPerUnit ?? new Prisma.Decimal(0);
      const landedCostValue = perUnit.mul(p.quantityOnHand);
      totalLandedCostValue = totalLandedCostValue.add(landedCostValue);
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        quantityOnHand: p.quantityOnHand,
        landedCostPerUnit: p.landedCostPerUnit,
        landedCostValue,
      };
    });

    return { items, totalLandedCostValue };
  }
}

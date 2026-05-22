import { Injectable } from '@nestjs/common';
import { Prisma, SaleForm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const D = (n: Prisma.Decimal.Value = 0) => new Prisma.Decimal(n);

/**
 * Resolve the recognition-date range. Default is the current calendar month:
 * from the first instant of this month (inclusive) to the first instant of next
 * month (exclusive). Explicit from/to override either end. The range is always
 * applied as issuedAt >= from AND issuedAt < to.
 */
function resolveRange(fromInput?: string, toInput?: string) {
  const now = new Date();
  const from = fromInput
    ? new Date(fromInput)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = toInput
    ? new Date(toInput)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
}

@Injectable()
export class RevenueReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Revenue and sales report over a recognition-date range.
   *
   * REVENUE RECOGNITION BASIS: order-released-in-range. An order's revenue is
   * recognised at the moment its units were released to the customer, i.e. its
   * ReleaseAuthorisation.issuedAt. Release is the point where goods irrevocably
   * leave inventory (units transition to SOLD) and the sale is authorised, so it
   * is the honest recognition event. Any order that ever reached
   * RELEASE_AUTHORISED has exactly one ReleaseAuthorisation row, so filtering on
   * its issuedAt selects precisely the orders released in the window, regardless
   * of their current fulfilment status (PICKING through CLOSED, and REFUNDED).
   * Orders never released (DRAFT, AWAITING_PAYMENT, PAYMENT_RECEIVED, CANCELLED)
   * have no ReleaseAuthorisation and are excluded. Refunds are NOT netted out of
   * recognised revenue here (refund processing is out of MVP scope); a refunded
   * order remains in the figure because it was genuinely released.
   *
   * Money note: total revenue and revenue-by-customer use the VAT-inclusive
   * order total. Revenue-by-variant and the margin figures use line revenue
   * (lineTotal: net of discount, EXCLUSIVE of VAT), since VAT is collected for
   * the tax authority and is not margin-bearing revenue.
   *
   * Margin is cost-derived (Invariant I-8): it is computed and returned ONLY
   * when canViewCost is true, and is omitted entirely otherwise (absent fields,
   * not nulls; not computed at all).
   */
  async revenueReport(
    fromInput: string | undefined,
    toInput: string | undefined,
    topN: number,
    canViewCost: boolean,
  ) {
    const { from, to } = resolveRange(fromInput, toInput);

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        deletedAt: null,
        releaseAuthorisation: { issuedAt: { gte: from, lt: to } },
      },
      select: {
        id: true,
        total: true,
        vatAmount: true,
        customerId: true,
        customer: { select: { id: true, name: true } },
        releaseAuthorisation: { select: { issuedAt: true } },
        lines: {
          select: {
            productVariantId: true,
            saleForm: true,
            lineTotal: true,
            productVariant: { select: { supplierSkuCode: true } },
            unit: { select: { landedCost: true } },
          },
        },
      },
    });

    let totalRevenue = D();
    let vatCollected = D();
    let netRevenue = D();
    let totalLandedCost = D();
    let unitsSold = 0;
    let ckd = 0;
    let cbu = 0;

    const byVariant = new Map<
      string,
      { sku: string; units: number; revenue: Prisma.Decimal; landedCost: Prisma.Decimal }
    >();
    const byCustomer = new Map<
      string,
      { name: string; revenue: Prisma.Decimal; orders: number }
    >();
    const byDay = new Map<
      string,
      { revenue: Prisma.Decimal; unitsSold: number }
    >();

    for (const o of orders) {
      totalRevenue = totalRevenue.add(o.total);
      vatCollected = vatCollected.add(o.vatAmount);

      const day = o.releaseAuthorisation!.issuedAt.toISOString().slice(0, 10);
      const dayB = byDay.get(day) ?? { revenue: D(), unitsSold: 0 };
      dayB.revenue = dayB.revenue.add(o.total);

      const cust = byCustomer.get(o.customerId) ?? {
        name: o.customer.name,
        revenue: D(),
        orders: 0,
      };
      cust.revenue = cust.revenue.add(o.total);
      cust.orders += 1;
      byCustomer.set(o.customerId, cust);

      for (const l of o.lines) {
        unitsSold += 1;
        if (l.saleForm === SaleForm.CKD) ckd += 1;
        else cbu += 1;
        dayB.unitsSold += 1;
        netRevenue = netRevenue.add(l.lineTotal);

        const lc = l.unit?.landedCost ?? D();
        totalLandedCost = totalLandedCost.add(lc);

        const v = byVariant.get(l.productVariantId) ?? {
          sku: l.productVariant.supplierSkuCode,
          units: 0,
          revenue: D(),
          landedCost: D(),
        };
        v.units += 1;
        v.revenue = v.revenue.add(l.lineTotal);
        v.landedCost = v.landedCost.add(lc);
        byVariant.set(l.productVariantId, v);
      }

      byDay.set(day, dayB);
    }

    const revenueByVariant = [...byVariant.entries()]
      .map(([productVariantId, v]) => ({
        productVariantId,
        sku: v.sku,
        unitsSold: v.units,
        revenue: v.revenue,
        ...(canViewCost
          ? { landedCost: v.landedCost, margin: v.revenue.sub(v.landedCost) }
          : {}),
      }))
      .sort((a, b) => b.revenue.cmp(a.revenue));

    const revenueByCustomer = [...byCustomer.entries()]
      .map(([customerId, c]) => ({
        customerId,
        name: c.name,
        orders: c.orders,
        revenue: c.revenue,
      }))
      .sort((a, b) => b.revenue.cmp(a.revenue))
      .slice(0, topN);

    const trend = [...byDay.entries()]
      .map(([date, b]) => ({ date, revenue: b.revenue, unitsSold: b.unitsSold }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      from,
      to,
      recognitionBasis:
        'order-released-in-range (ReleaseAuthorisation.issuedAt)',
      totalRevenue,
      vatCollected,
      unitsSold: { total: unitsSold, ckd, cbu },
      revenueByVariant,
      revenueByCustomer,
      trend,
      // Margin block is cost data: present only for cost-permitted callers.
      ...(canViewCost
        ? {
            margin: {
              netRevenue,
              totalLandedCost,
              margin: netRevenue.sub(totalLandedCost),
            },
          }
        : {}),
    };
  }
}

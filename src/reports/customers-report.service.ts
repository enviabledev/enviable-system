import { Injectable } from '@nestjs/common';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersReportQueryDto } from './dto/customers-report-query.dto';

const D = (n: Prisma.Decimal.Value = 0) => new Prisma.Decimal(n);

// Orders whose unpaid remainder is an outstanding receivable. Only orders still
// at AWAITING_PAYMENT or PAYMENT_RECEIVED (not yet closed, not released) carry an
// outstanding balance per the spec.
const OUTSTANDING_STATUSES: SalesOrderStatus[] = [
  SalesOrderStatus.AWAITING_PAYMENT,
  SalesOrderStatus.PAYMENT_RECEIVED,
];

@Injectable()
export class CustomersReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Per-customer sales report. For each customer (filtered by tier and status):
   * total orders, total released order value, last order date, and outstanding
   * balance. Ordered by total order value descending, paginated on the shared
   * { data, page, pageSize, total } contract. Read-only, not audited.
   *
   * - Total order value sums SO.total for orders that reached at least
   *   RELEASE_AUTHORISED, identified by the presence of a ReleaseAuthorisation
   *   row (1:1, persists past release), the same released-set notion the revenue
   *   report uses.
   * - Outstanding balance is a sales/AR figure, NOT cost data; it is visible to
   *   all report.customers holders. It is derived exactly as the payments module
   *   derives payment coverage: confirmed = SUM of CONFIRMED payment amounts, and
   *   outstanding = SO.total minus confirmed, summed over the customer's orders
   *   currently at AWAITING_PAYMENT or PAYMENT_RECEIVED. Per-order remainders are
   *   clamped at zero (an overpaid order is a credit, not a negative receivable).
   * - The date range scopes the ORDER metrics (order.createdAt in range); the
   *   tier and status filters narrow the CUSTOMER set. Customers are listed
   *   regardless of in-range activity, so the customer base stays visible.
   */
  async customersReport(query: CustomersReportQueryDto) {
    const customerWhere: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(query.tierId ? { tierId: query.tierId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const customers = await this.prisma.customer.findMany({
      where: customerWhere,
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        tier: { select: { id: true, name: true } },
      },
    });
    const customerIds = customers.map((c) => c.id);

    const orderWhere: Prisma.SalesOrderWhereInput = {
      deletedAt: null,
      customerId: { in: customerIds },
    };
    if (query.from || query.to) {
      orderWhere.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lt: new Date(query.to) } : {}),
      };
    }

    const orders = await this.prisma.salesOrder.findMany({
      where: orderWhere,
      select: {
        customerId: true,
        total: true,
        status: true,
        createdAt: true,
        releaseAuthorisation: { select: { id: true } },
        payments: {
          where: { status: 'CONFIRMED' },
          select: { amount: true },
        },
      },
    });

    type Agg = {
      totalOrders: number;
      totalOrderValue: Prisma.Decimal;
      lastOrderDate: Date | null;
      outstandingBalance: Prisma.Decimal;
    };
    const aggById = new Map<string, Agg>();
    for (const id of customerIds) {
      aggById.set(id, {
        totalOrders: 0,
        totalOrderValue: D(),
        lastOrderDate: null,
        outstandingBalance: D(),
      });
    }

    for (const o of orders) {
      const a = aggById.get(o.customerId)!;
      a.totalOrders += 1;
      if (o.releaseAuthorisation) {
        a.totalOrderValue = a.totalOrderValue.add(o.total);
      }
      if (!a.lastOrderDate || o.createdAt > a.lastOrderDate) {
        a.lastOrderDate = o.createdAt;
      }
      if (OUTSTANDING_STATUSES.includes(o.status)) {
        const confirmed = o.payments.reduce(
          (acc, p) => acc.add(p.amount),
          D(),
        );
        const remainder = o.total.sub(confirmed);
        if (remainder.gt(0)) {
          a.outstandingBalance = a.outstandingBalance.add(remainder);
        }
      }
    }

    const rows = customers
      .map((c) => {
        const a = aggById.get(c.id)!;
        return {
          customerId: c.id,
          name: c.name,
          type: c.type,
          status: c.status,
          tier: c.tier ? { id: c.tier.id, name: c.tier.name } : null,
          totalOrders: a.totalOrders,
          totalOrderValue: a.totalOrderValue,
          lastOrderDate: a.lastOrderDate,
          outstandingBalance: a.outstandingBalance,
        };
      })
      .sort((x, y) => y.totalOrderValue.cmp(x.totalOrderValue));

    const total = rows.length;
    const start = (query.page - 1) * query.pageSize;
    const data = rows.slice(start, start + query.pageSize);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SyncPullQueryDto } from './dto/sync-pull-query.dto';

// Every mirror-scope entity name (the scope= filter accepts these). Update
// this list when adding a new entity to the mirror. The keys map directly to
// the camelCase plural fields in the response's `referenceData` (or `units`
// for the paged collection).
const ALL_TYPES = [
  // Reference data (small, full delta per window)
  'productVariant',
  'customerTier',
  'priceListEntry',
  'counterparty',
  'paymentMethod',
  'warehouse',
  'customer',
  'sparePart',
  // Procurement
  'purchaseOrder',
  'purchaseOrderLine',
  'letterOfCredit',
  'proformaInvoice',
  'proformaInvoiceLine',
  'shipment',
  'manifestLine',
  'landedCost',
  'forwarderInvoice',
  // Sales
  'salesOrder',
  'salesOrderLine',
  'invoice',
  'payment',
  // Large collection, paged separately
  'unit',
] as const;

type EntityType = (typeof ALL_TYPES)[number];

interface UnitCursor {
  ts: string;
  id: string;
}

/**
 * Pull-window semantics, uniform across since-mode and windowed-mode. Built
 * once per request from the query DTO, then consumed by every entity query.
 *   - since-mode (omitted from-or-to):    (since, serverNow]
 *   - windowed-mode (from AND to given):  [from, to)
 *
 * The since-mode upper bound is inclusive of serverNow (the watershed for the
 * pull). The windowed-mode upper bound is exclusive so adjacent windows
 * [W1.from, W1.to) and [W2.from = W1.to, W2.to) don't double-count rows
 * exactly on the boundary.
 */
interface PullWindow {
  low: Date;
  lowInclusive: boolean;
  high: Date;
  highInclusive: boolean;
}

function encodeCursor(c: UnitCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64');
}

function decodeCursor(raw: string): UnitCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (typeof parsed.ts === 'string' && typeof parsed.id === 'string') {
      return parsed as UnitCursor;
    }
  } catch {
    // fallthrough
  }
  throw new BadRequestException('Invalid cursor');
}

function dateBound(w: PullWindow): {
  gt?: Date;
  gte?: Date;
  lt?: Date;
  lte?: Date;
} {
  return {
    ...(w.lowInclusive ? { gte: w.low } : { gt: w.low }),
    ...(w.highInclusive ? { lte: w.high } : { lt: w.high }),
  };
}

@Injectable()
export class SyncPullService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Server-to-client delta. Two modes:
   *   - since-mode (default): everything with updatedAt > `since` and <=
   *     serverNow. Used by ongoing reconciling sync.
   *   - windowed-mode (when BOTH `from` AND `to` are provided): everything
   *     with updatedAt in [from, to). Used by the offline read-mirror's
   *     initial 90-day download in 7-day windows.
   *
   * Reference data and transactional entities are returned in full per window
   * (small enough at this business's scale for 7-day windows). Units are the
   * large set, bounded to `limit` per page with a continuation cursor when
   * truncated; the client re-pulls with the same window plus the cursor until
   * truncated is false, then adopts nextSince. Reference data is sent only on
   * the first page of a cycle (no cursor), not repeated on continuation pages.
   *
   * Read-only, not audited. landedCost (on units and on shipment.landedCosts
   * and unit.landedCost in any nested return) is stripped for callers without
   * costdata.view by the global CostVisibilityInterceptor (I-8); this service
   * returns the full rows and does not special-case cost.
   */
  async pull(query: SyncPullQueryDto) {
    const serverNow = new Date();
    const { window, mode } = this.resolveWindow(query, serverNow);
    const scope = query.scope
      ? new Set(
          query.scope
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
      : null;
    const inScope = (t: EntityType) => (scope ? scope.has(t) : true);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const referenceData = await this.referenceDelta(
      window,
      inScope,
      cursor !== null,
    );

    // Units: bounded page, keyset cursor for continuation within the same
    // window. Cursor logic is window-mode-agnostic: the cursor positions
    // within the upper bound, which the window supplies.
    let units: unknown[] = [];
    let truncated = false;
    let nextCursor: string | null = null;
    if (inScope('unit')) {
      const where = this.unitWhere(window, cursor);
      const rows = await this.prisma.unit.findMany({
        where,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
      });
      if (rows.length > query.limit) {
        truncated = true;
        rows.pop();
        const last = rows[rows.length - 1];
        nextCursor = encodeCursor({
          ts: last.updatedAt.toISOString(),
          id: last.id,
        });
      }
      units = rows;
    }

    // On a truncated page the cursor carries continuation; `nextSince`
    // stays anchored at the window's low so the client re-pulls the same
    // window with the cursor until truncated is false. Once complete:
    // since-mode advances to serverTime (the next ongoing pull starts
    // there); windowed-mode advances to `to` (the next window's `from`
    // typically continues from there, or the client uses `to` as the
    // basis for the subsequent reconciling delta).
    const nextSince = truncated
      ? window.low.toISOString()
      : mode === 'since'
        ? serverNow.toISOString()
        : window.high.toISOString();

    return {
      mode,
      window: { from: window.low.toISOString(), to: window.high.toISOString() },
      // Back-compat: since-mode callers still see `since`. Windowed-mode
      // callers can ignore it (the authoritative bounds are in `window`).
      since: window.low.toISOString(),
      serverTime: serverNow.toISOString(),
      nextSince,
      truncated,
      cursor: nextCursor,
      referenceData,
      units,
    };
  }

  private resolveWindow(
    query: SyncPullQueryDto,
    serverNow: Date,
  ): { window: PullWindow; mode: 'since' | 'windowed' } {
    if (query.from || query.to) {
      if (!query.from || !query.to) {
        throw new BadRequestException(
          'Windowed mode requires both `from` and `to`.',
        );
      }
      const from = new Date(query.from);
      const to = new Date(query.to);
      if (!(from < to)) {
        throw new BadRequestException('`from` must be before `to`.');
      }
      return {
        window: {
          low: from,
          lowInclusive: true,
          high: to,
          highInclusive: false,
        },
        mode: 'windowed',
      };
    }
    const since = query.since ? new Date(query.since) : new Date(0);
    return {
      window: {
        low: since,
        lowInclusive: false,
        high: serverNow,
        highInclusive: true,
      },
      mode: 'since',
    };
  }

  private unitWhere(
    window: PullWindow,
    cursor: UnitCursor | null,
  ): Prisma.UnitWhereInput {
    const highBound = window.highInclusive
      ? { lte: window.high }
      : { lt: window.high };
    if (cursor) {
      const ts = new Date(cursor.ts);
      // Keyset continuation: rows after (ts, id), still within the window.
      return {
        AND: [
          {
            OR: [
              { updatedAt: { gt: ts } },
              { updatedAt: ts, id: { gt: cursor.id } },
            ],
          },
          { updatedAt: highBound },
        ],
      };
    }
    return { updatedAt: dateBound(window) };
  }

  private async referenceDelta(
    window: PullWindow,
    inScope: (t: EntityType) => boolean,
    paging: boolean,
  ) {
    const empty = {
      productVariants: [] as unknown[],
      customerTiers: [] as unknown[],
      priceListEntries: [] as unknown[],
      counterparties: [] as unknown[],
      paymentMethods: [] as unknown[],
      warehouses: [] as unknown[],
      customers: [] as unknown[],
      spareParts: [] as unknown[],
      purchaseOrders: [] as unknown[],
      purchaseOrderLines: [] as unknown[],
      lettersOfCredit: [] as unknown[],
      proformaInvoices: [] as unknown[],
      proformaInvoiceLines: [] as unknown[],
      shipments: [] as unknown[],
      manifestLines: [] as unknown[],
      landedCosts: [] as unknown[],
      forwarderInvoices: [] as unknown[],
      salesOrders: [] as unknown[],
      salesOrderLines: [] as unknown[],
      invoices: [] as unknown[],
      payments: [] as unknown[],
    };
    if (paging) return empty;

    const updatedIn = { updatedAt: dateBound(window) };

    return {
      // Reference / lookup tables
      productVariants: inScope('productVariant')
        ? await this.prisma.productVariant.findMany({ where: updatedIn })
        : [],
      customerTiers: inScope('customerTier')
        ? await this.prisma.customerTier.findMany({ where: updatedIn })
        : [],
      // PriceListEntry now has its own updatedAt (the spine migration). The
      // effectiveFrom/effectiveTo fields remain the SEMANTIC mod-time for
      // prices, but updatedAt is the spine-consistent key the mirror uses.
      priceListEntries: inScope('priceListEntry')
        ? await this.prisma.priceListEntry.findMany({ where: updatedIn })
        : [],
      counterparties: inScope('counterparty')
        ? await this.prisma.counterparty.findMany({ where: updatedIn })
        : [],
      // PaymentMethod also has its own updatedAt now (spine migration). An
      // admin toggling status (e.g. activating POS Terminal later) surfaces
      // to the mirror via updatedAt, which the prior createdAt-fallback
      // would have missed.
      paymentMethods: inScope('paymentMethod')
        ? await this.prisma.paymentMethod.findMany({ where: updatedIn })
        : [],
      warehouses: inScope('warehouse')
        ? await this.prisma.warehouse.findMany({ where: updatedIn })
        : [],
      customers: inScope('customer')
        ? await this.prisma.customer.findMany({ where: updatedIn })
        : [],
      spareParts: inScope('sparePart')
        ? await this.prisma.sparePart.findMany({ where: updatedIn })
        : [],

      // Procurement chain
      purchaseOrders: inScope('purchaseOrder')
        ? await this.prisma.purchaseOrder.findMany({ where: updatedIn })
        : [],
      purchaseOrderLines: inScope('purchaseOrderLine')
        ? await this.prisma.purchaseOrderLine.findMany({ where: updatedIn })
        : [],
      lettersOfCredit: inScope('letterOfCredit')
        ? await this.prisma.letterOfCredit.findMany({ where: updatedIn })
        : [],
      proformaInvoices: inScope('proformaInvoice')
        ? await this.prisma.proformaInvoice.findMany({ where: updatedIn })
        : [],
      proformaInvoiceLines: inScope('proformaInvoiceLine')
        ? await this.prisma.proformaInvoiceLine.findMany({ where: updatedIn })
        : [],
      shipments: inScope('shipment')
        ? await this.prisma.shipment.findMany({ where: updatedIn })
        : [],
      manifestLines: inScope('manifestLine')
        ? await this.prisma.manifestLine.findMany({ where: updatedIn })
        : [],
      landedCosts: inScope('landedCost')
        ? await this.prisma.landedCost.findMany({ where: updatedIn })
        : [],
      forwarderInvoices: inScope('forwarderInvoice')
        ? await this.prisma.forwarderInvoice.findMany({ where: updatedIn })
        : [],

      // Sales chain
      salesOrders: inScope('salesOrder')
        ? await this.prisma.salesOrder.findMany({ where: updatedIn })
        : [],
      salesOrderLines: inScope('salesOrderLine')
        ? await this.prisma.salesOrderLine.findMany({ where: updatedIn })
        : [],
      invoices: inScope('invoice')
        ? await this.prisma.invoice.findMany({ where: updatedIn })
        : [],
      payments: inScope('payment')
        ? await this.prisma.payment.findMany({ where: updatedIn })
        : [],
    };
  }
}

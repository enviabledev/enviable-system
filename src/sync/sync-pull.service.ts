import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SyncPullQueryDto } from './dto/sync-pull-query.dto';

const ALL_TYPES = [
  'productVariant',
  'customerTier',
  'priceListEntry',
  'counterparty',
  'paymentMethod',
  'warehouse',
  'unit',
] as const;

interface UnitCursor {
  ts: string;
  id: string;
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

@Injectable()
export class SyncPullService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Server-to-client delta. Returns reference data and units changed since the
   * `since` timestamp (delta keyed on updatedAt, with per-model fallbacks where a
   * model lacks it), plus a nextSince to use on the following pull.
   *
   * Reference data is small and always returned in full (for the requested
   * scope). Units are the large set, so they are bounded to `limit` per page and
   * a continuation cursor is returned when truncated; the client re-pulls with
   * the same `since` plus the cursor until truncated is false, then adopts
   * nextSince. Reference data is sent only on the first page of a cycle (no
   * cursor), not repeated on continuation pages.
   *
   * Read-only, not audited. landedCost on pulled units is stripped for callers
   * without costdata.view by the global CostVisibilityInterceptor (I-8); this
   * service returns the full rows and does not special-case cost.
   */
  async pull(query: SyncPullQueryDto) {
    const serverNow = new Date();
    const since = query.since ? new Date(query.since) : new Date(0);
    const scope = query.scope
      ? new Set(query.scope.split(',').map((s) => s.trim()).filter(Boolean))
      : null;
    const inScope = (t: (typeof ALL_TYPES)[number]) =>
      scope ? scope.has(t) : true;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    // Reference data: full delta, first page only (skip when paging units).
    const referenceData = await this.referenceDelta(
      since,
      serverNow,
      inScope,
      cursor !== null,
    );

    // Units: bounded page.
    let units: unknown[] = [];
    let truncated = false;
    let nextCursor: string | null = null;
    if (inScope('unit')) {
      const where = this.unitWhere(since, serverNow, cursor);
      const rows = await this.prisma.unit.findMany({
        where,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
      });
      if (rows.length > query.limit) {
        truncated = true;
        rows.pop(); // drop the lookahead row
        const last = rows[rows.length - 1];
        nextCursor = encodeCursor({
          ts: last.updatedAt.toISOString(),
          id: last.id,
        });
      }
      units = rows;
    }

    return {
      since: since.toISOString(),
      serverTime: serverNow.toISOString(),
      // When truncated, keep since fixed and continue with the cursor; only
      // advance to serverTime once the page is complete.
      nextSince: truncated ? since.toISOString() : serverNow.toISOString(),
      truncated,
      cursor: nextCursor,
      referenceData,
      units,
    };
  }

  private unitWhere(
    since: Date,
    serverNow: Date,
    cursor: UnitCursor | null,
  ): Prisma.UnitWhereInput {
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
          { updatedAt: { lte: serverNow } },
        ],
      };
    }
    return { updatedAt: { gt: since, lte: serverNow } };
  }

  private async referenceDelta(
    since: Date,
    serverNow: Date,
    inScope: (t: (typeof ALL_TYPES)[number]) => boolean,
    paging: boolean,
  ) {
    const empty = {
      productVariants: [] as unknown[],
      customerTiers: [] as unknown[],
      priceListEntries: [] as unknown[],
      counterparties: [] as unknown[],
      paymentMethods: [] as unknown[],
      warehouses: [] as unknown[],
    };
    // On continuation pages (paging units) reference data is not repeated.
    if (paging) return empty;

    const window = { gt: since, lte: serverNow };

    return {
      productVariants: inScope('productVariant')
        ? await this.prisma.productVariant.findMany({
            where: { updatedAt: window },
          })
        : [],
      customerTiers: inScope('customerTier')
        ? await this.prisma.customerTier.findMany({
            where: { updatedAt: window },
          })
        : [],
      // PriceListEntry has no updatedAt: a change either creates a row
      // (effectiveFrom) or supersedes one (effectiveTo). Capture both.
      priceListEntries: inScope('priceListEntry')
        ? await this.prisma.priceListEntry.findMany({
            where: {
              OR: [{ effectiveFrom: window }, { effectiveTo: window }],
            },
          })
        : [],
      counterparties: inScope('counterparty')
        ? await this.prisma.counterparty.findMany({
            where: { updatedAt: window },
          })
        : [],
      // PaymentMethod has only createdAt; key the delta on it (methods are
      // effectively static reference data).
      paymentMethods: inScope('paymentMethod')
        ? await this.prisma.paymentMethod.findMany({
            where: { createdAt: window },
          })
        : [],
      warehouses: inScope('warehouse')
        ? await this.prisma.warehouse.findMany({ where: { updatedAt: window } })
        : [],
    };
  }
}

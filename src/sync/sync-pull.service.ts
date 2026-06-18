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
  'product',
  'productVariant',
  'customerTier',
  'priceListEntry',
  'counterparty',
  'paymentMethod',
  'warehouse',
  'customer',
  'sparePart',
  // User directory (non-sensitive management fields for the admin UI; never
  // the password hash or the mustResetPassword flag) and the role catalogue
  // (so role names resolve offline via the userRoles junction).
  'user',
  'role',
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
  'releaseAuthorisation',
  // Assembly (workflow; standard updatedAt-windowed delta)
  'assemblyJob',
  // Append-only movement/event streams (key on occurredAt or issuedAt, not
  // updatedAt: these tables are insert-only per I-9/I-10 so the insert time IS
  // their definitive mod-time).
  'stockMovement',
  'sparePartMovement',
  'auditLogEntry',
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
      products: [] as unknown[],
      productVariants: [] as unknown[],
      customerTiers: [] as unknown[],
      priceListEntries: [] as unknown[],
      counterparties: [] as unknown[],
      paymentMethods: [] as unknown[],
      warehouses: [] as unknown[],
      customers: [] as unknown[],
      spareParts: [] as unknown[],
      users: [] as unknown[],
      roles: [] as unknown[],
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
      releaseAuthorisations: [] as unknown[],
      assemblyJobs: [] as unknown[],
      stockMovements: [] as unknown[],
      sparePartMovements: [] as unknown[],
      auditLogEntries: [] as unknown[],
    };
    if (paging) return empty;

    const bound = dateBound(window);
    const updatedIn = { updatedAt: bound };
    // Append-only streams (StockMovement, SparePartMovement, AuditLogEntry)
    // key on `occurredAt`: per I-9/I-10 they are insert-only and have no
    // updatedAt, so the insert moment IS the mod-time. ReleaseAuthorisation
    // is conceptually append-only too (one per released SO, never updated);
    // it keys on `issuedAt`.
    const occurredIn = { occurredAt: bound };
    const issuedIn = { issuedAt: bound };

    return {
      // Reference / lookup tables
      // Product is the parent of ProductVariant; the mirror needs both so the
      // frontend can resolve full product labels offline (variant.productId
      // joined to product.{name, category, manufacturerId}). Small table at
      // this business's scale.
      products: inScope('product')
        ? await this.prisma.product.findMany({ where: updatedIn })
        : [],
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
      // Customers carry no secret column (no credential/cost field), so the
      // full row is mirrored: name, type, tier, phone, email, address, taxId,
      // status. This is exactly the field set the customer-management UI needs;
      // a leaner select would starve it. If a sensitive field is ever added to
      // Customer, switch this to an explicit select that excludes it.
      customers: inScope('customer')
        ? await this.prisma.customer.findMany({ where: updatedIn })
        : [],
      spareParts: inScope('sparePart')
        ? await this.prisma.sparePart.findMany({ where: updatedIn })
        : [],

      // User directory: serves two needs at once. (1) Offline "performed by
      // <name>" attribution on every user-attributed field (audit actorId,
      // approvedById, assembledById, cancelledById, movement actorId, etc.).
      // (2) The user-management admin UI, which needs email, status, role
      // assignments, and createdAt/lastLoginAt to render the directory offline.
      // The explicit `select` is LOAD-BEARING and security-critical: it
      // enumerates exactly the non-sensitive columns and NOTHING else. It MUST
      // NEVER include passwordHash, mustResetPassword, or any auth-token data;
      // never widen this to a bare findMany. Role names are resolved client-side
      // by joining each user's userRoles[].roleId to the roles bucket below.
      // Soft-deleted users are intentionally included (a deactivated staffer who
      // performed past actions must still resolve by name).
      users: inScope('user')
        ? await this.prisma.user.findMany({
            where: updatedIn,
            select: {
              id: true,
              fullName: true,
              email: true,
              status: true,
              createdAt: true,
              lastLoginAt: true,
              updatedAt: true,
              userRoles: { select: { roleId: true } },
            },
          })
        : [],

      // Role catalogue: lets the management UI resolve role names and their
      // permission keys offline. Non-deleted roles only. No sensitive data here
      // (roles and permissions are not secret), but kept to id/name/description
      // plus the permission keys the UI actually renders.
      roles: inScope('role')
        ? await this.prisma.role.findMany({
            where: { ...updatedIn, deletedAt: null },
            select: {
              id: true,
              name: true,
              description: true,
              isSystemRole: true,
              updatedAt: true,
              rolePermissions: { select: { permission: { select: { key: true } } } },
            },
          })
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
      // ReleaseAuthorisation gates the revenue and customers reports: revenue
      // keys on issuedAt as the recognition window, customers uses presence
      // of releaseAuthorisation as the released-or-not gate for
      // totalOrderValue. Without it mirrored, both reports would be wrong
      // offline. Append-only (one per released SO, never updated); key on
      // issuedAt.
      releaseAuthorisations: inScope('releaseAuthorisation')
        ? await this.prisma.releaseAuthorisation.findMany({ where: issuedIn })
        : [],

      // Assembly jobs. Standard updatedAt-windowed delta (the model has
      // updatedAt @updatedAt). No cost fields, so no CostVisibilityInterceptor
      // concern; flat rows only (the frontend reconstructs unit from the unit
      // bucket and variant from productVariant). supervisor (a User) is not
      // mirrored, so supervisor name is unavailable offline by design.
      assemblyJobs: inScope('assemblyJob')
        ? await this.prisma.assemblyJob.findMany({ where: updatedIn })
        : [],

      // Append-only event streams. unitId / sparePartId carried so the
      // frontend can reconstruct per-entity timelines by filtering. Keyed on
      // occurredAt (these tables have no updatedAt, per I-9/I-10). Cost
      // stripping is irrelevant: none of these rows carry cost fields (the
      // cost data lives on Unit.landedCost and SparePart.landedCostPerUnit,
      // which are themselves stripped by the global interceptor).
      stockMovements: inScope('stockMovement')
        ? await this.prisma.stockMovement.findMany({ where: occurredIn })
        : [],
      sparePartMovements: inScope('sparePartMovement')
        ? await this.prisma.sparePartMovement.findMany({ where: occurredIn })
        : [],
      // AuditLogEntry can grow unboundedly. The bucket is available; the
      // frontend mirror should govern whether to include it (typically only
      // for users holding audit.read, optionally with a narrower window than
      // the 90-day mirror to bound size). Not in scope by default would be a
      // policy choice for the frontend; the backend pull just exposes it.
      auditLogEntries: inScope('auditLogEntry')
        ? await this.prisma.auditLogEntry.findMany({ where: occurredIn })
        : [],
    };
  }
}

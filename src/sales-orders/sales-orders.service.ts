import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MovementReferenceType,
  MovementType,
  PaymentStatus,
  Prisma,
  SaleForm,
  SalesChannel,
  SalesOrderStatus,
  UnitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolationOn } from '../common/prisma-errors';
import { assertVariantsActive } from '../products/variant-status';
import { transitionUnit } from '../units/transition-unit';
import { PricingService } from '../pricing/pricing.service';
import { generateSalesPiNumber } from '../sales-proforma-invoices/sales-pi-number';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { QuerySalesOrdersDto } from './dto/query-sales-orders.dto';
import { SoLineDto } from './dto/so-line.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { generateInvoiceNumber } from './invoice-number';
import { generateSoNumber } from './so-number';
import { assertSoEditable, assertSoTransition } from './state-machine';

const VAT_RATE = '0.075';

// Cancellable order states. A RELEASE_AUTHORISED-or-later order is NOT here:
// its units are SOLD and committed, so reversal is the returns/refund flow.
const CANCELLABLE_STATUSES: SalesOrderStatus[] = [
  SalesOrderStatus.DRAFT,
  SalesOrderStatus.AWAITING_PAYMENT,
  SalesOrderStatus.PAYMENT_RECEIVED,
];
// Stored vatRate snapshot on the invoice, Decimal(5,4). 7.5%.
const INVOICE_VAT_RATE = '0.0750';

const SO_DETAIL_INCLUDE = {
  customer: {
    select: { id: true, name: true, tierId: true, type: true },
  },
  lines: {
    include: {
      unit: { select: { id: true, engineNumber: true, status: true } },
      productVariant: { select: { id: true, supplierSkuCode: true } },
    },
  },
  // The auto-issued sales-side proforma invoice, so the frontend can surface a
  // "View PI" affordance without a second fetch.
  salesProformaInvoice: {
    select: { id: true, piNumber: true, issuedAt: true },
  },
} as const;

/** P2002 on the one_active_so_line_per_unit partial index (I-11). */
function isSoLineUnitViolation(err: unknown): boolean {
  return isUniqueViolationOn(err, {
    index: 'one_active_so_line_per_unit',
    fields: ['unitId'],
  });
}

interface I11Conflict {
  engineNumber: string;
  soNumber: string;
}

/**
 * Format the I-11 message naming the offending unit(s) and the order(s) they
 * are already allocated to. Mirrors the receipt flow's named-serial pattern
 * ("engineNumber already exists: ...") so error messages consistently name the
 * offending entity. The empty-conflicts branch is a defensive fallback: P2002
 * fired but the enrichment lookup found nothing (a tight race where the other
 * allocation was freed between the violation and the lookup).
 */
function formatI11Message(conflicts: I11Conflict[]): string {
  if (conflicts.length === 0) {
    return 'Invariant I-11: a unit is already allocated to another active sales order line.';
  }
  if (conflicts.length === 1) {
    const c = conflicts[0];
    return `Invariant I-11: unit ${c.engineNumber} is already allocated to sales order ${c.soNumber}.`;
  }
  const list = conflicts.map((c) => `${c.engineNumber} (on ${c.soNumber})`).join(', ');
  return `Invariant I-11: ${conflicts.length} units already allocated to other active sales order lines: ${list}.`;
}

interface ResolvedLine {
  productVariantId: string;
  unitId: string;
  saleForm: SaleForm;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
  ) {}

  findAll(query: QuerySalesOrdersDto) {
    return this.prisma.salesOrder.findMany({
      where: {
        deletedAt: null,
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.channel ? { channel: query.channel } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        salesProformaInvoice: {
          select: { id: true, piNumber: true, issuedAt: true },
        },
        _count: { select: { lines: true } },
      },
    });
  }

  async findOne(id: string) {
    const so = await this.prisma.salesOrder.findFirst({
      where: { id, deletedAt: null },
      include: SO_DETAIL_INCLUDE,
    });
    if (!so) {
      throw new NotFoundException(`Sales order ${id} not found`);
    }
    return so;
  }

  async create(
    dto: CreateSalesOrderDto,
    actorId: string,
    canDiscount: boolean,
  ) {
    const tierId = await this.assertCustomerAndDiscount(
      dto.customerId,
      dto.lines,
      canDiscount,
    );
    const lines = await this.resolveLines(dto.lines, tierId);
    const totals = this.computeTotals(lines);
    const requestedUnitIds = lines.map((l) => l.unitId);

    // Pre-flight: name the offending unit if any requested unit is already
    // allocated. Mirrors the receipt flow's named-serial pattern. The I-11
    // partial unique index remains the authoritative enforcer; this just
    // surfaces a useful named error in the typical case (and avoids spending
    // a transaction on a doomed insert).
    const preFlight = await this.findI11Conflicts(requestedUnitIds);
    if (preFlight.length > 0) {
      throw new ConflictException(formatI11Message(preFlight));
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const soNumber = await generateSoNumber(tx);
        const created = await tx.salesOrder.create({
          data: {
            soNumber,
            customerId: dto.customerId,
            channel: dto.channel ?? SalesChannel.WAREHOUSE_PICKUP,
            status: SalesOrderStatus.DRAFT,
            createdById: actorId,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            vatAmount: totals.vatAmount,
            total: totals.total,
            lines: { create: lines.map(toLineCreate) },
          },
          select: { id: true },
        });

        // Auto-issue the customer-facing proforma invoice in the SAME
        // transaction: one PI per SO, atomic with SO creation (if this fails the
        // SO rolls back, leaving no orphan). issuedById is the SO creator.
        const piNumber = await generateSalesPiNumber(tx);
        const pi = await tx.salesProformaInvoice.create({
          data: { piNumber, salesOrderId: created.id, issuedById: actorId },
          select: { id: true, piNumber: true },
        });
        await this.audit.write(
          {
            actorUserId: actorId,
            action: 'salesproformainvoice.issue',
            entityType: 'SalesProformaInvoice',
            entityId: pi.id,
            context: {
              soId: created.id,
              piNumber: pi.piNumber,
              customerId: dto.customerId,
            },
          },
          tx,
        );

        return tx.salesOrder.findUniqueOrThrow({
          where: { id: created.id },
          include: SO_DETAIL_INCLUDE,
        });
      });
    } catch (err) {
      if (isSoLineUnitViolation(err)) {
        // Race-window enrichment: a concurrent allocation slipped between the
        // pre-flight and the insert. Re-query to name the offending unit.
        const racing = await this.findI11Conflicts(requestedUnitIds);
        throw new ConflictException(formatI11Message(racing));
      }
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateSalesOrderDto,
    actorId: string,
    canDiscount: boolean,
  ) {
    const existing = await this.findOne(id);
    assertSoEditable(existing.status);

    const customerId = dto.customerId ?? existing.customerId;
    const linesDto = dto.lines ?? existing.lines.map(toLineDto);
    const tierId = await this.assertCustomerAndDiscount(
      customerId,
      linesDto,
      canDiscount,
    );
    const lines = await this.resolveLines(linesDto, tierId);
    const totals = this.computeTotals(lines);
    const requestedUnitIds = lines.map((l) => l.unitId);

    // Pre-flight: name conflicts, excluding this order's existing lines (they
    // are about to be deleted and recreated in the transaction, so they are
    // not real conflicts).
    const preFlight = await this.findI11Conflicts(requestedUnitIds, id);
    if (preFlight.length > 0) {
      throw new ConflictException(formatI11Message(preFlight));
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Replace the line set atomically (frees the old unitIds from the
        // I-11 index, then re-allocates).
        await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
        await tx.salesOrder.update({
          where: { id },
          data: {
            ...(dto.customerId ? { customerId: dto.customerId } : {}),
            ...(dto.channel ? { channel: dto.channel } : {}),
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            vatAmount: totals.vatAmount,
            total: totals.total,
            lines: { create: lines.map(toLineCreate) },
          },
        });
        return tx.salesOrder.findUniqueOrThrow({
          where: { id },
          include: SO_DETAIL_INCLUDE,
        });
      });
    } catch (err) {
      if (isSoLineUnitViolation(err)) {
        // Race-window enrichment: see comment in create().
        const racing = await this.findI11Conflicts(requestedUnitIds, id);
        throw new ConflictException(formatI11Message(racing));
      }
      throw err;
    }
  }

  /**
   * Look up sales-order lines that already reference any of the requested
   * units (excluding lines of the given sales order, if any), and return the
   * offending units' engine numbers and the SO numbers they are allocated to.
   * The I-11 partial unique index is `(unitId) WHERE unitId IS NOT NULL`, so
   * a plain findMany on unitId catches every active allocation: cancelled
   * orders have their lines' unitId nulled (see cancel()), released orders
   * still hold the allocation forever (the unit is sold).
   */
  private async findI11Conflicts(
    unitIds: string[],
    excludeSalesOrderId?: string,
  ): Promise<I11Conflict[]> {
    const ids = [...new Set(unitIds.filter((u): u is string => Boolean(u)))];
    if (ids.length === 0) return [];
    const rows = await this.prisma.salesOrderLine.findMany({
      where: {
        unitId: { in: ids },
        ...(excludeSalesOrderId
          ? { salesOrderId: { not: excludeSalesOrderId } }
          : {}),
      },
      select: {
        unit: { select: { engineNumber: true } },
        salesOrder: { select: { soNumber: true } },
      },
    });
    return rows
      .filter((r) => r.unit && r.salesOrder)
      .map((r) => ({
        engineNumber: r.unit!.engineNumber,
        soNumber: r.salesOrder.soNumber,
      }));
  }

  async submit(id: string) {
    const so = await this.findOne(id);
    assertSoTransition(so.status, SalesOrderStatus.AWAITING_PAYMENT);
    return this.prisma.salesOrder.update({
      where: { id },
      data: { status: SalesOrderStatus.AWAITING_PAYMENT },
      include: SO_DETAIL_INCLUDE,
    });
  }

  /**
   * Generate the invoice for a sales order at AWAITING_PAYMENT or beyond. The
   * invoice SNAPSHOTS the financial values at this moment (vatRate, vatAmount,
   * total); it is a fixed document and does not recompute from the SO later.
   * One invoice per SO is enforced by the salesOrderId unique constraint
   * (P2002 rewrapped to 409). DRAFT or CANCELLED orders are rejected (409).
   */
  async generateInvoice(salesOrderId: string) {
    const so = await this.findOne(salesOrderId);
    if (
      so.status === SalesOrderStatus.DRAFT ||
      so.status === SalesOrderStatus.CANCELLED
    ) {
      throw new ConflictException(
        `Cannot generate an invoice for a ${so.status} sales order; it must be at AWAITING_PAYMENT or beyond.`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const invoiceNumber = await generateInvoiceNumber(tx);
        return tx.invoice.create({
          data: {
            salesOrderId,
            invoiceNumber,
            vatRate: new Prisma.Decimal(INVOICE_VAT_RATE),
            vatAmount: so.vatAmount,
            total: so.total,
            // pdfDocumentId stays null; PDF generation is deferred.
          },
        });
      });
    } catch (err) {
      if (
        isUniqueViolationOn(err, {
          index: 'invoices_salesOrderId_key',
          fields: ['salesOrderId'],
        })
      ) {
        throw new ConflictException(
          `Sales order ${salesOrderId} already has an invoice (one invoice per order).`,
        );
      }
      throw err;
    }
  }

  async getInvoiceForSo(salesOrderId: string) {
    await this.findOne(salesOrderId);
    const invoice = await this.prisma.invoice.findUnique({
      where: { salesOrderId },
    });
    if (!invoice) {
      throw new NotFoundException(
        `Sales order ${salesOrderId} has no invoice yet`,
      );
    }
    return invoice;
  }

  async getInvoice(id: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    return invoice;
  }

  /**
   * Authorise release: the point where units actually leave inventory and sell.
   * In ONE transaction: re-check the order is at PAYMENT_RECEIVED AND re-aggregate
   * the SUM of CONFIRMED payments and assert it covers the total (Invariant I-4,
   * defence-in-depth: the payment SUM is recomputed here, NOT inferred from the
   * status, so a status set by any other path cannot release an underpaid order).
   * Then create the ReleaseAuthorisation and transition every allocated unit to
   * its SOLD state via transitionUnit (SALE movement, I-3 inherited), set soldAt,
   * and advance the order to RELEASE_AUTHORISED. All or nothing.
   */
  async authoriseRelease(salesOrderId: string, actorId: string) {
    const existing = await this.findOne(salesOrderId);
    // First gate: only PAYMENT_RECEIVED -> RELEASE_AUTHORISED is a legal move.
    assertSoTransition(existing.status, SalesOrderStatus.RELEASE_AUTHORISED);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUniqueOrThrow({
        where: { id: salesOrderId },
        include: { lines: true },
      });
      // Re-check the status gate inside the transaction.
      assertSoTransition(order.status, SalesOrderStatus.RELEASE_AUTHORISED);

      // I-4 defence-in-depth: recompute the confirmed-payment SUM here and
      // require it to cover the total. Do NOT trust the PAYMENT_RECEIVED status.
      const agg = await tx.payment.aggregate({
        _sum: { amount: true },
        where: { salesOrderId, status: PaymentStatus.CONFIRMED },
      });
      const confirmed = agg._sum.amount ?? new Prisma.Decimal(0);
      if (confirmed.lt(order.total)) {
        throw new ConflictException(
          `Invariant I-4: confirmed payments (${confirmed.toString()}) do not cover the order total (${order.total.toString()}). Release refused.`,
        );
      }

      const refPayment = await tx.payment.findFirst({
        where: { salesOrderId, status: PaymentStatus.CONFIRMED },
        orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
        select: { id: true },
      });

      await tx.releaseAuthorisation.create({
        data: {
          salesOrderId,
          issuedById: actorId,
          referencePaymentId: refPayment?.id ?? null,
        },
      });

      const soldAt = new Date();
      for (const line of order.lines) {
        if (!line.unitId) {
          throw new ConflictException(
            `Sales order line ${line.id} has no allocated unit; cannot release.`,
          );
        }
        const target =
          line.saleForm === SaleForm.CKD
            ? UnitStatus.SOLD_AS_CKD
            : UnitStatus.SOLD_AS_CBU;
        await transitionUnit(tx, line.unitId, target, MovementType.SALE, {
          actorId,
          referenceType: MovementReferenceType.SALES_ORDER,
          referenceId: salesOrderId,
          unitData: { soldAt },
        });
      }

      await tx.salesOrder.update({
        where: { id: salesOrderId },
        data: { status: SalesOrderStatus.RELEASE_AUTHORISED },
      });

      return tx.salesOrder.findUniqueOrThrow({
        where: { id: salesOrderId },
        include: SO_DETAIL_INCLUDE,
      });
    });
  }

  /**
   * Cancel a sales order. Only DRAFT, AWAITING_PAYMENT, or PAYMENT_RECEIVED are
   * cancellable; a RELEASE_AUTHORISED-or-later order is rejected (409, directed
   * to returns/refund) because its units are already SOLD and committed. In one
   * transaction: null each line's unitId to free the soft reservation (the
   * one_active_so_line_per_unit index is WHERE unitId IS NOT NULL, so nulling it
   * lifts the I-11 block and the unit can be allocated to another order), write
   * the real cancellation columns, and move the order to CANCELLED. No unit
   * state changes (allocation never moved units out of warehouse status). If
   * confirmed payments exist, surface (do not process) a refund-outstanding flag
   * and amount.
   */
  async cancel(salesOrderId: string, reason: string, actorId: string) {
    const so = await this.findOne(salesOrderId);
    if (!CANCELLABLE_STATUSES.includes(so.status)) {
      throw new ConflictException(
        `Sales order ${so.soNumber} is ${so.status} and cannot be cancelled. A released or later order is handled via the returns/refund flow (its units are sold and committed).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUniqueOrThrow({
        where: { id: salesOrderId },
      });
      if (!CANCELLABLE_STATUSES.includes(order.status)) {
        throw new ConflictException(
          `Sales order ${order.soNumber} is ${order.status} and cannot be cancelled.`,
        );
      }
      assertSoTransition(order.status, SalesOrderStatus.CANCELLED);

      // Surface an outstanding refund for any confirmed payments (not processed
      // here; refund handling is out of scope).
      const agg = await tx.payment.aggregate({
        _sum: { amount: true },
        where: { salesOrderId, status: PaymentStatus.CONFIRMED },
      });
      const refundAmount = agg._sum.amount ?? new Prisma.Decimal(0);
      const refundOutstanding = refundAmount.gt(0);

      // Free the soft reservation: null each line's unitId so the I-11 index
      // releases the units. No unit state transition (they were never moved).
      await tx.salesOrderLine.updateMany({
        where: { salesOrderId },
        data: { unitId: null },
      });

      const updated = await tx.salesOrder.update({
        where: { id: salesOrderId },
        data: {
          status: SalesOrderStatus.CANCELLED,
          cancellationReason: reason,
          cancelledAt: new Date(),
          cancelledById: actorId,
        },
        include: SO_DETAIL_INCLUDE,
      });
      return { ...updated, refundOutstanding, refundAmount };
    });
  }

  private async assertCustomerAndDiscount(
    customerId: string,
    lines: SoLineDto[],
    canDiscount: boolean,
  ): Promise<string> {
    const hasDiscount = lines.some(
      (l) => l.discountAmount && new Prisma.Decimal(l.discountAmount).gt(0),
    );
    if (hasDiscount && !canDiscount) {
      throw new ForbiddenException(
        'A line discount requires the salesorder.discount permission.',
      );
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
    });
    if (!customer) {
      throw new BadRequestException(`Customer ${customerId} not found`);
    }
    if (!customer.tierId) {
      throw new BadRequestException(
        `Customer ${customerId} has no tier; cannot resolve prices`,
      );
    }
    return customer.tierId;
  }

  // Soft reservation: validate unit availability and resolve price per line.
  // The unit's status is NOT changed here (transitionUnit is not called); the
  // line holds the unit via unitId only. Double-allocation is enforced by the
  // one_active_so_line_per_unit index (P2002), not a pre-check.
  private async resolveLines(
    lines: SoLineDto[],
    tierId: string,
  ): Promise<ResolvedLine[]> {
    const resolved: ResolvedLine[] = [];
    for (const line of lines) {
      const unit = await this.prisma.unit.findUnique({
        where: { id: line.unitId },
      });
      if (!unit) {
        throw new BadRequestException(`Unit ${line.unitId} not found`);
      }
      if (unit.productVariantId !== line.productVariantId) {
        throw new BadRequestException(
          `Unit ${line.unitId} is variant ${unit.productVariantId}, not ${line.productVariantId}`,
        );
      }
      const required =
        line.saleForm === SaleForm.CKD
          ? UnitStatus.IN_WAREHOUSE_CKD
          : UnitStatus.IN_WAREHOUSE_CBU;
      if (unit.status !== required) {
        throw new ConflictException(
          `Unit ${unit.engineNumber} is ${unit.status}, not ${required} required for a ${line.saleForm} line.`,
        );
      }

      const priceEntry = await this.pricing.resolvePrice(
        line.productVariantId,
        tierId,
      );
      const unitPrice = priceEntry.price;
      const discountAmount = new Prisma.Decimal(line.discountAmount ?? '0');
      if (discountAmount.gt(unitPrice)) {
        throw new BadRequestException(
          `Discount ${discountAmount} exceeds unit price ${unitPrice} for unit ${unit.engineNumber}`,
        );
      }
      resolved.push({
        productVariantId: line.productVariantId,
        unitId: line.unitId,
        saleForm: line.saleForm,
        unitPrice,
        discountAmount,
        lineTotal: unitPrice.sub(discountAmount),
      });
    }
    // A discontinued variant cannot be sold anew (covers both create and the
    // line-replacement path). Existing SO lines are untouched: this gates only
    // the lines being resolved for a new/edited order.
    await assertVariantsActive(
      this.prisma,
      resolved.map((l) => l.productVariantId),
      'sales orders',
    );
    return resolved;
  }

  private computeTotals(lines: ResolvedLine[]) {
    const subtotal = lines.reduce(
      (acc, l) => acc.add(l.unitPrice),
      new Prisma.Decimal(0),
    );
    const discountTotal = lines.reduce(
      (acc, l) => acc.add(l.discountAmount),
      new Prisma.Decimal(0),
    );
    const net = subtotal.sub(discountTotal);
    // VAT 7.5% of (subtotal - discountTotal), rounded to 2 places at the order
    // level (per the documented MVP convention).
    const vatAmount = net
      .mul(VAT_RATE)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const total = net.add(vatAmount);
    return { subtotal, discountTotal, vatAmount, total };
  }
}

function toLineCreate(line: ResolvedLine): Prisma.SalesOrderLineCreateWithoutSalesOrderInput {
  return {
    productVariant: { connect: { id: line.productVariantId } },
    unit: { connect: { id: line.unitId } },
    saleForm: line.saleForm,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    lineTotal: line.lineTotal,
  };
}

function toLineDto(line: {
  productVariantId: string;
  unitId: string | null;
  saleForm: SaleForm;
  discountAmount: Prisma.Decimal;
}): SoLineDto {
  return {
    productVariantId: line.productVariantId,
    unitId: line.unitId ?? '',
    saleForm: line.saleForm,
    discountAmount: line.discountAmount.toString(),
  };
}

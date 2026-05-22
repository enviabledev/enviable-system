import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SaleForm,
  SalesChannel,
  SalesOrderStatus,
  UnitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolationOn } from '../common/prisma-errors';
import { PricingService } from '../pricing/pricing.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { QuerySalesOrdersDto } from './dto/query-sales-orders.dto';
import { SoLineDto } from './dto/so-line.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { generateInvoiceNumber } from './invoice-number';
import { generateSoNumber } from './so-number';
import { assertSoEditable, assertSoTransition } from './state-machine';

const VAT_RATE = '0.075';
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
} as const;

/** P2002 on the one_active_so_line_per_unit partial index (I-11). */
function isSoLineUnitViolation(err: unknown): boolean {
  return isUniqueViolationOn(err, {
    index: 'one_active_so_line_per_unit',
    fields: ['unitId'],
  });
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

    try {
      return await this.prisma.$transaction(async (tx) => {
        const soNumber = await generateSoNumber(tx);
        return tx.salesOrder.create({
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
          include: SO_DETAIL_INCLUDE,
        });
      });
    } catch (err) {
      if (isSoLineUnitViolation(err)) {
        throw new ConflictException(
          'Invariant I-11: a unit is already allocated to another active sales order line.',
        );
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
        throw new ConflictException(
          'Invariant I-11: a unit is already allocated to another active sales order line.',
        );
      }
      throw err;
    }
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

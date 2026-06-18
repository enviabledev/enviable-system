import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertVariantsActive } from '../products/variant-status';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { PoLineDto } from './dto/po-line.dto';
import { QueryPurchaseOrdersDto } from './dto/query-purchase-orders.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { generatePoNumber } from './po-number';
import { assertPoEditable, assertPoTransition } from './state-machine';

const SUPPLIER_SUMMARY = {
  select: { id: true, name: true, type: true, status: true },
} as const;

const PO_INCLUDE = {
  supplier: SUPPLIER_SUMMARY,
  lines: true,
} as const;

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: QueryPurchaseOrdersDto) {
    return this.prisma.purchaseOrder.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { supplier: SUPPLIER_SUMMARY },
    });
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: PO_INCLUDE,
    });
    if (!po) {
      throw new NotFoundException(`Purchase order ${id} not found`);
    }
    return po;
  }

  async create(dto: CreatePurchaseOrderDto) {
    await this.assertSupplierActive(dto.supplierId);
    await this.assertVariantsExist(dto.lines);
    // No new PO may be raised for a discontinued variant: issuing fresh
    // procurement contradicts winding the variant down. Existence is checked
    // above (400); this gates status (409). Pre-transaction, so the whole PO
    // fails atomically before any line is written.
    await assertVariantsActive(
      this.prisma,
      dto.lines.map((line) => line.productVariantId),
      'purchase order lines',
    );
    const totalValue = this.computeTotal(dto.lines);

    return this.prisma.$transaction(async (tx) => {
      const poNumber = await generatePoNumber(tx);
      return tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId: dto.supplierId,
          currency: dto.currency,
          status: PurchaseOrderStatus.DRAFT,
          totalValue,
          expectedShipDate: dto.expectedShipDate
            ? new Date(dto.expectedShipDate)
            : null,
          paymentTerms: dto.paymentTerms ?? null,
          lines: {
            create: dto.lines.map((line) => ({
              productVariantId: line.productVariantId,
              quantityOrdered: line.quantityOrdered,
              unitPrice: new Prisma.Decimal(line.unitPrice),
            })),
          },
        },
        include: PO_INCLUDE,
      });
    });
  }

  async update(id: string, dto: UpdatePurchaseOrderDto) {
    const po = await this.findOne(id);
    assertPoEditable(po.status);

    if (dto.supplierId) {
      await this.assertSupplierActive(dto.supplierId);
    }
    if (dto.lines) {
      await this.assertVariantsExist(dto.lines);
      // Same guard on the line-replacement path: adding/replacing a line for a
      // discontinued variant on an existing PO is blocked too.
      await assertVariantsActive(
        this.prisma,
        dto.lines.map((line) => line.productVariantId),
        'purchase order lines',
      );
    }
    const totalValue = dto.lines
      ? this.computeTotal(dto.lines)
      : po.totalValue;

    return this.prisma.$transaction(async (tx) => {
      if (dto.lines) {
        // Replace the line set atomically.
        await tx.purchaseOrderLine.deleteMany({
          where: { purchaseOrderId: id },
        });
        await tx.purchaseOrderLine.createMany({
          data: dto.lines.map((line) => ({
            purchaseOrderId: id,
            productVariantId: line.productVariantId,
            quantityOrdered: line.quantityOrdered,
            unitPrice: new Prisma.Decimal(line.unitPrice),
          })),
        });
      }
      return tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(dto.supplierId ? { supplierId: dto.supplierId } : {}),
          ...(dto.currency ? { currency: dto.currency } : {}),
          ...(dto.expectedShipDate !== undefined
            ? {
                expectedShipDate: dto.expectedShipDate
                  ? new Date(dto.expectedShipDate)
                  : null,
              }
            : {}),
          ...(dto.paymentTerms !== undefined
            ? { paymentTerms: dto.paymentTerms }
            : {}),
          ...(dto.lines ? { totalValue } : {}),
        },
        include: PO_INCLUDE,
      });
    });
  }

  async submit(id: string) {
    const po = await this.findOne(id);
    assertPoTransition(po.status, PurchaseOrderStatus.PENDING_APPROVAL);
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.PENDING_APPROVAL },
      include: PO_INCLUDE,
    });
  }

  async approve(id: string) {
    const po = await this.findOne(id);
    // MVP hardcoded rule: Procurement Officer submits, ED approves. The
    // configurable approval engine is deliberately not built here. RBAC
    // (po.approve) enforces who may call this.
    assertPoTransition(po.status, PurchaseOrderStatus.APPROVED);
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.APPROVED },
      include: PO_INCLUDE,
    });
  }

  private computeTotal(lines: PoLineDto[]): Prisma.Decimal {
    return lines.reduce(
      (acc, line) =>
        acc.add(new Prisma.Decimal(line.unitPrice).mul(line.quantityOrdered)),
      new Prisma.Decimal(0),
    );
  }

  private async assertSupplierActive(supplierId: string): Promise<void> {
    const supplier = await this.prisma.counterparty.findFirst({
      where: { id: supplierId, deletedAt: null },
    });
    if (!supplier) {
      throw new BadRequestException(
        `Supplier ${supplierId} not found or inactive`,
      );
    }
  }

  private async assertVariantsExist(lines: PoLineDto[]): Promise<void> {
    const variantIds = [...new Set(lines.map((line) => line.productVariantId))];
    const count = await this.prisma.productVariant.count({
      where: { id: { in: variantIds } },
    });
    if (count !== variantIds.length) {
      throw new BadRequestException(
        'One or more productVariantId values are invalid',
      );
    }
  }
}

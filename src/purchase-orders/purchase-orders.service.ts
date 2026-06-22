import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveOrCreateVariant } from '../products/variant-auto-create';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  async create(dto: CreatePurchaseOrderDto, actorUserId: string | null) {
    await this.assertSupplierActive(dto.supplierId);
    this.assertLineRefsValid(dto.lines);
    const totalValue = this.computeTotal(dto.lines);

    return this.prisma.$transaction(async (tx) => {
      const poNumber = await generatePoNumber(tx);
      // Create the PO shell first so auto-created variants can record it as their
      // source entity, then resolve lines (auto-creating variants for unknown
      // SKUs), then attach lines. All in one transaction: a discontinued-variant
      // 409, a similarity 409, or any failure rolls back the PO AND any variant
      // it would have minted.
      const po = await tx.purchaseOrder.create({
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
        },
      });
      const resolved = await this.resolveLines(tx, dto.lines, actorUserId, po.id);
      await tx.purchaseOrderLine.createMany({
        data: resolved.map((line) => ({
          purchaseOrderId: po.id,
          productVariantId: line.productVariantId,
          quantityOrdered: line.quantityOrdered,
          unitPrice: new Prisma.Decimal(line.unitPrice),
        })),
      });
      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id: po.id },
        include: PO_INCLUDE,
      });
    });
  }

  async update(
    id: string,
    dto: UpdatePurchaseOrderDto,
    actorUserId: string | null,
  ) {
    const po = await this.findOne(id);
    assertPoEditable(po.status);

    if (dto.supplierId) {
      await this.assertSupplierActive(dto.supplierId);
    }
    if (dto.lines) {
      this.assertLineRefsValid(dto.lines);
    }
    const totalValue = dto.lines
      ? this.computeTotal(dto.lines)
      : po.totalValue;

    return this.prisma.$transaction(async (tx) => {
      if (dto.lines) {
        // Replace the line set atomically. Resolution (incl. auto-create for
        // unknown SKUs) and the discontinued guard run inside the same tx.
        await tx.purchaseOrderLine.deleteMany({
          where: { purchaseOrderId: id },
        });
        const resolved = await this.resolveLines(
          tx,
          dto.lines,
          actorUserId,
          id,
        );
        await tx.purchaseOrderLine.createMany({
          data: resolved.map((line) => ({
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

  /**
   * Each line must carry EXACTLY ONE of productVariantId / productVariantSku.
   * Pure shape check (400), run before the transaction.
   */
  private assertLineRefsValid(lines: PoLineDto[]): void {
    for (const line of lines) {
      const hasId = !!line.productVariantId;
      const hasSku = !!line.productVariantSku;
      if (hasId === hasSku) {
        throw new BadRequestException(
          'Each PO line must specify exactly one of productVariantId or productVariantSku',
        );
      }
    }
  }

  /**
   * Resolve every line to a concrete productVariantId inside the transaction:
   * id lines pass through (existence checked here, 400 on a bad id); SKU lines
   * go through auto-create (exact match reused, similar match -> 409 unless the
   * line overrides, otherwise a new variant on the sentinel product). The
   * discontinued guard then runs across every resolved variant (409). Returns
   * lines with productVariantId filled in, ready to persist.
   */
  private async resolveLines(
    tx: Prisma.TransactionClient,
    lines: PoLineDto[],
    actorUserId: string | null,
    poId: string,
  ): Promise<
    { productVariantId: string; quantityOrdered: number; unitPrice: string }[]
  > {
    const resolved: {
      productVariantId: string;
      quantityOrdered: number;
      unitPrice: string;
    }[] = [];
    const idProvided: string[] = [];
    for (const line of lines) {
      let productVariantId: string;
      if (line.productVariantId) {
        productVariantId = line.productVariantId;
        idProvided.push(productVariantId);
      } else {
        const { variant } = await resolveOrCreateVariant({
          tx,
          audit: this.audit,
          sku: line.productVariantSku!,
          source: 'po-line-create',
          sourceEntityId: poId,
          actorUserId,
          overrideSimilarityCheck: line.overrideSimilarityCheck,
        });
        productVariantId = variant.id;
      }
      resolved.push({
        productVariantId,
        quantityOrdered: line.quantityOrdered,
        unitPrice: line.unitPrice,
      });
    }
    // Existence for caller-supplied ids (SKU-resolved ids exist by construction).
    if (idProvided.length > 0) {
      const ids = [...new Set(idProvided)];
      const count = await tx.productVariant.count({
        where: { id: { in: ids } },
      });
      if (count !== ids.length) {
        throw new BadRequestException(
          'One or more productVariantId values are invalid',
        );
      }
    }
    // No PO line (new or auto-created) may reference a discontinued variant.
    await assertVariantsActive(
      tx,
      resolved.map((line) => line.productVariantId),
      'purchase order lines',
    );
    return resolved;
  }
}

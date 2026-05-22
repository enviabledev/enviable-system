import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProformaInvoiceStatus, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolationOn } from '../common/prisma-errors';
import { poRank } from '../purchase-orders/state-machine';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';
import { PiLineDto } from './dto/pi-line.dto';

const PI_INCLUDE = {
  lines: true,
  purchaseOrder: {
    select: { id: true, poNumber: true, status: true, supplierId: true },
  },
} as const;

/** P2002 on the one_active_pi_per_po partial index that enforces I-5. */
function isActivePiIndexViolation(err: unknown): boolean {
  return isUniqueViolationOn(err, {
    index: 'one_active_pi_per_po',
    fields: ['purchaseOrderId'],
  });
}

@Injectable()
export class ProformaInvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForPo(purchaseOrderId: string) {
    return this.prisma.proformaInvoice.findMany({
      where: { purchaseOrderId },
      orderBy: { revisionNumber: 'desc' },
      include: PI_INCLUDE,
    });
  }

  async findOne(id: string) {
    const pi = await this.prisma.proformaInvoice.findUnique({
      where: { id },
      include: PI_INCLUDE,
    });
    if (!pi) {
      throw new NotFoundException(`Proforma invoice ${id} not found`);
    }
    return pi;
  }

  async create(purchaseOrderId: string, dto: CreateProformaInvoiceDto) {
    await this.assertVariantsExist(dto.lines);

    const freightAmount = new Prisma.Decimal(dto.freightAmount ?? '0');
    const insuranceAmount = new Prisma.Decimal(dto.insuranceAmount ?? '0');
    const lineData = dto.lines.map((line) => ({
      productVariantId: line.productVariantId,
      quantity: line.quantity,
      unitPrice: new Prisma.Decimal(line.unitPrice),
      lineTotal: new Prisma.Decimal(line.unitPrice).mul(line.quantity),
    }));
    const goods = lineData.reduce(
      (acc, line) => acc.add(line.lineTotal),
      new Prisma.Decimal(0),
    );
    // PI grand total is the goods value plus freight and insurance (the CIF
    // invoice total). Freight and insurance are also stored separately for the
    // later landed-cost breakdown.
    const totalValue = goods.add(freightAmount).add(insuranceAmount);

    return this.prisma.$transaction(async (tx) => {
      // Lock the parent PO row so concurrent revisions serialise; the next
      // revisionNumber is MAX+1 by construction. camelCase raw-SQL columns.
      const poRows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM purchase_orders
        WHERE id = ${purchaseOrderId} AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      if (poRows.length === 0) {
        throw new NotFoundException(
          `Purchase order ${purchaseOrderId} not found`,
        );
      }
      const maxRows = await tx.$queryRaw<{ max: number | null }[]>`
        SELECT MAX("revisionNumber") AS max
        FROM proforma_invoices
        WHERE "purchaseOrderId" = ${purchaseOrderId}
      `;
      const revisionNumber = Number(maxRows[0]?.max ?? 0) + 1;

      return tx.proformaInvoice.create({
        data: {
          purchaseOrderId,
          piNumber: dto.piNumber,
          revisionNumber,
          status: ProformaInvoiceStatus.PENDING_REVIEW,
          issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
          validityUntil: dto.validityUntil ? new Date(dto.validityUntil) : null,
          freightAmount,
          insuranceAmount,
          totalValue,
          paymentTerms: dto.paymentTerms ?? null,
          portOfLoading: dto.portOfLoading ?? null,
          portOfDischarge: dto.portOfDischarge ?? null,
          lines: { create: lineData },
        },
        include: PI_INCLUDE,
      });
    });
  }

  async approve(id: string, actorUserId: string) {
    const pi = await this.findOne(id);
    if (pi.status !== ProformaInvoiceStatus.PENDING_REVIEW) {
      throw new ConflictException(
        `Proforma invoice can only be approved from PENDING_REVIEW (current: ${pi.status}). Allowed: PENDING_REVIEW.`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // I-5: supersede any currently-ACTIVE PI for this PO BEFORE activating
        // this one, in a single transaction. The partial unique index
        // (WHERE status='ACTIVE') is checked at statement end, so the ACTIVE
        // domain is never two rows, even momentarily, from any other session.
        await tx.proformaInvoice.updateMany({
          where: {
            purchaseOrderId: pi.purchaseOrderId,
            status: ProformaInvoiceStatus.ACTIVE,
          },
          data: { status: ProformaInvoiceStatus.SUPERSEDED },
        });

        const activated = await tx.proformaInvoice.update({
          where: { id },
          data: {
            status: ProformaInvoiceStatus.ACTIVE,
            approvedById: actorUserId,
            approvedAt: new Date(),
          },
          include: PI_INCLUDE,
        });

        // Cross-aggregate effect: pull the parent PO forward to PI_RECEIVED if
        // it is not already at or past that point. This is intentionally not
        // routed through assertPoTransition (PI approval drives the PO, it is
        // not a user-initiated PO transition). CANCELLED (rank -1) is skipped.
        const po = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id: pi.purchaseOrderId },
        });
        const rank = poRank(po.status);
        if (rank >= 0 && rank < poRank(PurchaseOrderStatus.PI_RECEIVED)) {
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: { status: PurchaseOrderStatus.PI_RECEIVED },
          });
        }

        return activated;
      });
    } catch (err) {
      if (isActivePiIndexViolation(err)) {
        throw new ConflictException(
          'Invariant I-5 violated: a purchase order may have at most one ACTIVE proforma invoice.',
        );
      }
      throw err;
    }
  }

  async reject(id: string) {
    const pi = await this.findOne(id);
    if (pi.status !== ProformaInvoiceStatus.PENDING_REVIEW) {
      throw new ConflictException(
        `Proforma invoice can only be rejected from PENDING_REVIEW (current: ${pi.status}). Allowed: PENDING_REVIEW.`,
      );
    }
    return this.prisma.proformaInvoice.update({
      where: { id },
      data: { status: ProformaInvoiceStatus.REJECTED },
      include: PI_INCLUDE,
    });
  }

  private async assertVariantsExist(lines: PiLineDto[]): Promise<void> {
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

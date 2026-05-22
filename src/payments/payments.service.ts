import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CounterpartyStatus,
  PaymentConfirmationSource,
  PaymentStatus,
  Prisma,
  SalesOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecordPaymentDto } from './dto/record-payment.dto';

const PAYMENT_INCLUDE = {
  paymentMethod: { select: { id: true, name: true, status: true } },
} as const;

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  listForSo(salesOrderId: string) {
    return this.prisma.payment.findMany({
      where: { salesOrderId },
      orderBy: { createdAt: 'asc' },
      include: PAYMENT_INCLUDE,
    });
  }

  /**
   * Record a payment in PENDING (manual upload). Does NOT touch the sales order:
   * only a CONFIRMED payment counts toward what the order has received.
   */
  async record(salesOrderId: string, dto: RecordPaymentDto) {
    const so = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, deletedAt: null },
      select: { id: true },
    });
    if (!so) {
      throw new NotFoundException(`Sales order ${salesOrderId} not found`);
    }
    const method = await this.prisma.paymentMethod.findUnique({
      where: { id: dto.paymentMethodId },
    });
    if (!method) {
      throw new BadRequestException(
        `Payment method ${dto.paymentMethodId} not found`,
      );
    }
    if (method.status !== CounterpartyStatus.ACTIVE) {
      throw new BadRequestException(
        `Payment method ${method.name} is not active`,
      );
    }
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('amount must be greater than zero');
    }

    return this.prisma.payment.create({
      data: {
        salesOrderId,
        paymentMethodId: dto.paymentMethodId,
        amount,
        referenceNumber: dto.referenceNumber ?? null,
        receiptDocumentId: dto.receiptDocumentId ?? null,
        confirmationSource: PaymentConfirmationSource.MANUAL_UPLOAD,
        status: PaymentStatus.PENDING,
      },
      include: PAYMENT_INCLUDE,
    });
  }

  /**
   * Confirm a PENDING payment. In one transaction: mark it CONFIRMED, then
   * re-DERIVE the order's paymentReceivedTotal as the SUM of all CONFIRMED
   * payments (never incremented, so it stays correct under fix-ups or replays),
   * and if confirmed payments now cover the order total and it is at
   * AWAITING_PAYMENT, advance it to PAYMENT_RECEIVED.
   */
  async confirm(paymentId: string, actorId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }
    if (payment.status !== PaymentStatus.PENDING) {
      throw new ConflictException(
        `Payment ${paymentId} is ${payment.status}; only a PENDING payment can be confirmed.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const confirmed = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.CONFIRMED,
          confirmedById: actorId,
        },
        include: PAYMENT_INCLUDE,
      });

      const agg = await tx.payment.aggregate({
        _sum: { amount: true },
        where: {
          salesOrderId: payment.salesOrderId,
          status: PaymentStatus.CONFIRMED,
        },
      });
      const received = agg._sum.amount ?? new Prisma.Decimal(0);

      const so = await tx.salesOrder.findUniqueOrThrow({
        where: { id: payment.salesOrderId },
      });
      const data: Prisma.SalesOrderUpdateInput = {
        paymentReceivedTotal: received,
      };
      if (
        received.gte(so.total) &&
        so.status === SalesOrderStatus.AWAITING_PAYMENT
      ) {
        data.status = SalesOrderStatus.PAYMENT_RECEIVED;
      }
      await tx.salesOrder.update({ where: { id: so.id }, data });

      return confirmed;
    });
  }

  async reject(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }
    if (payment.status !== PaymentStatus.PENDING) {
      throw new ConflictException(
        `Payment ${paymentId} is ${payment.status}; only a PENDING payment can be rejected.`,
      );
    }
    // A rejected payment never counted toward paymentReceivedTotal (only
    // CONFIRMED do), so no re-derivation is needed.
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.REJECTED },
      include: PAYMENT_INCLUDE,
    });
  }
}

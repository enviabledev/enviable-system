import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CounterpartyStatus,
  OverpaymentResolution,
  PaymentConfirmationSource,
  PaymentStatus,
  Prisma,
  RefundMechanism,
  SalesOrderStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecordPaymentDto } from './dto/record-payment.dto';

const PAYMENT_INCLUDE = {
  paymentMethod: { select: { id: true, name: true, status: true } },
} as const;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
   *
   * Overpayment is detected here, not rejected: when the amount exceeds the SO's
   * remaining balance (total minus the sum of CONFIRMED payments, floored at 0
   * since the order may already be overpaid), the caller MUST supply an
   * overpaymentResolution (REFUND or CREDIT) or the request is a 400. The excess
   * and the chosen resolution are stored on the payment row (option a), so the
   * payment and its resolution are one atomic write. The system records the
   * resolution; it does not process the refund or issue the credit. A distinct
   * `payment.overpayment` audit entry is written in the same transaction as the
   * payment so the two commit or roll back together (the AuditInterceptor writes
   * the separate `payment.record` entry post-handler).
   */
  async record(salesOrderId: string, dto: RecordPaymentDto, actorId: string) {
    const so = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, deletedAt: null },
      select: { id: true, total: true },
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

    // Remaining balance is derived against CONFIRMED payments only (consistent
    // with confirm() and cancel()); a pending payment never counts. Floored at 0
    // so any positive payment on an already-fully-paid order is wholly excess.
    const agg = await this.prisma.payment.aggregate({
      _sum: { amount: true },
      where: { salesOrderId, status: PaymentStatus.CONFIRMED },
    });
    const confirmed = agg._sum.amount ?? new Prisma.Decimal(0);
    const remaining = Prisma.Decimal.max(so.total.minus(confirmed), 0);
    const isOverpayment = amount.gt(remaining);
    const overpaymentAmount = isOverpayment ? amount.minus(remaining) : null;

    if (isOverpayment) {
      if (!dto.overpaymentResolution) {
        throw new BadRequestException(
          `Payment of ${amount.toString()} exceeds the remaining balance of ${remaining.toString()} by ${overpaymentAmount!.toString()}. An overpaymentResolution (REFUND or CREDIT) is required to record it.`,
        );
      }
    } else if (dto.overpaymentResolution) {
      // Resolution supplied where there is no overpayment: reject rather than
      // store a meaningless resolution on a normal payment.
      throw new BadRequestException(
        'overpaymentResolution was provided but the payment does not exceed the remaining balance.',
      );
    }

    const isRefund =
      dto.overpaymentResolution === OverpaymentResolution.REFUND;

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          salesOrderId,
          paymentMethodId: dto.paymentMethodId,
          amount,
          referenceNumber: dto.referenceNumber ?? null,
          receiptDocumentId: dto.receiptDocumentId ?? null,
          confirmationSource: PaymentConfirmationSource.MANUAL_UPLOAD,
          status: PaymentStatus.PENDING,
          overpaymentAmount,
          overpaymentResolution: dto.overpaymentResolution ?? null,
          refundMechanism: isRefund ? (dto.refundMechanism as RefundMechanism) : null,
          refundReference: isRefund ? dto.refundReference ?? null : null,
          creditNotes: isOverpayment && !isRefund ? dto.creditNotes ?? null : null,
        },
        include: PAYMENT_INCLUDE,
      });

      if (isOverpayment) {
        // Distinct audit entry for the overpayment event and its resolution,
        // committed atomically with the payment (tx-scoped write).
        await this.audit.write(
          {
            actorUserId: actorId,
            action: 'payment.overpayment',
            entityType: 'Payment',
            entityId: payment.id,
            context: {
              salesOrderId,
              amount: amount.toString(),
              remainingBalance: remaining.toString(),
              overpaymentAmount: overpaymentAmount!.toString(),
              resolution: dto.overpaymentResolution!,
              refundMechanism: isRefund ? dto.refundMechanism! : null,
              refundReference: isRefund ? dto.refundReference ?? null : null,
              creditNotes: !isRefund ? dto.creditNotes ?? null : null,
            },
          },
          tx,
        );
      }

      return payment;
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

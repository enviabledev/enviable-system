import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolationOn } from '../common/prisma-errors';
import { CreateDeliveryNoteDto } from './dto/create-delivery-note.dto';
import { ProofOfDeliveryDto } from './dto/proof-of-delivery.dto';
import { generateDnNumber } from './dn-number';
import { generateWbNumber } from './wb-number';
import { assertSoTransition } from './state-machine';

const S = SalesOrderStatus;

@Injectable()
export class DeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create the delivery note for a released order (at RELEASE_AUTHORISED or
   * PICKING) and walk it through the legal sequence to READY_FOR_DISPATCH in one
   * transaction. Does NOT touch unit status (units already SOLD at release); this
   * tracks physical fulfilment only. PICKING is validated as a step even though
   * no separate picking endpoint exists yet.
   */
  async createDeliveryNote(
    salesOrderId: string,
    dto: CreateDeliveryNoteDto,
    actorId: string,
  ) {
    const so = await this.loadOrder(salesOrderId);
    if (so.status !== S.RELEASE_AUTHORISED && so.status !== S.PICKING) {
      throw new ConflictException(
        `A delivery note can only be created for an order at RELEASE_AUTHORISED or PICKING (current: ${so.status}).`,
      );
    }

    // Validate the full legal path to READY_FOR_DISPATCH.
    const path =
      so.status === S.RELEASE_AUTHORISED
        ? [S.PICKING, S.READY_FOR_DISPATCH]
        : [S.READY_FOR_DISPATCH];
    let cursor: SalesOrderStatus = so.status;
    for (const next of path) {
      assertSoTransition(cursor, next);
      cursor = next;
    }

    return this.prisma.$transaction(async (tx) => {
      const dnNumber = await generateDnNumber(tx);
      const deliveryNote = await tx.deliveryNote.create({
        data: {
          salesOrderId,
          dnNumber,
          preparedById: actorId,
          vehicleReg: dto.vehicleReg ?? null,
          driverName: dto.driverName ?? null,
        },
      });
      await tx.salesOrder.update({
        where: { id: salesOrderId },
        data: { status: S.READY_FOR_DISPATCH },
      });
      return deliveryNote;
    });
  }

  async createWaybill(deliveryNoteId: string) {
    const dn = await this.prisma.deliveryNote.findUnique({
      where: { id: deliveryNoteId },
    });
    if (!dn) {
      throw new NotFoundException(`Delivery note ${deliveryNoteId} not found`);
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const wbNumber = await generateWbNumber(tx);
        return tx.waybill.create({ data: { deliveryNoteId, wbNumber } });
      });
    } catch (err) {
      if (
        isUniqueViolationOn(err, {
          index: 'waybills_deliveryNoteId_key',
          fields: ['deliveryNoteId'],
        })
      ) {
        throw new ConflictException(
          `Delivery note ${deliveryNoteId} already has a waybill (one per delivery note).`,
        );
      }
      throw err;
    }
  }

  async dispatch(salesOrderId: string) {
    const so = await this.loadOrder(salesOrderId);
    assertSoTransition(so.status, S.DISPATCHED);
    return this.prisma.salesOrder.update({
      where: { id: salesOrderId },
      data: { status: S.DISPATCHED, dispatchedAt: new Date() },
    });
  }

  async recordProofOfDelivery(salesOrderId: string, dto: ProofOfDeliveryDto) {
    const so = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, deletedAt: null },
      include: { deliveryNote: true },
    });
    if (!so) {
      throw new NotFoundException(`Sales order ${salesOrderId} not found`);
    }
    assertSoTransition(so.status, S.DELIVERED);
    if (!so.deliveryNote) {
      throw new ConflictException(
        `Sales order ${salesOrderId} has no delivery note; cannot record proof of delivery.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.proofOfDelivery.create({
        data: {
          deliveryNoteId: so.deliveryNote!.id,
          receivedBy: dto.receivedBy ?? null,
          signedAt: dto.signedAt ? new Date(dto.signedAt) : new Date(),
        },
      });
      return tx.salesOrder.update({
        where: { id: salesOrderId },
        data: { status: S.DELIVERED, deliveredAt: new Date() },
      });
    });
  }

  async close(salesOrderId: string) {
    const so = await this.loadOrder(salesOrderId);
    assertSoTransition(so.status, S.CLOSED);
    return this.prisma.salesOrder.update({
      where: { id: salesOrderId },
      data: { status: S.CLOSED },
    });
  }

  private async loadOrder(salesOrderId: string) {
    const so = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, deletedAt: null },
    });
    if (!so) {
      throw new NotFoundException(`Sales order ${salesOrderId} not found`);
    }
    return so;
  }
}

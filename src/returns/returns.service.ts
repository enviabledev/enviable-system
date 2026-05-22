import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MovementReferenceType,
  MovementType,
  ReturnDisposition,
  ReturnStatus,
  UnitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { transitionUnit } from '../units/transition-unit';
import { InitiateReturnDto } from './dto/initiate-return.dto';
import { ResolveReturnDto } from './dto/resolve-return.dto';

const RETURN_INCLUDE = {
  unit: { select: { id: true, engineNumber: true, status: true } },
  salesOrder: { select: { id: true, soNumber: true } },
} as const;

const SOLD_STATES: UnitStatus[] = [
  UnitStatus.SOLD_AS_CKD,
  UnitStatus.SOLD_AS_CBU,
];

@Injectable()
export class ReturnsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.return.findMany({
      orderBy: { initiatedAt: 'desc' },
      include: RETURN_INCLUDE,
    });
  }

  async findOne(id: string) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: RETURN_INCLUDE,
    });
    if (!ret) {
      throw new NotFoundException(`Return ${id} not found`);
    }
    return ret;
  }

  /**
   * Initiate a return for a specific sold unit on a sales order. In one
   * transaction: create the Return (INITIATED) and move the unit from its SOLD
   * state to RETURNED via transitionUnit (movement RETURN, I-3). I-15: the unit
   * must currently be SOLD_AS_CKD or SOLD_AS_CBU, and must belong to this order.
   */
  async initiate(
    salesOrderId: string,
    dto: InitiateReturnDto,
    actorId: string,
  ) {
    const so = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, deletedAt: null },
      select: { id: true },
    });
    if (!so) {
      throw new NotFoundException(`Sales order ${salesOrderId} not found`);
    }
    const unit = await this.prisma.unit.findUnique({
      where: { id: dto.unitId },
    });
    if (!unit) {
      throw new BadRequestException(`Unit ${dto.unitId} not found`);
    }

    // I-15: returns only on a unit currently in a SOLD state.
    if (!SOLD_STATES.includes(unit.status)) {
      throw new ConflictException(
        `Invariant I-15: a return is only allowed on a unit currently in a SOLD state (unit ${unit.engineNumber} is ${unit.status}).`,
      );
    }
    // The unit must belong to the order the return is filed against.
    const line = await this.prisma.salesOrderLine.findFirst({
      where: { salesOrderId, unitId: dto.unitId },
      select: { id: true },
    });
    if (!line) {
      throw new ConflictException(
        `Unit ${unit.engineNumber} is not on sales order ${salesOrderId}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const ret = await tx.return.create({
        data: {
          salesOrderId,
          unitId: dto.unitId,
          initiatedById: actorId,
          reason: dto.reason,
          disposition: ReturnDisposition.PENDING_DECISION,
          status: ReturnStatus.INITIATED,
        },
      });
      await transitionUnit(
        tx,
        dto.unitId,
        UnitStatus.RETURNED,
        MovementType.RETURN,
        {
          actorId,
          referenceType: MovementReferenceType.RETURN,
          referenceId: ret.id,
        },
      );
      return tx.return.findUniqueOrThrow({
        where: { id: ret.id },
        include: RETURN_INCLUDE,
      });
    });
  }

  async inspect(id: string) {
    const ret = await this.prisma.return.findUnique({ where: { id } });
    if (!ret) {
      throw new NotFoundException(`Return ${id} not found`);
    }
    if (ret.status !== ReturnStatus.INITIATED) {
      throw new ConflictException(
        `Return ${id} is ${ret.status}; only an INITIATED return can be inspected.`,
      );
    }
    return this.prisma.return.update({
      where: { id },
      data: { status: ReturnStatus.INSPECTING },
      include: RETURN_INCLUDE,
    });
  }

  /**
   * Resolve an inspected return with a disposition. In one transaction:
   * transition the unit from RETURNED to IN_REPAIR (REPAIR, movement REPAIR_IN)
   * or WRITTEN_OFF (WRITE_OFF, movement WRITE_OFF) via transitionUnit, and set
   * the return RESOLVED with the disposition and decider.
   */
  async resolve(id: string, dto: ResolveReturnDto, actorId: string) {
    if (
      dto.disposition !== ReturnDisposition.REPAIR &&
      dto.disposition !== ReturnDisposition.WRITE_OFF
    ) {
      throw new BadRequestException(
        'disposition must be REPAIR or WRITE_OFF',
      );
    }
    const ret = await this.prisma.return.findUnique({ where: { id } });
    if (!ret) {
      throw new NotFoundException(`Return ${id} not found`);
    }
    if (ret.status !== ReturnStatus.INSPECTING) {
      throw new ConflictException(
        `Return ${id} is ${ret.status}; it must be INSPECTING to resolve.`,
      );
    }

    // WARRANTY HOOK (deferred): warranty-validity tracking is not implemented
    // yet (pending Theresa's contractual answers and a future schema change).
    // When it lands, a warranty-validity check belongs HERE, informing or
    // constraining the disposition (e.g. in-warranty defects routed to REPAIR
    // at no charge, out-of-warranty handled differently). Intentionally a no-op
    // for now; the disposition comes solely from the request.

    const target =
      dto.disposition === ReturnDisposition.REPAIR
        ? UnitStatus.IN_REPAIR
        : UnitStatus.WRITTEN_OFF;
    const movementType =
      dto.disposition === ReturnDisposition.REPAIR
        ? MovementType.REPAIR_IN
        : MovementType.WRITE_OFF;

    return this.prisma.$transaction(async (tx) => {
      await transitionUnit(tx, ret.unitId, target, movementType, {
        actorId,
        referenceType: MovementReferenceType.RETURN,
        referenceId: ret.id,
      });
      return tx.return.update({
        where: { id },
        data: {
          disposition: dto.disposition,
          dispositionDecidedById: actorId,
          dispositionDecidedAt: new Date(),
          status: ReturnStatus.RESOLVED,
        },
        include: RETURN_INCLUDE,
      });
    });
  }
}

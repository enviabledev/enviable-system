import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CounterpartyStatus,
  MovementReferenceType,
  MovementType,
  ReturnDisposition,
  ReturnStatus,
  UnitStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { transitionUnit } from '../units/transition-unit';
import { InitiateReturnDto } from './dto/initiate-return.dto';
import { ResolveReturnDto } from './dto/resolve-return.dto';

const RETURN_INCLUDE = {
  unit: { select: { id: true, engineNumber: true, status: true } },
  salesOrder: { select: { id: true, soNumber: true } },
  supplierWarrantyClaim: true,
} as const;

const SOLD_STATES: UnitStatus[] = [
  UnitStatus.SOLD_AS_CKD,
  UnitStatus.SOLD_AS_CBU,
];

const RESOLVE_DISPOSITIONS: ReturnDisposition[] = [
  ReturnDisposition.REPAIR,
  ReturnDisposition.WRITE_OFF,
  ReturnDisposition.SUPPLIER_WARRANTY_CLAIM,
];

@Injectable()
export class ReturnsService {
  /**
   * Customer warranty term in months, loaded from config (CUSTOMER_WARRANTY_MONTHS,
   * default 12). Wired but not yet consumed: when the warranty-validity hook in
   * `resolve` is activated, it reads this to decide whether a claim falls inside
   * the customer warranty window. See the WARRANTY HOOK note in `resolve`.
   */
  private readonly customerWarrantyMonths: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    const months = Number(config.get<string>('CUSTOMER_WARRANTY_MONTHS'));
    this.customerWarrantyMonths = Number.isFinite(months) && months > 0 ? months : 12;
  }

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
   * transition the unit from RETURNED to its disposition state via transitionUnit
   * (REPAIR -> IN_REPAIR / REPAIR_IN, WRITE_OFF -> WRITTEN_OFF / WRITE_OFF,
   * SUPPLIER_WARRANTY_CLAIM -> CLAIMED_TO_SUPPLIER / ADJUSTMENT), set the return
   * RESOLVED, and for a warranty claim create the SupplierWarrantyClaim and write
   * a distinct claim audit entry, all atomically.
   */
  async resolve(id: string, dto: ResolveReturnDto, actorId: string) {
    if (!RESOLVE_DISPOSITIONS.includes(dto.disposition)) {
      throw new BadRequestException(
        'disposition must be REPAIR, WRITE_OFF, or SUPPLIER_WARRANTY_CLAIM',
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

    // WARRANTY HOOK (deferred, prompt 40): warranty-validity tracking is not
    // implemented yet (pending Theresa's contractual answers and a future schema
    // change). This prompt adds the SUPPLIER_WARRANTY_CLAIM disposition but does
    // NOT activate the hook: whether a claim is in-warranty is not checked here.
    // When the hook lands, the validity check belongs HERE, informing or
    // constraining the disposition, comparing the unit's sale date against
    // `this.customerWarrantyMonths`. Intentionally a no-op for now.

    const isClaim =
      dto.disposition === ReturnDisposition.SUPPLIER_WARRANTY_CLAIM;

    // Validate the supplier for a warranty claim BEFORE opening the transaction.
    if (isClaim) {
      if (!dto.supplierCounterpartyId) {
        throw new BadRequestException(
          'supplierCounterpartyId is required for a SUPPLIER_WARRANTY_CLAIM disposition.',
        );
      }
      const supplier = await this.prisma.counterparty.findFirst({
        where: { id: dto.supplierCounterpartyId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!supplier) {
        throw new BadRequestException(
          `Counterparty ${dto.supplierCounterpartyId} not found.`,
        );
      }
      if (supplier.status !== CounterpartyStatus.ACTIVE) {
        throw new BadRequestException(
          `Counterparty ${dto.supplierCounterpartyId} is not active.`,
        );
      }
    }

    const target = isClaim
      ? UnitStatus.CLAIMED_TO_SUPPLIER
      : dto.disposition === ReturnDisposition.REPAIR
        ? UnitStatus.IN_REPAIR
        : UnitStatus.WRITTEN_OFF;
    const movementType = isClaim
      ? MovementType.ADJUSTMENT
      : dto.disposition === ReturnDisposition.REPAIR
        ? MovementType.REPAIR_IN
        : MovementType.WRITE_OFF;

    return this.prisma.$transaction(async (tx) => {
      await transitionUnit(tx, ret.unitId, target, movementType, {
        actorId,
        referenceType: MovementReferenceType.RETURN,
        referenceId: ret.id,
      });

      if (isClaim) {
        const claim = await tx.supplierWarrantyClaim.create({
          data: {
            returnId: ret.id,
            supplierCounterpartyId: dto.supplierCounterpartyId,
            claimReference: dto.claimReference ?? null,
            claimNotes: dto.claimNotes ?? null,
          },
        });
        // Distinct audit entry for the warranty claim, committed atomically with
        // the resolution (tx-scoped). The return.resolve interceptor entry still
        // records the disposition on the return.
        await this.audit.write(
          {
            actorUserId: actorId,
            action: 'return.warrantyclaim',
            entityType: 'SupplierWarrantyClaim',
            entityId: claim.id,
            context: {
              returnId: ret.id,
              unitId: ret.unitId,
              supplierCounterpartyId: dto.supplierCounterpartyId,
              claimReference: dto.claimReference ?? null,
              claimNotes: dto.claimNotes ?? null,
            },
          },
          tx,
        );
      }

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

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LandedCostAllocationMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLandedCostDto } from './dto/create-landed-cost.dto';
import { UpdateLandedCostDto } from './dto/update-landed-cost.dto';
import { allocateEqualPerUnitCents } from './landed-cost-allocation';

@Injectable()
export class LandedCostsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(shipmentId: string) {
    await this.assertShipment(shipmentId);
    return this.prisma.landedCost.findMany({
      where: { shipmentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addComponent(shipmentId: string, dto: CreateLandedCostDto) {
    await this.assertShipment(shipmentId);
    this.assertEqualPerUnit(dto.allocationMethod);
    if (dto.counterpartyId) {
      await this.assertCounterparty(dto.counterpartyId);
    }
    return this.prisma.landedCost.create({
      data: {
        shipmentId,
        componentType: dto.componentType,
        amount: new Prisma.Decimal(dto.amount),
        currency: dto.currency,
        exchangeRateToBase: dto.exchangeRateToBase
          ? new Prisma.Decimal(dto.exchangeRateToBase)
          : null,
        counterpartyId: dto.counterpartyId ?? null,
        allocationMethod:
          dto.allocationMethod ?? LandedCostAllocationMethod.EQUAL_PER_UNIT,
        ...(dto.status ? { status: dto.status } : {}),
        invoiceDocumentId: dto.invoiceDocumentId ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateLandedCostDto) {
    const existing = await this.prisma.landedCost.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Landed cost component ${id} not found`);
    }
    this.assertEqualPerUnit(dto.allocationMethod);
    if (dto.counterpartyId) {
      await this.assertCounterparty(dto.counterpartyId);
    }
    const data: Prisma.LandedCostUncheckedUpdateInput = {};
    if (dto.componentType !== undefined) data.componentType = dto.componentType;
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.exchangeRateToBase !== undefined)
      data.exchangeRateToBase = dto.exchangeRateToBase
        ? new Prisma.Decimal(dto.exchangeRateToBase)
        : null;
    if (dto.counterpartyId !== undefined)
      data.counterpartyId = dto.counterpartyId;
    if (dto.allocationMethod !== undefined)
      data.allocationMethod = dto.allocationMethod;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.invoiceDocumentId !== undefined)
      data.invoiceDocumentId = dto.invoiceDocumentId;
    return this.prisma.landedCost.update({ where: { id }, data });
  }

  /**
   * Sum every component for the shipment (converted to base currency via
   * exchangeRateToBase) into integer cents, then divide EQUAL_PER_UNIT across
   * the shipment's units. The remainder pennies go to the first units sorted by
   * engineNumber, so the per-unit cents sum back to the total exactly. Idempotent:
   * re-running recomputes the same values and overwrites.
   */
  async allocate(shipmentId: string) {
    await this.assertShipment(shipmentId);
    const components = await this.prisma.landedCost.findMany({
      where: { shipmentId },
    });
    for (const component of components) {
      if (
        component.allocationMethod !==
        LandedCostAllocationMethod.EQUAL_PER_UNIT
      ) {
        throw new BadRequestException(
          `Allocation method ${component.allocationMethod} is not supported at MVP (only EQUAL_PER_UNIT).`,
        );
      }
    }

    let totalBase = new Prisma.Decimal(0);
    for (const component of components) {
      const rate = component.exchangeRateToBase ?? new Prisma.Decimal(1);
      totalBase = totalBase.add(new Prisma.Decimal(component.amount).mul(rate));
    }
    const totalCents = Number(
      totalBase
        .mul(100)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
        .toString(),
    );

    const units = await this.prisma.unit.findMany({
      where: { shipmentId },
      orderBy: { engineNumber: 'asc' },
      select: { id: true },
    });
    if (units.length === 0) {
      throw new BadRequestException(
        'No units to allocate landed cost across for this shipment',
      );
    }

    const cents = allocateEqualPerUnitCents(totalCents, units.length);
    await this.prisma.$transaction(
      units.map((unit, i) =>
        this.prisma.unit.update({
          where: { id: unit.id },
          data: { landedCost: new Prisma.Decimal(cents[i]).div(100) },
        }),
      ),
    );

    return this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        units: {
          select: {
            id: true,
            engineNumber: true,
            status: true,
            landedCost: true,
          },
          orderBy: { engineNumber: 'asc' },
        },
      },
    });
  }

  private assertEqualPerUnit(method?: LandedCostAllocationMethod): void {
    if (method && method !== LandedCostAllocationMethod.EQUAL_PER_UNIT) {
      throw new BadRequestException(
        `Allocation method ${method} is not supported at MVP (only EQUAL_PER_UNIT).`,
      );
    }
  }

  private async assertShipment(id: string): Promise<void> {
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }
  }

  private async assertCounterparty(id: string): Promise<void> {
    const counterparty = await this.prisma.counterparty.findFirst({
      where: { id, deletedAt: null },
    });
    if (!counterparty) {
      throw new BadRequestException(`Counterparty ${id} not found`);
    }
  }
}

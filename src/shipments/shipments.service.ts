import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MovementReferenceType,
  MovementType,
  Prisma,
  PurchaseOrderStatus,
  ShipmentStatus,
  UnitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ManifestLineDto } from './dto/manifest-line.dto';
import { QueryShipmentsDto } from './dto/query-shipments.dto';
import { ReceiveUnitsDto } from './dto/receive-units.dto';
import { ResolveVarianceDto } from './dto/resolve-variance.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { generateShipmentReference } from './shipment-reference';
import {
  assertManifestEditable,
  assertReachableViaPatch,
  assertShipmentTransition,
} from './state-machine';

/**
 * Identify a P2002 unique violation on the unit engine/chassis number, as a
 * safety net for any race the pre-check misses. Prisma 6 may surface the
 * offender in meta.target (string or string[]) or meta.constraint.
 */
function uniqueUnitField(
  err: unknown,
): 'engineNumber' | 'chassisNumber' | null {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002'
  ) {
    const meta = (err.meta ?? {}) as { target?: unknown; constraint?: unknown };
    const haystack = [
      Array.isArray(meta.target) ? meta.target.join(',') : String(meta.target ?? ''),
      String(meta.constraint ?? ''),
    ].join(' ');
    if (haystack.includes('engineNumber')) return 'engineNumber';
    if (haystack.includes('chassisNumber')) return 'chassisNumber';
  }
  return null;
}

const CP_SUMMARY = { select: { id: true, name: true, type: true } } as const;

const SHIPMENT_INCLUDE = {
  manifestLines: true,
  freightForwarder: CP_SUMMARY,
  clearingAgent: CP_SUMMARY,
  insuranceCompany: CP_SUMMARY,
  // Units carry landedCost. Exposing them on the (non-cost-gated) shipment
  // detail lets the global CostVisibilityInterceptor strip landedCost for
  // callers without costdata.view (Invariant I-8).
  units: {
    select: {
      id: true,
      engineNumber: true,
      status: true,
      landedCost: true,
    },
    orderBy: { engineNumber: 'asc' },
  },
} as const;

@Injectable()
export class ShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: QueryShipmentsDto) {
    return this.prisma.shipment.findMany({
      where: {
        ...(query.purchaseOrderId
          ? { purchaseOrderId: query.purchaseOrderId }
          : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { manifestLines: true },
    });
  }

  async findOne(id: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: SHIPMENT_INCLUDE,
    });
    if (!shipment) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }
    return shipment;
  }

  async create(purchaseOrderId: string, dto: CreateShipmentDto) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, deletedAt: null },
    });
    if (!po) {
      throw new NotFoundException(
        `Purchase order ${purchaseOrderId} not found`,
      );
    }
    await this.assertVariantsExist(dto.manifestLines);
    await this.assertCounterpartiesExist([
      dto.freightForwarderId,
      dto.clearingAgentId,
      dto.insuranceCompanyId,
    ]);

    return this.prisma.$transaction(async (tx) => {
      const shipmentReference = await generateShipmentReference(tx);
      return tx.shipment.create({
        data: {
          purchaseOrderId,
          shipmentReference,
          billOfLadingNumber: dto.billOfLadingNumber ?? null,
          vesselName: dto.vesselName ?? null,
          etd: dto.etd ? new Date(dto.etd) : null,
          eta: dto.eta ? new Date(dto.eta) : null,
          freightForwarderId: dto.freightForwarderId ?? null,
          clearingAgentId: dto.clearingAgentId ?? null,
          insuranceCompanyId: dto.insuranceCompanyId ?? null,
          isHistoricalImport: dto.isHistoricalImport ?? false,
          // status defaults to IN_TRANSIT; manifest lines default
          // quantityReceived=0 and variance=0.
          manifestLines: {
            create: dto.manifestLines.map((line) => ({
              productVariantId: line.productVariantId,
              quantityDeclared: line.quantityDeclared,
            })),
          },
        },
        include: SHIPMENT_INCLUDE,
      });
    });
  }

  async update(id: string, dto: UpdateShipmentDto) {
    const shipment = await this.findOne(id);

    if (dto.manifestLines) {
      assertManifestEditable(shipment.status);
      await this.assertVariantsExist(dto.manifestLines);
    }

    // Unchecked update input so scalar FK columns are settable directly (the
    // checked input hides them behind relation connects).
    const data: Prisma.ShipmentUncheckedUpdateInput = {};
    if (dto.billOfLadingNumber !== undefined)
      data.billOfLadingNumber = dto.billOfLadingNumber;
    if (dto.vesselName !== undefined) data.vesselName = dto.vesselName;
    if (dto.freightForwarderId !== undefined)
      data.freightForwarderId = dto.freightForwarderId;
    if (dto.clearingAgentId !== undefined)
      data.clearingAgentId = dto.clearingAgentId;
    if (dto.insuranceCompanyId !== undefined)
      data.insuranceCompanyId = dto.insuranceCompanyId;
    if (dto.isHistoricalImport !== undefined)
      data.isHistoricalImport = dto.isHistoricalImport;
    if (dto.etd !== undefined) data.etd = dto.etd ? new Date(dto.etd) : null;
    if (dto.eta !== undefined) data.eta = dto.eta ? new Date(dto.eta) : null;
    if (dto.arrivalDate !== undefined)
      data.arrivalDate = dto.arrivalDate ? new Date(dto.arrivalDate) : null;
    if (dto.clearingStartedAt !== undefined)
      data.clearingStartedAt = dto.clearingStartedAt
        ? new Date(dto.clearingStartedAt)
        : null;
    if (dto.clearedAt !== undefined)
      data.clearedAt = dto.clearedAt ? new Date(dto.clearedAt) : null;

    if (dto.status) {
      assertReachableViaPatch(dto.status);
      assertShipmentTransition(shipment.status, dto.status);
      data.status = dto.status;
      // Auto-stamp the timestamp for the new status unless explicitly provided.
      const now = new Date();
      if (dto.status === ShipmentStatus.AT_PORT && dto.arrivalDate === undefined)
        data.arrivalDate = now;
      if (
        dto.status === ShipmentStatus.CLEARING &&
        dto.clearingStartedAt === undefined
      )
        data.clearingStartedAt = now;
      if (dto.status === ShipmentStatus.CLEARED && dto.clearedAt === undefined)
        data.clearedAt = now;
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.manifestLines) {
        await tx.manifestLine.deleteMany({ where: { shipmentId: id } });
        await tx.manifestLine.createMany({
          data: dto.manifestLines.map((line) => ({
            shipmentId: id,
            productVariantId: line.productVariantId,
            quantityDeclared: line.quantityDeclared,
          })),
        });
      }
      return tx.shipment.update({
        where: { id },
        data,
        include: SHIPMENT_INCLUDE,
      });
    });
  }

  async receiveUnits(
    shipmentId: string,
    dto: ReceiveUnitsDto,
    actorUserId: string,
  ) {
    const pairs = dto.lines.flatMap((line) =>
      line.units.map((unit) => ({
        manifestLineId: line.manifestLineId,
        engineNumber: unit.engineNumber,
        chassisNumber: unit.chassisNumber,
      })),
    );

    // Pre-flight: reject in-batch duplicates naming the offending number.
    const seenEngine = new Set<string>();
    const seenChassis = new Set<string>();
    for (const pair of pairs) {
      if (seenEngine.has(pair.engineNumber)) {
        throw new ConflictException(
          `Duplicate engineNumber in request batch: ${pair.engineNumber}`,
        );
      }
      if (seenChassis.has(pair.chassisNumber)) {
        throw new ConflictException(
          `Duplicate chassisNumber in request batch: ${pair.chassisNumber}`,
        );
      }
      seenEngine.add(pair.engineNumber);
      seenChassis.add(pair.chassisNumber);
    }

    // Pre-flight: reject duplicates against the DB naming the offending number.
    const dupEngine = await this.prisma.unit.findFirst({
      where: { engineNumber: { in: [...seenEngine] } },
      select: { engineNumber: true },
    });
    if (dupEngine) {
      throw new ConflictException(
        `engineNumber already exists: ${dupEngine.engineNumber}`,
      );
    }
    const dupChassis = await this.prisma.unit.findFirst({
      where: { chassisNumber: { in: [...seenChassis] } },
      select: { chassisNumber: true },
    });
    if (dupChassis) {
      throw new ConflictException(
        `chassisNumber already exists: ${dupChassis.chassisNumber}`,
      );
    }

    const warehouseId = await this.defaultWarehouseId();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const shipment = await tx.shipment.findUnique({
          where: { id: shipmentId },
          include: { manifestLines: true },
        });
        if (!shipment) {
          throw new NotFoundException(`Shipment ${shipmentId} not found`);
        }
        if (shipment.status !== ShipmentStatus.CLEARED) {
          throw new ConflictException(
            `Shipment must be CLEARED to receive units (current: ${shipment.status}).`,
          );
        }

        const lineById = new Map(
          shipment.manifestLines.map((line) => [line.id, line]),
        );
        for (const line of dto.lines) {
          if (!lineById.has(line.manifestLineId)) {
            throw new BadRequestException(
              `Manifest line ${line.manifestLineId} is not on this shipment`,
            );
          }
        }

        // I-3: each Unit and its RECEIPT StockMovement are created in the same
        // transaction. There is no code path that creates a Unit without its
        // movement. A duplicate (in-batch or against the DB) rolls the whole
        // transaction back, so no partial batch is ever written.
        for (const pair of pairs) {
          const manifestLine = lineById.get(pair.manifestLineId)!;
          const unit = await tx.unit.create({
            data: {
              productVariantId: manifestLine.productVariantId,
              shipmentId,
              engineNumber: pair.engineNumber,
              chassisNumber: pair.chassisNumber,
              status: UnitStatus.IN_WAREHOUSE_CKD,
              currentWarehouseId: warehouseId,
              // landedCost stays null at receipt; set in the landed-cost prompt.
            },
          });
          await tx.stockMovement.create({
            data: {
              unitId: unit.id,
              movementType: MovementType.RECEIPT,
              fromState: null,
              toState: UnitStatus.IN_WAREHOUSE_CKD,
              toWarehouseId: warehouseId,
              referenceType: MovementReferenceType.SHIPMENT,
              referenceId: shipmentId,
              actorId: actorUserId,
            },
          });
        }

        // Update each manifest line's quantityReceived (accumulating across
        // partial receipts) and recompute variance = received - declared.
        for (const line of dto.lines) {
          const manifestLine = lineById.get(line.manifestLineId)!;
          const newReceived = manifestLine.quantityReceived + line.units.length;
          await tx.manifestLine.update({
            where: { id: manifestLine.id },
            data: {
              quantityReceived: newReceived,
              variance: newReceived - manifestLine.quantityDeclared,
            },
          });
        }

        return tx.shipment.findUnique({
          where: { id: shipmentId },
          include: SHIPMENT_INCLUDE,
        });
      });
    } catch (err) {
      const field = uniqueUnitField(err);
      if (field) {
        throw new ConflictException(
          `Duplicate ${field}: a unit with this ${field} already exists (unique violation).`,
        );
      }
      throw err;
    }
  }

  async resolveVariance(shipmentId: string, dto: ResolveVarianceDto) {
    const shipment = await this.findOne(shipmentId);
    const lineIds = new Set(shipment.manifestLines.map((line) => line.id));
    for (const line of dto.lines) {
      if (!lineIds.has(line.manifestLineId)) {
        throw new BadRequestException(
          `Manifest line ${line.manifestLineId} is not on this shipment`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      for (const line of dto.lines) {
        await tx.manifestLine.update({
          where: { id: line.manifestLineId },
          data: {
            varianceReason: line.varianceReason,
            varianceResolvedAt: new Date(),
          },
        });
      }
      return tx.shipment.findUnique({
        where: { id: shipmentId },
        include: SHIPMENT_INCLUDE,
      });
    });
  }

  async completeReceipt(shipmentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findUnique({
        where: { id: shipmentId },
      });
      if (!shipment) {
        throw new NotFoundException(`Shipment ${shipmentId} not found`);
      }
      assertShipmentTransition(shipment.status, ShipmentStatus.RECEIVED);
      await tx.shipment.update({
        where: { id: shipmentId },
        data: { status: ShipmentStatus.RECEIVED, receivedAt: new Date() },
      });

      // I-6: aggregate received across ALL of the PO's shipments versus total
      // ordered, and set the PO to FULLY_RECEIVED or PARTIALLY_RECEIVED. This
      // is a cross-aggregate domain effect, not a user-initiated PO transition,
      // so it is not routed through assertPoTransition.
      const purchaseOrderId = shipment.purchaseOrderId;
      const received = await tx.manifestLine.aggregate({
        _sum: { quantityReceived: true },
        where: { shipment: { purchaseOrderId } },
      });
      const ordered = await tx.purchaseOrderLine.aggregate({
        _sum: { quantityOrdered: true },
        where: { purchaseOrderId },
      });
      const totalReceived = received._sum.quantityReceived ?? 0;
      const totalOrdered = ordered._sum.quantityOrdered ?? 0;
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status:
            totalReceived >= totalOrdered
              ? PurchaseOrderStatus.FULLY_RECEIVED
              : PurchaseOrderStatus.PARTIALLY_RECEIVED,
        },
      });

      return tx.shipment.findUnique({
        where: { id: shipmentId },
        include: SHIPMENT_INCLUDE,
      });
    });
  }

  async close(shipmentId: string) {
    const shipment = await this.findOne(shipmentId);
    assertShipmentTransition(shipment.status, ShipmentStatus.CLOSED);

    // I-7: a shipment cannot close with an unresolved variance (non-zero
    // variance and no varianceResolvedAt).
    const unresolved = shipment.manifestLines.find(
      (line) => line.variance !== 0 && line.varianceResolvedAt === null,
    );
    if (unresolved) {
      throw new ConflictException(
        `Cannot close shipment: manifest line ${unresolved.id} has an unresolved variance of ${unresolved.variance} (Invariant I-7). Resolve it first.`,
      );
    }

    return this.prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: ShipmentStatus.CLOSED },
      include: SHIPMENT_INCLUDE,
    });
  }

  // MVP is single-warehouse (Lagos Main). Multi-warehouse receipt will take a
  // warehouseId parameter; for now the sole warehouse is resolved here.
  private async defaultWarehouseId(): Promise<string> {
    const warehouse = await this.prisma.warehouse.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!warehouse) {
      throw new BadRequestException('No warehouse configured');
    }
    return warehouse.id;
  }

  private async assertVariantsExist(lines: ManifestLineDto[]): Promise<void> {
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

  private async assertCounterpartiesExist(
    ids: (string | undefined)[],
  ): Promise<void> {
    const present = [...new Set(ids.filter((id): id is string => !!id))];
    if (present.length === 0) {
      return;
    }
    const count = await this.prisma.counterparty.count({
      where: { id: { in: present }, deletedAt: null },
    });
    if (count !== present.length) {
      throw new BadRequestException(
        'One or more counterparty references are invalid',
      );
    }
  }
}

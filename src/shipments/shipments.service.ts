import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ManifestLineDto } from './dto/manifest-line.dto';
import { QueryShipmentsDto } from './dto/query-shipments.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { generateShipmentReference } from './shipment-reference';
import {
  assertManifestEditable,
  assertReachableViaPatch,
  assertShipmentTransition,
} from './state-machine';

const CP_SUMMARY = { select: { id: true, name: true, type: true } } as const;

const SHIPMENT_INCLUDE = {
  manifestLines: true,
  freightForwarder: CP_SUMMARY,
  clearingAgent: CP_SUMMARY,
  insuranceCompany: CP_SUMMARY,
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

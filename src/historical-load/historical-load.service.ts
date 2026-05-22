import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MovementReferenceType,
  MovementType,
  Prisma,
  ProformaInvoiceStatus,
  PurchaseOrderStatus,
  ShipmentStatus,
  SparePartMovementType,
  UnitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generatePoNumber } from '../purchase-orders/po-number';
import { generateShipmentReference } from '../shipments/shipment-reference';
import {
  csvRowNumber,
  detectInFileUnitDuplicates,
  parseCsv,
  RowError,
} from './csv-rows';
import { CreateHistoricalShipmentDto } from './dto/create-historical-shipment.dto';

const UNIT_BATCH_SIZE = 500;

@Injectable()
export class HistoricalLoadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create the one-off PO + PI + Shipment representing a historical arrival, in
   * one transaction. They are created directly in terminal states (PO CLOSED,
   * PI ACTIVE, Shipment RECEIVED) because they never flowed through the
   * workflow; isHistoricalImport marks the shipment as loaded-not-transacted.
   */
  async createHistoricalShipment(dto: CreateHistoricalShipmentDto) {
    const supplier = await this.prisma.counterparty.findFirst({
      where: { id: dto.supplierId, deletedAt: null },
    });
    if (!supplier) {
      throw new BadRequestException(
        `Supplier ${dto.supplierId} not found or inactive`,
      );
    }
    const total = new Prisma.Decimal(dto.totalValue ?? '0');
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const poNumber = dto.poNumber ?? (await generatePoNumber(tx));
      const shipmentReference =
        dto.shipmentReference ?? (await generateShipmentReference(tx));

      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId: dto.supplierId,
          currency: dto.currency,
          status: PurchaseOrderStatus.CLOSED,
          totalValue: total,
          closedAt: now,
        },
      });
      const proformaInvoice = await tx.proformaInvoice.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          piNumber: dto.piNumber,
          revisionNumber: 1,
          status: ProformaInvoiceStatus.ACTIVE,
          totalValue: total,
          approvedAt: now,
        },
      });
      const shipment = await tx.shipment.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          shipmentReference,
          status: ShipmentStatus.RECEIVED,
          isHistoricalImport: true,
          receivedAt: now,
          vesselName: dto.vesselName ?? null,
          billOfLadingNumber: dto.billOfLadingNumber ?? null,
          etd: dto.etd ? new Date(dto.etd) : null,
          eta: dto.eta ? new Date(dto.eta) : null,
          arrivalDate: dto.arrivalDate ? new Date(dto.arrivalDate) : null,
        },
      });

      // Top-level id is the shipment id so the AuditInterceptor records it.
      return { id: shipment.id, purchaseOrder, proformaInvoice, shipment };
    });
  }

  async loadUnits(
    shipmentId: string,
    file: Express.Multer.File | undefined,
    dryRun: boolean,
    actorUserId: string,
  ) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
    });
    if (!shipment) {
      throw new NotFoundException(`Shipment ${shipmentId} not found`);
    }
    if (!file) {
      throw new BadRequestException('CSV file is required (multipart field "file")');
    }

    const { records, error } = parseCsv(file.buffer, [
      'productVariantSku',
      'engineNumber',
      'chassisNumber',
    ]);
    if (error) {
      throw new BadRequestException(error);
    }

    const rows = records.map((r) => ({
      productVariantSku: r.productVariantSku,
      engineNumber: r.engineNumber,
      chassisNumber: r.chassisNumber,
    }));

    const errors: RowError[] = [];
    rows.forEach((r, i) => {
      const row = csvRowNumber(i);
      if (!r.productVariantSku)
        errors.push({ row, message: 'missing productVariantSku' });
      if (!r.engineNumber) errors.push({ row, message: 'missing engineNumber' });
      if (!r.chassisNumber)
        errors.push({ row, message: 'missing chassisNumber' });
    });

    // SKU resolution against productVariant.supplierSkuCode.
    const skus = [
      ...new Set(rows.map((r) => r.productVariantSku).filter(Boolean)),
    ];
    const variants = await this.prisma.productVariant.findMany({
      where: { supplierSkuCode: { in: skus } },
      select: { id: true, supplierSkuCode: true },
    });
    const skuToId = new Map(variants.map((v) => [v.supplierSkuCode, v.id]));
    rows.forEach((r, i) => {
      if (r.productVariantSku && !skuToId.has(r.productVariantSku)) {
        errors.push({
          row: csvRowNumber(i),
          message: `unknown productVariantSku: ${r.productVariantSku}`,
        });
      }
    });

    // In-file duplicates.
    errors.push(...detectInFileUnitDuplicates(rows));

    // Against-DB duplicates.
    const existing = await this.prisma.unit.findMany({
      where: {
        OR: [
          { engineNumber: { in: rows.map((r) => r.engineNumber).filter(Boolean) } },
          { chassisNumber: { in: rows.map((r) => r.chassisNumber).filter(Boolean) } },
        ],
      },
      select: { engineNumber: true, chassisNumber: true },
    });
    const existEngine = new Set(existing.map((u) => u.engineNumber));
    const existChassis = new Set(existing.map((u) => u.chassisNumber));
    rows.forEach((r, i) => {
      const row = csvRowNumber(i);
      if (r.engineNumber && existEngine.has(r.engineNumber))
        errors.push({
          row,
          message: `engineNumber already exists in DB: ${r.engineNumber}`,
        });
      if (r.chassisNumber && existChassis.has(r.chassisNumber))
        errors.push({
          row,
          message: `chassisNumber already exists in DB: ${r.chassisNumber}`,
        });
    });

    errors.sort((a, b) => a.row - b.row);
    const report = {
      shipmentId,
      totalRows: rows.length,
      validRows: rows.length - new Set(errors.map((e) => e.row)).size,
      errorCount: errors.length,
      errors,
    };

    if (dryRun) {
      return { dryRun: true, ...report };
    }
    if (errors.length > 0) {
      // All-or-nothing: reject the whole commit, write nothing.
      throw new BadRequestException({
        message:
          'Historical unit load rejected: validation errors. Nothing was written.',
        dryRun: false,
        ...report,
      });
    }

    const warehouseId = await this.defaultWarehouseId();
    let created = 0;
    // Batched transactions for performance; each Unit and its RECEIPT movement
    // are still created together in the same transaction (I-3).
    for (let start = 0; start < rows.length; start += UNIT_BATCH_SIZE) {
      const batch = rows.slice(start, start + UNIT_BATCH_SIZE);
      await this.prisma.$transaction(async (tx) => {
        for (const r of batch) {
          const unit = await tx.unit.create({
            data: {
              productVariantId: skuToId.get(r.productVariantSku)!,
              shipmentId,
              engineNumber: r.engineNumber,
              chassisNumber: r.chassisNumber,
              status: UnitStatus.IN_WAREHOUSE_CKD,
              currentWarehouseId: warehouseId,
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
          created += 1;
        }
      });
    }
    return { id: shipmentId, dryRun: false, created, totalRows: rows.length };
  }

  async loadSpareParts(
    file: Express.Multer.File | undefined,
    dryRun: boolean,
    actorUserId: string,
  ) {
    if (!file) {
      throw new BadRequestException('CSV file is required (multipart field "file")');
    }
    const { records, error } = parseCsv(file.buffer, ['sku', 'name', 'quantity']);
    if (error) {
      throw new BadRequestException(error);
    }

    const errors: RowError[] = [];
    const parsed = records.map((r, i) => {
      const row = csvRowNumber(i);
      if (!r.sku) errors.push({ row, message: 'missing sku' });
      if (!r.name) errors.push({ row, message: 'missing name' });
      const quantity = Number(r.quantity);
      if (!r.quantity || !Number.isInteger(quantity) || quantity <= 0) {
        errors.push({ row, message: `invalid quantity: ${r.quantity}` });
      }
      return { sku: r.sku, name: r.name, quantity };
    });

    errors.sort((a, b) => a.row - b.row);
    const report = {
      totalRows: records.length,
      validRows: records.length - new Set(errors.map((e) => e.row)).size,
      errorCount: errors.length,
      errors,
    };

    if (dryRun) {
      return { dryRun: true, ...report };
    }
    if (errors.length > 0) {
      throw new BadRequestException({
        message:
          'Historical spare-part load rejected: validation errors. Nothing was written.',
        dryRun: false,
        ...report,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const r of parsed) {
        const sparePart = await tx.sparePart.upsert({
          where: { sku: r.sku },
          update: { quantityOnHand: { increment: r.quantity }, name: r.name },
          create: { sku: r.sku, name: r.name, quantityOnHand: r.quantity },
        });
        await tx.sparePartMovement.create({
          data: {
            sparePartId: sparePart.id,
            movementType: SparePartMovementType.RECEIPT,
            quantity: r.quantity,
            actorId: actorUserId,
          },
        });
      }
    });
    return { dryRun: false, created: parsed.length };
  }

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
}

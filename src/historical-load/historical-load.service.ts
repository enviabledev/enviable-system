import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MovementReferenceType,
  MovementType,
  Prisma,
  ProductStatus,
  ProformaInvoiceStatus,
  PurchaseOrderStatus,
  ShipmentStatus,
  SparePartMovementType,
  UnitStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { discontinuedVariantMessage } from '../products/variant-status';
import {
  createAutoVariant,
  findSimilarVariant,
  levenshtein,
  SimilarVariantMatch,
  VariantCandidate,
} from '../products/variant-auto-create';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
    overrideSimilarityCheck = false,
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

    // SKU resolution against productVariant.supplierSkuCode. Unknown SKUs are no
    // longer rejected: the supply side auto-creates a variant the first time a
    // SKU appears (the catalogue emerges from procurement, it does not gate it).
    // Resolution has three outcomes per SKU: exact existing match (use it),
    // similar-to-existing (block for the user to confirm, unless overridden), or
    // genuinely new (auto-create on commit).
    const skus = [
      ...new Set(rows.map((r) => r.productVariantSku).filter(Boolean)),
    ];
    const variants = await this.prisma.productVariant.findMany({
      where: { supplierSkuCode: { in: skus } },
      select: { id: true, supplierSkuCode: true, status: true },
    });
    const skuToId = new Map(variants.map((v) => [v.supplierSkuCode, v.id]));
    // Exact match against a discontinued variant is still blocked: backfilling a
    // wound-down item needs a deliberate reactivate-load-deactivate (unchanged).
    const discontinuedSkus = new Set(
      variants
        .filter((v) => v.status === ProductStatus.DISCONTINUED)
        .map((v) => v.supplierSkuCode),
    );

    // SKUs with no exact match are auto-create candidates.
    const unknownSkus = skus.filter((s) => !skuToId.has(s));

    // Similarity gate: each unknown SKU is checked against existing ACTIVE
    // variants. A near match (likely typo) blocks so the user can choose "use
    // existing" (fix the SKU) or "create new anyway" (resubmit with
    // overrideSimilarityCheck=true). The override skips this gate entirely.
    const similarSkus = new Map<string, SimilarVariantMatch>();
    // Intra-file near-duplicates: two DIFFERENT unknown SKUs in THIS upload that
    // are near-identical to each other. The DB gate above only compares against
    // already-persisted variants, so without this both would auto-create and
    // mint a typo'd duplicate pair in one shot. Also bypassed by the override.
    const intraFileSimilarSkus = new Map<string, string>();
    if (!overrideSimilarityCheck && unknownSkus.length > 0) {
      const candidates: VariantCandidate[] =
        await this.prisma.productVariant.findMany({
          where: { status: ProductStatus.ACTIVE },
          select: { id: true, supplierSkuCode: true },
        });
      for (const s of unknownSkus) {
        const match = findSimilarVariant(s, candidates);
        if (match) similarSkus.set(s, match);
      }
      // O(n^2) over unknown SKUs only (typically a tiny set); flag each member
      // of a near-identical pair, pointing at the other.
      for (let a = 0; a < unknownSkus.length; a++) {
        for (let b = a + 1; b < unknownSkus.length; b++) {
          const x = unknownSkus[a];
          const y = unknownSkus[b];
          const threshold = x.length > 20 ? 3 : x.length > 10 ? 2 : 1;
          if (levenshtein(x, y) <= threshold) {
            if (!intraFileSimilarSkus.has(x)) intraFileSimilarSkus.set(x, y);
            if (!intraFileSimilarSkus.has(y)) intraFileSimilarSkus.set(y, x);
          }
        }
      }
    }

    rows.forEach((r, i) => {
      if (!r.productVariantSku) return;
      const sku = r.productVariantSku;
      const row = csvRowNumber(i);
      if (skuToId.has(sku)) {
        if (discontinuedSkus.has(sku)) {
          errors.push({
            row,
            message: discontinuedVariantMessage([sku], 'units'),
          });
        }
        return; // exact ACTIVE match resolves cleanly
      }
      const match = similarSkus.get(sku);
      if (match) {
        errors.push({
          row,
          message:
            `SKU "${sku}" is similar to existing variant ` +
            `"${match.supplierSkuCode}" (id: ${match.id}). Use the existing ` +
            `variant, create a new one anyway (resubmit with ` +
            `overrideSimilarityCheck=true), or fix the SKU.`,
        });
        return;
      }
      const twin = intraFileSimilarSkus.get(sku);
      if (twin) {
        errors.push({
          row,
          message:
            `SKU "${sku}" is near-identical to "${twin}" elsewhere in this ` +
            `upload and neither exists yet. Fix the typo, or resubmit with ` +
            `overrideSimilarityCheck=true to create both.`,
        });
      }
      // otherwise: genuinely new, auto-created on commit
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
    // SKUs that will be auto-created on commit: unknown, and not held back by a
    // similarity or intra-file finding. Surfaced so a dry-run shows exactly what
    // new catalogue entries a commit would mint.
    const wouldAutoCreate = unknownSkus.filter(
      (s) => !similarSkus.has(s) && !intraFileSimilarSkus.has(s),
    );
    const report = {
      shipmentId,
      totalRows: rows.length,
      validRows: rows.length - new Set(errors.map((e) => e.row)).size,
      errorCount: errors.length,
      errors,
      newVariants: wouldAutoCreate,
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

    // Auto-create the genuinely-new variants first, in one transaction, so the
    // skuToId map is complete before unit creation. Each carries its own
    // auto-create audit row (source=historical-load, sourceEntityId=shipment).
    // (Cross-batch non-atomicity of the unit load itself is pre-existing and
    // documented in BACKLOG; a mid-load failure leaves these valid catalogue
    // rows, which is harmless.)
    if (wouldAutoCreate.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const sku of wouldAutoCreate) {
          const variant = await createAutoVariant({
            tx,
            audit: this.audit,
            sku,
            source: 'historical-load',
            sourceEntityId: shipmentId,
            actorUserId,
            similarityChecked: !overrideSimilarityCheck,
          });
          skuToId.set(sku, variant.id);
        }
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
    return {
      id: shipmentId,
      dryRun: false,
      created,
      totalRows: rows.length,
      autoCreatedVariants: wouldAutoCreate,
    };
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

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

type UnitUniqueField = 'engineNumber' | 'chassisNumber';

interface ReceiptUnitPosition {
  manifestLineId: string;
  unitIndex: number;
}

interface ReceiptPositionedPair extends ReceiptUnitPosition {
  engineNumber: string;
  chassisNumber: string;
}

/**
 * One duplicate found by the exhaustive receipt pre-flight. `kind` is whether
 * the value collides within the submitted batch or against an existing row.
 * `rows` carries every position the offending value appears at in the
 * submission (for IN_BATCH_DUP that's 2+ positions; for AGAINST_DB it's the
 * submitted position(s) carrying the colliding value). `message` keeps the
 * legacy single-violation phrasing so older string-parsing clients still match.
 */
interface ReceiptDuplicateViolation {
  kind: 'IN_BATCH_DUP' | 'AGAINST_DB';
  field: UnitUniqueField;
  value: string;
  rows: ReceiptUnitPosition[];
  message: string;
}

function inBatchDupMessage(field: UnitUniqueField, value: string): string {
  return `Duplicate ${field} in request batch: ${value}`;
}

function againstDbMessage(field: UnitUniqueField, value: string): string {
  return `${field} already exists: ${value}`;
}

/**
 * Build the structured 409 body for a receipt-batch rejection. The top-level
 * `message` is a human summary suitable for a generic-fallback renderer; the
 * `violations` array is the structured detail a client uses to highlight every
 * offending cell (each violation names its field, value, and the row position(s)
 * carrying it). Nest does not auto-merge statusCode/error onto a thrown-object
 * body, so they are set explicitly. All-or-nothing is preserved upstream: this
 * is only ever thrown when zero units have been written.
 */
function buildReceiptConflictBody(violations: ReceiptDuplicateViolation[]): {
  statusCode: number;
  error: string;
  message: string;
  violations: ReceiptDuplicateViolation[];
} {
  const summary =
    violations.length === 1
      ? `Receipt batch rejected: 1 duplicate detected (${violations[0].message}). No units were created.`
      : `Receipt batch rejected: ${violations.length} duplicates detected. No units were created.`;
  return {
    statusCode: 409,
    error: 'Conflict',
    message: summary,
    violations,
  };
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
    const positioned: ReceiptPositionedPair[] = dto.lines.flatMap((line) =>
      line.units.map((unit, unitIndex) => ({
        manifestLineId: line.manifestLineId,
        unitIndex,
        engineNumber: unit.engineNumber,
        chassisNumber: unit.chassisNumber,
      })),
    );
    const pairs = positioned.map((p) => ({
      manifestLineId: p.manifestLineId,
      engineNumber: p.engineNumber,
      chassisNumber: p.chassisNumber,
    }));

    // Exhaustive pre-flight: collect ALL duplicate violations across BOTH
    // unique fields (engineNumber and chassisNumber) and BOTH collision kinds
    // (in-batch and against-DB) in a single structured 409, so a clerk fixes
    // every problem in one pass instead of the "fix one, resubmit, hit the
    // next" loop. Mirrors the I-11 pre-flight pattern: the DB unique
    // constraints (units_engineNumber_key, units_chassisNumber_key) stay the
    // authoritative backstop for the race window; this layer just front-runs
    // them with a complete friendly report in the common case.
    const preFlight = await this.collectReceiptDuplicates(positioned);
    if (preFlight.length > 0) {
      throw new ConflictException(buildReceiptConflictBody(preFlight));
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
        // Race-window enrichment: a concurrent receipt slipped between the
        // pre-flight and the insert and now holds one of our submitted
        // values. Re-run the pre-flight to name the colliding value(s) in
        // the same structured shape; if the lookup somehow finds nothing
        // (the other side rolled back in the same window), fall back to the
        // legacy field-only message so the rewrap path still produces a 409.
        const racing = await this.collectReceiptDuplicates(positioned);
        if (racing.length > 0) {
          throw new ConflictException(buildReceiptConflictBody(racing));
        }
        throw new ConflictException(
          `Duplicate ${field}: a unit with this ${field} already exists (unique violation).`,
        );
      }
      throw err;
    }
  }

  /**
   * Exhaustive duplicate detection for a receipt batch. Returns one violation
   * per offending value: in-batch duplicates carry every position that holds
   * the duplicated value; against-DB collisions carry the position(s) of the
   * submitted row(s) whose value already exists. A value that is BOTH an
   * in-batch duplicate AND already in the DB produces both violations, so the
   * clerk sees the full picture (deduplicating within the batch still leaves
   * the DB collision). One DB read covers both fields via an OR; an empty
   * batch returns empty without querying.
   */
  private async collectReceiptDuplicates(
    positioned: ReceiptPositionedPair[],
  ): Promise<ReceiptDuplicateViolation[]> {
    const violations: ReceiptDuplicateViolation[] = [];

    for (const field of ['engineNumber', 'chassisNumber'] as const) {
      const byValue = new Map<string, ReceiptUnitPosition[]>();
      for (const p of positioned) {
        const value = p[field];
        if (!byValue.has(value)) byValue.set(value, []);
        byValue.get(value)!.push({
          manifestLineId: p.manifestLineId,
          unitIndex: p.unitIndex,
        });
      }
      for (const [value, rows] of byValue) {
        if (rows.length > 1) {
          violations.push({
            kind: 'IN_BATCH_DUP',
            field,
            value,
            rows,
            message: inBatchDupMessage(field, value),
          });
        }
      }
    }

    const submittedEngines = [
      ...new Set(positioned.map((p) => p.engineNumber)),
    ];
    const submittedChassis = [
      ...new Set(positioned.map((p) => p.chassisNumber)),
    ];
    if (submittedEngines.length === 0 && submittedChassis.length === 0) {
      return violations;
    }
    const existing = await this.prisma.unit.findMany({
      where: {
        OR: [
          { engineNumber: { in: submittedEngines } },
          { chassisNumber: { in: submittedChassis } },
        ],
      },
      select: { engineNumber: true, chassisNumber: true },
    });
    const dbEngines = new Set(existing.map((u) => u.engineNumber));
    const dbChassis = new Set(existing.map((u) => u.chassisNumber));

    for (const field of ['engineNumber', 'chassisNumber'] as const) {
      const colliding = field === 'engineNumber' ? dbEngines : dbChassis;
      const rowsByValue = new Map<string, ReceiptUnitPosition[]>();
      for (const p of positioned) {
        const value = p[field];
        if (!colliding.has(value)) continue;
        if (!rowsByValue.has(value)) rowsByValue.set(value, []);
        rowsByValue.get(value)!.push({
          manifestLineId: p.manifestLineId,
          unitIndex: p.unitIndex,
        });
      }
      for (const [value, rows] of rowsByValue) {
        violations.push({
          kind: 'AGAINST_DB',
          field,
          value,
          rows,
          message: againstDbMessage(field, value),
        });
      }
    }

    return violations;
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

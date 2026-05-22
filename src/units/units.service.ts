import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryUnitsDto } from './dto/query-units.dto';

const UNIT_LIST_SELECT = {
  id: true,
  engineNumber: true,
  chassisNumber: true,
  status: true,
  createdAt: true,
  currentWarehouseId: true,
  // landedCost is included so the global CostVisibilityInterceptor strips it for
  // callers without costdata.view (Invariant I-8). Do not gate it here.
  landedCost: true,
  productVariant: {
    select: { id: true, supplierSkuCode: true, variantAttributes: true },
  },
} as const;

@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryUnitsDto) {
    const where: Prisma.UnitWhereInput = {};

    if (query.variantId && query.variantId.length > 0) {
      where.productVariantId = { in: query.variantId };
    }
    if (query.status && query.status.length > 0) {
      where.status = { in: query.status };
    }
    if (query.warehouseId) {
      where.currentWarehouseId = query.warehouseId;
    }
    // NOTE: createdAt is the received-date proxy. For historical imports it is
    // the import time, not the real arrival date (a known limitation: the
    // workflow timestamps were never captured for pre-system arrivals).
    if (query.receivedFrom || query.receivedTo) {
      where.createdAt = {};
      if (query.receivedFrom) where.createdAt.gte = new Date(query.receivedFrom);
      if (query.receivedTo) where.createdAt.lte = new Date(query.receivedTo);
    }
    if (query.search) {
      where.OR = [
        { engineNumber: { startsWith: query.search } },
        { chassisNumber: { startsWith: query.search } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.unit.findMany({
        where,
        // createdAt desc then id for stable paging across equal timestamps.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: UNIT_LIST_SELECT,
      }),
      this.prisma.unit.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }
}

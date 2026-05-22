import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryStockMovementsDto } from './dto/query-stock-movements.dto';

@Injectable()
export class StockMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryStockMovementsDto) {
    const where: Prisma.StockMovementWhereInput = {};
    if (query.unitId) where.unitId = query.unitId;
    if (query.movementType) where.movementType = query.movementType;
    if (query.actorId) where.actorId = query.actorId;
    if (query.occurredFrom || query.occurredTo) {
      where.occurredAt = {};
      if (query.occurredFrom) where.occurredAt.gte = new Date(query.occurredFrom);
      if (query.occurredTo) where.occurredAt.lte = new Date(query.occurredTo);
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          unitId: true,
          movementType: true,
          fromState: true,
          toState: true,
          fromWarehouseId: true,
          toWarehouseId: true,
          referenceType: true,
          referenceId: true,
          occurredAt: true,
          notes: true,
          actor: { select: { id: true, fullName: true } },
          unit: { select: { id: true, engineNumber: true } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }
}

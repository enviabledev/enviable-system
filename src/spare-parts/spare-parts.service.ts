import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuerySparePartsDto } from './dto/query-spare-parts.dto';

@Injectable()
export class SparePartsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QuerySparePartsDto) {
    const where: Prisma.SparePartWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.search) {
      where.OR = [
        { sku: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.sparePart.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          sku: true,
          name: true,
          description: true,
          quantityOnHand: true,
          // landedCostPerUnit is left in for the global CostVisibilityInterceptor
          // to strip for callers without costdata.view (the key is already in
          // SENSITIVE_KEYS). Do not gate it here.
          landedCostPerUnit: true,
          status: true,
        },
      }),
      this.prisma.sparePart.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  async findOne(id: string) {
    const sparePart = await this.prisma.sparePart.findUnique({
      where: { id },
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        quantityOnHand: true,
        landedCostPerUnit: true,
        status: true,
        movements: {
          orderBy: { occurredAt: 'asc' },
          select: {
            id: true,
            movementType: true,
            quantity: true,
            referenceType: true,
            referenceId: true,
            occurredAt: true,
            notes: true,
            actor: { select: { id: true, fullName: true } },
          },
        },
      },
    });
    if (!sparePart) {
      throw new NotFoundException(`Spare part ${id} not found`);
    }
    return sparePart;
  }
}

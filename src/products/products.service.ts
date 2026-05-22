import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The 2 seeded products with a manufacturer summary and their variants. */
  findAll() {
    return this.prisma.product.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        category: true,
        manufacturer: {
          select: { id: true, name: true, type: true },
        },
        variants: {
          orderBy: { supplierSkuCode: 'asc' },
          select: {
            id: true,
            supplierSkuCode: true,
            variantAttributes: true,
            currentMarketPrice: true,
            status: true,
          },
        },
      },
    });
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SalesProformaInvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(id: string) {
    const pi = await this.prisma.salesProformaInvoice.findUnique({
      where: { id },
      select: {
        id: true,
        piNumber: true,
        salesOrderId: true,
        issuedAt: true,
        issuedById: true,
        salesOrder: { select: { soNumber: true, customerId: true } },
      },
    });
    if (!pi) {
      throw new NotFoundException(`Sales proforma invoice ${id} not found`);
    }
    return pi;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { Counterparty } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCounterpartyDto } from './dto/create-counterparty.dto';
import { QueryCounterpartiesDto } from './dto/query-counterparties.dto';
import { UpdateCounterpartyDto } from './dto/update-counterparty.dto';

@Injectable()
export class CounterpartiesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: QueryCounterpartiesDto): Promise<Counterparty[]> {
    return this.prisma.counterparty.findMany({
      where: {
        deletedAt: null,
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Loads an active (non-soft-deleted) counterparty or throws 404. Reused by
   * update and softDelete so a soft-deleted row can never be resurrected.
   */
  async findOne(id: string): Promise<Counterparty> {
    const counterparty = await this.prisma.counterparty.findFirst({
      where: { id, deletedAt: null },
    });
    if (!counterparty) {
      throw new NotFoundException(`Counterparty ${id} not found`);
    }
    return counterparty;
  }

  create(dto: CreateCounterpartyDto): Promise<Counterparty> {
    return this.prisma.counterparty.create({
      data: {
        name: dto.name,
        type: dto.type,
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.contact !== undefined ? { contact: dto.contact } : {}),
        ...(dto.bankDetails !== undefined
          ? { bankDetails: dto.bankDetails }
          : {}),
      },
    });
  }

  async update(id: string, dto: UpdateCounterpartyDto): Promise<Counterparty> {
    await this.findOne(id);
    return this.prisma.counterparty.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.contact !== undefined ? { contact: dto.contact } : {}),
        ...(dto.bankDetails !== undefined
          ? { bankDetails: dto.bankDetails }
          : {}),
      },
    });
  }

  async softDelete(id: string): Promise<Counterparty> {
    await this.findOne(id);
    return this.prisma.counterparty.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

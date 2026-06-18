import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomerStatus,
  CustomerTierStatus,
  Prisma,
  SalesOrderStatus,
} from '@prisma/client';

// Terminal sales-order states do not block customer deletion. CLOSED and
// CANCELLED are the prompt's baseline; REFUNDED is terminal in the same sense (a
// settled, closed-out order), so it is treated as non-blocking too. Every other
// state is an in-flight order that keeps the customer un-deletable.
const TERMINAL_SO_STATES: SalesOrderStatus[] = [
  SalesOrderStatus.CLOSED,
  SalesOrderStatus.CANCELLED,
  SalesOrderStatus.REFUNDED,
];
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const TIER_SUMMARY = {
  select: { id: true, name: true, status: true },
} as const;

/**
 * Detect a P2003 FK violation on Customer.tierId. Prisma 6 may surface the
 * offending FK in meta.field_name or meta.constraint, so both are checked.
 */
function isTierFkViolation(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2003'
  ) {
    const meta = (err.meta ?? {}) as {
      field_name?: unknown;
      constraint?: unknown;
    };
    const haystack = `${String(meta.field_name ?? '')} ${String(
      meta.constraint ?? '',
    )}`;
    return haystack.includes('tierId');
  }
  return false;
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryCustomersDto) {
    const where: Prisma.CustomerWhereInput = { deletedAt: null };
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.tierId) where.tierId = query.tierId;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { tier: TIER_SUMMARY },
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  // Active (non-soft-deleted) only, reused by update and softDelete so a
  // soft-deleted id cannot be resurrected (404).
  async findOne(id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      include: { tier: TIER_SUMMARY },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  async create(dto: CreateCustomerDto) {
    try {
      return await this.prisma.customer.create({
        data: {
          name: dto.name,
          ...(dto.type ? { type: dto.type } : {}),
          tierId: dto.tierId ?? null,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          taxId: dto.taxId ?? null,
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
        },
        include: { tier: TIER_SUMMARY },
      });
    } catch (err) {
      if (isTierFkViolation(err)) {
        throw new BadRequestException(
          `Customer tier ${dto.tierId} not found`,
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOne(id);
    try {
      return await this.prisma.customer.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.tierId !== undefined ? { tierId: dto.tierId } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
        },
        include: { tier: TIER_SUMMARY },
      });
    } catch (err) {
      if (isTierFkViolation(err)) {
        throw new BadRequestException(
          `Customer tier ${dto.tierId} not found`,
        );
      }
      throw err;
    }
  }

  async softDelete(id: string) {
    await this.findOne(id);
    // Application-layer referential guard: a customer with in-flight sales
    // orders cannot be deleted. Soft-deleted SOs and terminal-state SOs do not
    // count; everything else blocks. The DB FK stays the authoritative link,
    // this is the usability guard with a clear message.
    const activeSalesOrders = await this.prisma.salesOrder.count({
      where: {
        customerId: id,
        deletedAt: null,
        status: { notIn: TERMINAL_SO_STATES },
      },
    });
    if (activeSalesOrders > 0) {
      throw new ConflictException(
        `Customer has ${activeSalesOrders} active sales order(s) and cannot be deleted; close or cancel them first`,
      );
    }
    // Soft-delete keeps the customer attributable on historical sales orders and
    // audit rows; status INACTIVE so any status-filtered view drops it too.
    return this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date(), status: CustomerStatus.INACTIVE },
      include: { tier: TIER_SUMMARY },
    });
  }

  listTiers() {
    return this.prisma.customerTier.findMany({
      where: { status: CustomerTierStatus.ACTIVE },
      orderBy: { name: 'asc' },
    });
  }
}

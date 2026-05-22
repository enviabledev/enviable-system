import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PriceListEntry, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryPriceListDto } from './dto/query-price-list.dto';
import { SetPriceDto } from './dto/set-price.dto';

const CURRENT_PRICE_INDEX = 'one_current_price';

const PRICE_INCLUDE = {
  productVariant: { select: { id: true, supplierSkuCode: true } },
  customerTier: { select: { id: true, name: true } },
} as const;

/** P2002 on the one_current_price partial index (Prisma 6 meta shapes). */
function isCurrentPriceViolation(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002'
  ) {
    const meta = (err.meta ?? {}) as { target?: unknown; constraint?: unknown };
    const { target, constraint } = meta;
    if (typeof target === 'string' && target.includes(CURRENT_PRICE_INDEX))
      return true;
    if (Array.isArray(target) && target.includes(CURRENT_PRICE_INDEX))
      return true;
    if (typeof constraint === 'string' && constraint === CURRENT_PRICE_INDEX)
      return true;
  }
  return false;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The single source of truth for the applicable selling price: the current
   * entry (effectiveTo null) for a (variant, tier). Throws a clear 404 if none
   * exists. The one_current_price partial index guarantees at most one.
   */
  async resolvePrice(
    productVariantId: string,
    customerTierId: string,
  ): Promise<PriceListEntry> {
    const entry = await this.prisma.priceListEntry.findFirst({
      where: { productVariantId, customerTierId, effectiveTo: null },
    });
    if (!entry) {
      throw new NotFoundException(
        `No current price for variant ${productVariantId} and tier ${customerTierId}. Set one via POST /price-list.`,
      );
    }
    return entry;
  }

  findAll(query: QueryPriceListDto) {
    const where: Prisma.PriceListEntryWhereInput = {};
    if (query.variantId) where.productVariantId = query.variantId;
    if (query.tierId) where.customerTierId = query.tierId;
    // Default current-only; closed entries appear only with includeClosed.
    if (!query.includeClosed) where.effectiveTo = null;
    return this.prisma.priceListEntry.findMany({
      where,
      orderBy: [
        { productVariantId: 'asc' },
        { customerTierId: 'asc' },
        { effectiveFrom: 'desc' },
      ],
      include: PRICE_INCLUDE,
    });
  }

  /**
   * Set a new current price: in ONE transaction, close the existing current
   * entry for (variant, tier) by stamping effectiveTo, then open the new entry
   * with the SAME timestamp as effectiveFrom and effectiveTo null. The shared
   * timestamp makes the closed entry's effectiveTo equal the new one's
   * effectiveFrom (a continuous history). The partial unique index never sees
   * two current entries, even momentarily, from any other session. Closed
   * entries are preserved (price history).
   */
  async setPrice(dto: SetPriceDto, actorId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: dto.productVariantId },
      select: { id: true },
    });
    if (!variant) {
      throw new BadRequestException(
        `Product variant ${dto.productVariantId} not found`,
      );
    }
    const tier = await this.prisma.customerTier.findUnique({
      where: { id: dto.customerTierId },
      select: { id: true },
    });
    if (!tier) {
      throw new BadRequestException(
        `Customer tier ${dto.customerTierId} not found`,
      );
    }

    const now = new Date();
    const price = new Prisma.Decimal(dto.price);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.priceListEntry.updateMany({
          where: {
            productVariantId: dto.productVariantId,
            customerTierId: dto.customerTierId,
            effectiveTo: null,
          },
          data: { effectiveTo: now },
        });
        return tx.priceListEntry.create({
          data: {
            productVariantId: dto.productVariantId,
            customerTierId: dto.customerTierId,
            price,
            effectiveFrom: now,
            effectiveTo: null,
            setById: actorId,
          },
          include: PRICE_INCLUDE,
        });
      });
    } catch (err) {
      if (isCurrentPriceViolation(err)) {
        throw new ConflictException(
          'Invariant violated: a (variant, tier) may have at most one current price.',
        );
      }
      throw err;
    }
  }
}

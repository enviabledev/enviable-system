import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { UpdateProductVariantDto } from './dto/update-product-variant.dto';

const VARIANT_VIEW = {
  include: { product: { select: { id: true, name: true } } },
} satisfies Prisma.ProductVariantDefaultArgs;

@Injectable()
export class ProductVariantsService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(id: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id },
      ...VARIANT_VIEW,
    });
    if (!variant) {
      throw new NotFoundException(`Product variant ${id} not found`);
    }
    return variant;
  }

  async create(dto: CreateProductVariantDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true },
    });
    if (!product) {
      throw new BadRequestException(`Product ${dto.productId} not found`);
    }
    // SKU is the catalogue-wide stable identifier; enforce uniqueness across all
    // variants. App-level check (there is no DB unique constraint on
    // supplierSkuCode yet; see BACKLOG for hardening it).
    const clash = await this.prisma.productVariant.count({
      where: { supplierSkuCode: dto.supplierSkuCode },
    });
    if (clash > 0) {
      throw new ConflictException(
        `A variant with SKU "${dto.supplierSkuCode}" already exists`,
      );
    }
    return this.prisma.productVariant.create({
      data: {
        productId: dto.productId,
        supplierSkuCode: dto.supplierSkuCode,
        variantAttributes: dto.variantAttributes,
        currentMarketPrice: new Prisma.Decimal(dto.currentMarketPrice),
        ...(dto.status ? { status: dto.status } : {}),
      },
      ...VARIANT_VIEW,
    });
  }

  async update(id: string, dto: UpdateProductVariantDto) {
    await this.findOne(id);
    // SKU is immutable: renaming it would silently change what users see on every
    // historical unit, sales order and price-list entry that displays it. Reject
    // the attempt explicitly rather than let the whitelist swallow it.
    if (dto.supplierSkuCode !== undefined || dto.sku !== undefined) {
      throw new BadRequestException(
        'SKU is immutable; deactivate this variant (set status DISCONTINUED) and create a new one if the SKU must change',
      );
    }
    // Reclassification: validate the target product exists before repointing.
    // This is how an admin lifts an auto-created variant off the sentinel
    // "Pending Classification" product onto its real product.
    if (dto.productId !== undefined) {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { id: true },
      });
      if (!product) {
        throw new BadRequestException(`Product ${dto.productId} not found`);
      }
    }
    return this.prisma.productVariant.update({
      where: { id },
      data: {
        ...(dto.productId !== undefined ? { productId: dto.productId } : {}),
        ...(dto.variantAttributes !== undefined
          ? { variantAttributes: dto.variantAttributes }
          : {}),
        ...(dto.currentMarketPrice !== undefined
          ? { currentMarketPrice: new Prisma.Decimal(dto.currentMarketPrice) }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      ...VARIANT_VIEW,
    });
  }
}

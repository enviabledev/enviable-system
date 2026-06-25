import { ProductStatus, ProductType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class QueryProductVariantsDto {
  // Filter to one wheeler type. Backs product-type-aware pickers (e.g. a sales
  // order line picker scoped to the order's established type).
  @IsOptional()
  @IsEnum(ProductType, {
    message: 'productType must be TWO_WHEELER or THREE_WHEELER',
  })
  productType?: ProductType;

  @IsOptional()
  @IsEnum(ProductStatus, { message: 'status is not a valid ProductStatus' })
  status?: ProductStatus;

  // Prefix match on the supplier SKU.
  @IsOptional()
  @IsString()
  search?: string;
}

import { Prisma, ProductStatus } from '@prisma/client';
import {
  IsEnum,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

// All optional (PATCH). The SKU is intentionally NOT editable. supplierSkuCode
// and its `sku` alias are declared here ONLY so a change attempt survives the
// global whitelist (which would otherwise silently strip an undeclared field)
// and can be rejected with a clear, explanatory error in the service. They are
// never applied to the row.
export class UpdateProductVariantDto {
  @IsOptional()
  @IsString()
  supplierSkuCode?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsObject()
  variantAttributes?: Prisma.InputJsonValue;

  @IsOptional()
  @IsNumberString({}, { message: 'currentMarketPrice must be a decimal string' })
  currentMarketPrice?: string;

  // ACTIVE or DISCONTINUED. DISCONTINUED is the deactivated state: it prevents
  // new use while existing references continue to resolve.
  @IsOptional()
  @IsEnum(ProductStatus, { message: 'status is not a valid ProductStatus' })
  status?: ProductStatus;
}

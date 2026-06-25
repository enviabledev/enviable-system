import { Prisma, ProductStatus, ProductType } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
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

  // Reclassification: move a variant onto a different product. The primary use
  // is lifting an auto-created variant off the "Pending Classification" sentinel
  // product once an admin identifies its real product. Existence is validated in
  // the service. Unlike the SKU, productId is mutable.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  productId?: string;

  // Reclassification of wheeler type (e.g. correcting an auto-created variant
  // that defaulted to THREE_WHEELER). Allowed; it does NOT retro-validate
  // existing sales orders that already reference the variant (see BACKLOG).
  @IsOptional()
  @IsEnum(ProductType, {
    message: 'productType must be TWO_WHEELER or THREE_WHEELER',
  })
  productType?: ProductType;

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

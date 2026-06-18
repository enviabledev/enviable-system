import { Prisma, ProductStatus } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateProductVariantDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  // The stable identifier shown across the system. Uniqueness is enforced in the
  // service; immutable once created.
  @IsString()
  @IsNotEmpty()
  supplierSkuCode!: string;

  // Structured attributes (e.g. { model, colour }); a free-form JSON object.
  @IsObject()
  variantAttributes!: Prisma.InputJsonValue;

  // Money as a decimal string (Decimal(18,2)); never a float.
  @IsNumberString({}, { message: 'currentMarketPrice must be a decimal string' })
  currentMarketPrice!: string;

  @IsOptional()
  @IsEnum(ProductStatus, { message: 'status is not a valid ProductStatus' })
  status?: ProductStatus;
}

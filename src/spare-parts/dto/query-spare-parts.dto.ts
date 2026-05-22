import { Type } from 'class-transformer';
import { ProductStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ALLOWED_PAGE_SIZES } from '../../common/pagination';

export class QuerySparePartsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsIn(ALLOWED_PAGE_SIZES, {
    message: `pageSize must be one of ${ALLOWED_PAGE_SIZES.join(', ')}`,
  })
  pageSize: number = 50;

  @IsOptional()
  @IsEnum(ProductStatus, {
    message: 'status is not a valid ProductStatus',
  })
  status?: ProductStatus;

  // Case-insensitive substring match across sku and name.
  @IsOptional()
  @IsString()
  search?: string;
}

import { Type } from 'class-transformer';
import { CustomerStatus, CustomerType } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ALLOWED_PAGE_SIZES } from '../../common/pagination';

export class QueryCustomersDto {
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
  @IsEnum(CustomerType, { message: 'type is not a valid CustomerType' })
  type?: CustomerType;

  @IsOptional()
  @IsEnum(CustomerStatus, { message: 'status is not a valid CustomerStatus' })
  status?: CustomerStatus;

  @IsOptional()
  @IsString()
  tierId?: string;

  // Case-insensitive substring match across name, phone, and email.
  @IsOptional()
  @IsString()
  search?: string;
}

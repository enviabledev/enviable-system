import { Type } from 'class-transformer';
import { CustomerStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ALLOWED_PAGE_SIZES } from '../../common/pagination';

export class CustomersReportQueryDto {
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

  // Narrow the customer set by tier and/or status.
  @IsOptional()
  @IsString()
  tierId?: string;

  @IsOptional()
  @IsEnum(CustomerStatus, { message: 'status is not a valid CustomerStatus' })
  status?: CustomerStatus;

  // Date range over order activity (order createdAt). Scopes the order-derived
  // metrics; inclusive of from, exclusive of to.
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

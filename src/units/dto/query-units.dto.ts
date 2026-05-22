import { Transform, Type } from 'class-transformer';
import { UnitStatus } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ALLOWED_PAGE_SIZES } from '../../common/pagination';

// Express gives a repeated query param as an array and a single one as a
// scalar. Normalise both to an array (or undefined when absent).
const toArray = ({ value }: { value: unknown }): unknown =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

export class QueryUnitsDto {
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
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  variantId?: string[];

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(UnitStatus, {
    each: true,
    message: 'status contains a value that is not a valid UnitStatus',
  })
  status?: UnitStatus[];

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsISO8601()
  receivedFrom?: string;

  @IsOptional()
  @IsISO8601()
  receivedTo?: string;

  // Prefix match across the two serial-number columns only.
  @IsOptional()
  @IsString()
  search?: string;
}

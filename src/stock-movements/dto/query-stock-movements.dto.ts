import { Type } from 'class-transformer';
import { MovementType } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ALLOWED_PAGE_SIZES } from '../../common/pagination';

export class QueryStockMovementsDto {
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
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsEnum(MovementType, {
    message: 'movementType is not a valid MovementType',
  })
  movementType?: MovementType;

  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsISO8601()
  occurredFrom?: string;

  @IsOptional()
  @IsISO8601()
  occurredTo?: string;
}

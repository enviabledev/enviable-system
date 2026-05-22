import { Type } from 'class-transformer';
import {
  IsInt,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ALLOWED_PAGE_SIZES } from '../../common/pagination';

export class AuditLogQueryDto {
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
  actorUserId?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  // Inclusive lower and upper bounds on occurredAt.
  @IsOptional()
  @IsISO8601()
  occurredFrom?: string;

  @IsOptional()
  @IsISO8601()
  occurredTo?: string;
}

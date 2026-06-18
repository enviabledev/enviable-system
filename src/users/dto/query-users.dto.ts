import { Type } from 'class-transformer';
import { UserStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ALLOWED_PAGE_SIZES } from '../../common/pagination';

export class QueryUsersDto {
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
  @IsEnum(UserStatus, { message: 'status is not a valid UserStatus' })
  status?: UserStatus;

  // Restrict to users assigned this role id.
  @IsOptional()
  @IsString()
  roleId?: string;

  // Case-insensitive substring match across fullName and email.
  @IsOptional()
  @IsString()
  search?: string;
}

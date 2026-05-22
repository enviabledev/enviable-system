import { Type } from 'class-transformer';
import { SalesChannel } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SoLineDto } from './so-line.dto';

// All optional. If lines are supplied they replace the existing set (prices
// re-resolved, units re-allocated). Only a DRAFT order can be edited.
export class UpdateSalesOrderDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  customerId?: string;

  @IsOptional()
  @IsEnum(SalesChannel, { message: 'channel is not a valid SalesChannel' })
  channel?: SalesChannel;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SoLineDto)
  lines?: SoLineDto[];
}

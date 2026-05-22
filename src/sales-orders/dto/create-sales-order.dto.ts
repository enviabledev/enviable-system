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

export class CreateSalesOrderDto {
  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @IsOptional()
  @IsEnum(SalesChannel, { message: 'channel is not a valid SalesChannel' })
  channel?: SalesChannel;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SoLineDto)
  lines!: SoLineDto[];
}

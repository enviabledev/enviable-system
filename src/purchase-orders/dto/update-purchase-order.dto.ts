import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PoLineDto } from './po-line.dto';

// All optional. If lines are supplied they replace the existing set atomically
// and the total is recomputed.
export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  supplierId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currency?: string;

  @IsOptional()
  @IsISO8601()
  expectedShipDate?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PoLineDto)
  lines?: PoLineDto[];
}

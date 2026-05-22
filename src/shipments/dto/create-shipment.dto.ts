import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ManifestLineDto } from './manifest-line.dto';

export class CreateShipmentDto {
  @IsOptional()
  @IsString()
  billOfLadingNumber?: string;

  @IsOptional()
  @IsString()
  vesselName?: string;

  @IsOptional()
  @IsISO8601()
  etd?: string;

  @IsOptional()
  @IsISO8601()
  eta?: string;

  @IsOptional()
  @IsString()
  freightForwarderId?: string;

  @IsOptional()
  @IsString()
  clearingAgentId?: string;

  @IsOptional()
  @IsString()
  insuranceCompanyId?: string;

  @IsOptional()
  @IsBoolean()
  isHistoricalImport?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ManifestLineDto)
  manifestLines!: ManifestLineDto[];
}

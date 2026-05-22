import { Type } from 'class-transformer';
import { ShipmentStatus } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ManifestLineDto } from './manifest-line.dto';

export class UpdateShipmentDto {
  @IsOptional()
  @IsEnum(ShipmentStatus)
  status?: ShipmentStatus;

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
  @IsISO8601()
  arrivalDate?: string;

  @IsOptional()
  @IsISO8601()
  clearingStartedAt?: string;

  @IsOptional()
  @IsISO8601()
  clearedAt?: string;

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

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ManifestLineDto)
  manifestLines?: ManifestLineDto[];
}

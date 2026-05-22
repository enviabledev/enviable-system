import {
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const MONEY = /^\d+(\.\d{1,2})?$/;

export class CreateHistoricalShipmentDto {
  @IsString()
  @IsNotEmpty()
  supplierId!: string;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  // The supplier's PI reference for the historical arrival.
  @IsString()
  @IsNotEmpty()
  piNumber!: string;

  @IsOptional()
  @Matches(MONEY, { message: 'totalValue must be a decimal string (<=2 dp)' })
  totalValue?: string;

  @IsOptional()
  @IsString()
  poNumber?: string;

  @IsOptional()
  @IsString()
  shipmentReference?: string;

  @IsOptional()
  @IsString()
  vesselName?: string;

  @IsOptional()
  @IsString()
  billOfLadingNumber?: string;

  @IsOptional()
  @IsISO8601()
  etd?: string;

  @IsOptional()
  @IsISO8601()
  eta?: string;

  @IsOptional()
  @IsISO8601()
  arrivalDate?: string;
}

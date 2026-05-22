import {
  LandedCostAllocationMethod,
  LandedCostComponentType,
  LandedCostStatus,
} from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const MONEY = /^\d+(\.\d{1,2})?$/;
const RATE = /^\d+(\.\d{1,6})?$/;

export class CreateLandedCostDto {
  @IsEnum(LandedCostComponentType)
  componentType!: LandedCostComponentType;

  @Matches(MONEY, { message: 'amount must be a decimal string (<=2 dp)' })
  amount!: string;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsOptional()
  @Matches(RATE, {
    message: 'exchangeRateToBase must be a decimal string (<=6 dp)',
  })
  exchangeRateToBase?: string;

  @IsOptional()
  @IsString()
  counterpartyId?: string;

  @IsOptional()
  @IsEnum(LandedCostAllocationMethod)
  allocationMethod?: LandedCostAllocationMethod;

  @IsOptional()
  @IsEnum(LandedCostStatus)
  status?: LandedCostStatus;

  @IsOptional()
  @IsString()
  invoiceDocumentId?: string;
}

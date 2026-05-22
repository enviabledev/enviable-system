import { SaleForm } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class SoLineDto {
  @IsString()
  @IsNotEmpty()
  productVariantId!: string;

  // A specific unit to allocate (soft reservation; the unit is not transitioned).
  @IsString()
  @IsNotEmpty()
  unitId!: string;

  @IsEnum(SaleForm, { message: 'saleForm must be CKD or CBU' })
  saleForm!: SaleForm;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'discountAmount must be a decimal string with up to 2 decimal places',
  })
  discountAmount?: string;
}

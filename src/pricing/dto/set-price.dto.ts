import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SetPriceDto {
  @IsString()
  @IsNotEmpty()
  productVariantId!: string;

  @IsString()
  @IsNotEmpty()
  customerTierId!: string;

  // Selling price. Money as a decimal string (<=2 dp), never a float.
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'price must be a decimal string with up to 2 decimal places',
  })
  price!: string;
}

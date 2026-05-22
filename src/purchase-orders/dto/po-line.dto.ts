import { IsInt, IsNotEmpty, IsString, Matches, Min } from 'class-validator';

export class PoLineDto {
  @IsString()
  @IsNotEmpty()
  productVariantId!: string;

  @IsInt()
  @Min(1)
  quantityOrdered!: number;

  // Money as a decimal string (up to 2 dp). Never a float.
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'unitPrice must be a decimal string with up to 2 decimal places',
  })
  unitPrice!: string;
}

import { IsInt, IsNotEmpty, IsString, Matches, Min } from 'class-validator';

export class PiLineDto {
  @IsString()
  @IsNotEmpty()
  productVariantId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'unitPrice must be a decimal string with up to 2 decimal places',
  })
  unitPrice!: string;
}

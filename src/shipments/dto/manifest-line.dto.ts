import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class ManifestLineDto {
  @IsString()
  @IsNotEmpty()
  productVariantId!: string;

  @IsInt()
  @Min(1)
  quantityDeclared!: number;
}

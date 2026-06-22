import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class PoLineDto {
  // A line references a variant by EITHER an existing id OR a supplier SKU,
  // exactly one (validated in the service). The SKU form is the supply-side
  // auto-create path: an unknown SKU mints a new variant rather than being
  // rejected, so a buyer typing/pasting from a supplier doc does not have to
  // pre-register the variant. The id form is the existing, backwards-compatible
  // path for callers that already know the variant.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  productVariantId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  productVariantSku?: string;

  // Opt past a similarity warning to create a brand-new variant for this SKU
  // (the "create new anyway" choice after the frontend surfaces the 409).
  @IsOptional()
  @IsBoolean()
  overrideSimilarityCheck?: boolean;

  @IsInt()
  @Min(1)
  quantityOrdered!: number;

  // Money as a decimal string (up to 2 dp). Never a float.
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'unitPrice must be a decimal string with up to 2 decimal places',
  })
  unitPrice!: string;
}

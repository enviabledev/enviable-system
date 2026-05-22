import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class QueryPriceListDto {
  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsString()
  tierId?: string;

  // Default current-only; includeClosed=true returns price history too.
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeClosed?: boolean;
}

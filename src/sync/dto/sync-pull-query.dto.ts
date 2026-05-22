import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class SyncPullQueryDto {
  // Last successful sync time. Omitted means a first-ever sync (since epoch).
  @IsOptional()
  @IsISO8601()
  since?: string;

  // Comma-separated entity types the device caches (e.g. "unit,priceListEntry").
  // Omitted means all types.
  @IsOptional()
  @IsString()
  scope?: string;

  // Continuation marker from a truncated pull. Opaque; pass it back verbatim.
  @IsOptional()
  @IsString()
  cursor?: string;

  // Max units per page (the large set). Reference data is small and always full.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit: number = 500;
}

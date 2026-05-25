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
  // Used by since-mode (open-ended delta from `since` to serverTime).
  // Ignored when `from` AND `to` are both provided (windowed mode).
  @IsOptional()
  @IsISO8601()
  since?: string;

  // Windowed-mode lower bound (inclusive). When BOTH `from` and `to` are
  // provided, the pull returns entities with updatedAt in [from, to) instead
  // of (since, serverTime]. The offline read-mirror uses this for its
  // initial 90-day download in 7-day windows, so each window is a self-
  // contained bounded slice. Half-open at `to` so adjacent windows
  // [W1.from, W1.to) and [W2.from = W1.to, W2.to) don't double-count rows.
  @IsOptional()
  @IsISO8601()
  from?: string;

  // Windowed-mode upper bound (exclusive). See `from`.
  @IsOptional()
  @IsISO8601()
  to?: string;

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

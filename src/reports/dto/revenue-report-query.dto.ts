import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export class RevenueReportQueryDto {
  // Recognition-date range. Inclusive of from, exclusive of to. Both optional;
  // default is the current calendar month (start of this month to start of next).
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  // How many customers to return in the revenue-by-customer ranking.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  topN: number = 5;
}

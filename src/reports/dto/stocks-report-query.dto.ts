import { IsOptional, IsString } from 'class-validator';

export class StocksReportQueryDto {
  // Optional: scope the unit counts and valuation to one warehouse. Spare parts
  // are not warehouse-scoped in the schema, so this filter applies to units only.
  @IsOptional()
  @IsString()
  warehouseId?: string;
}

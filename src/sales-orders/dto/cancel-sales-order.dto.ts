import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class CancelSalesOrderDto {
  // Mandatory: why the order is being cancelled. Trimmed and non-empty.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'reason is required' })
  reason!: string;
}

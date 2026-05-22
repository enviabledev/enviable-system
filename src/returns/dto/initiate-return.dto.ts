import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class InitiateReturnDto {
  @IsString()
  @IsNotEmpty()
  unitId!: string;

  // Mandatory free text: what was wrong. Trimmed and non-empty.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'reason is required' })
  reason!: string;
}

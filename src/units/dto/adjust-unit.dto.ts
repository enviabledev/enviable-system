import { Transform } from 'class-transformer';
import { UnitStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class AdjustUnitDto {
  @IsEnum(UnitStatus, { message: 'toStatus is not a valid UnitStatus' })
  toStatus!: UnitStatus;

  // Mandatory and non-empty (trimmed). Stored on the movement's notes.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'reason is required' })
  reason!: string;
}

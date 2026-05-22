import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class AllocateIdRangeDto {
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  // Free-text identifier class (e.g. a transactional model's client id space).
  // NOT engine/chassis numbers, which come from the supplier.
  @IsString()
  @IsNotEmpty()
  idType!: string;

  // How many ids to reserve in this block.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  count!: number;
}

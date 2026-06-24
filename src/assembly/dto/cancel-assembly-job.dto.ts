import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class CancelAssemblyJobDto {
  // Why the in-progress assembly is being cancelled (e.g. "wrong unit selected
  // for assembly", "administrative correction"). Mandatory and non-empty
  // (trimmed); stored on the reversal movement's notes and the job's notes.
  // Mirrors AdjustUnitDto's required reason, the prompt-39 uniform shape.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'reason is required' })
  reason!: string;
}

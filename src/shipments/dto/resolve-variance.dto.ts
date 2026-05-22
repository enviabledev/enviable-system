import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ResolveVarianceLineDto {
  @IsString()
  @IsNotEmpty()
  manifestLineId!: string;

  @IsString()
  @IsNotEmpty()
  varianceReason!: string;
}

export class ResolveVarianceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ResolveVarianceLineDto)
  lines!: ResolveVarianceLineDto[];
}

import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

export class UnitPairDto {
  // Engine and chassis numbers come FROM the supplier on the kit. The system
  // records them, never invents them.
  @IsString()
  @IsNotEmpty()
  engineNumber!: string;

  @IsString()
  @IsNotEmpty()
  chassisNumber!: string;
}

export class ReceiveLineDto {
  @IsString()
  @IsNotEmpty()
  manifestLineId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UnitPairDto)
  units!: UnitPairDto[];
}

export class ReceiveUnitsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];
}

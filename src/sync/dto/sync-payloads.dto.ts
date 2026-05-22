import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ReceiveLineDto } from '../../shipments/dto/receive-units.dto';

// Per-type payload shapes. These reuse the existing module DTOs where possible
// (ReceiveLineDto, CreateSalesOrderDto is reused directly in the dispatcher).

export class UnitReceiptPayloadDto {
  @IsString()
  @IsNotEmpty()
  shipmentId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];
}

export class AssemblyStartPayloadDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  unitRefs!: string[];
}

export class AssemblyCompletePayloadDto {
  @IsString()
  @IsNotEmpty()
  jobId!: string;
}

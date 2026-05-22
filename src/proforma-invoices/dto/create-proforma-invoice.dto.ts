import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { PiLineDto } from './pi-line.dto';

const MONEY = /^\d+(\.\d{1,2})?$/;

export class CreateProformaInvoiceDto {
  // The supplier's PI reference. Not auto-generated (unlike poNumber); the
  // revisionNumber is the auto-incremented per-PO sequence.
  @IsString()
  @IsNotEmpty()
  piNumber!: string;

  @IsOptional()
  @IsISO8601()
  issueDate?: string;

  @IsOptional()
  @IsISO8601()
  validityUntil?: string;

  @IsOptional()
  @Matches(MONEY, { message: 'freightAmount must be a decimal string (<=2 dp)' })
  freightAmount?: string;

  @IsOptional()
  @Matches(MONEY, {
    message: 'insuranceAmount must be a decimal string (<=2 dp)',
  })
  insuranceAmount?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  portOfLoading?: string;

  @IsOptional()
  @IsString()
  portOfDischarge?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PiLineDto)
  lines!: PiLineDto[];
}

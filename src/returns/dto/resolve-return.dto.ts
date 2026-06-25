import { ReturnDisposition } from '@prisma/client';
import { IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';

export class ResolveReturnDto {
  // REPAIR, WRITE_OFF, or SUPPLIER_WARRANTY_CLAIM (PENDING_DECISION is rejected
  // at resolve).
  @IsEnum(ReturnDisposition, {
    message:
      'disposition must be REPAIR, WRITE_OFF, or SUPPLIER_WARRANTY_CLAIM',
  })
  disposition!: ReturnDisposition;

  // The supplier (VSK) the claim is filed against. REQUIRED when the disposition
  // is SUPPLIER_WARRANTY_CLAIM; existence is validated in the service. Ignored
  // for REPAIR / WRITE_OFF.
  @ValidateIf((o) => o.disposition === ReturnDisposition.SUPPLIER_WARRANTY_CLAIM)
  @IsString()
  supplierCounterpartyId!: string;

  // VSK's claim ticket number. Optional: VSK may not assign it until later.
  @IsOptional()
  @IsString()
  claimReference?: string;

  // Free-text notes about the claim (recommended).
  @IsOptional()
  @IsString()
  claimNotes?: string;
}

import { OverpaymentResolution, RefundMechanism } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';

export class RecordPaymentDto {
  @IsString()
  @IsNotEmpty()
  paymentMethodId!: string;

  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a decimal string with up to 2 decimal places',
  })
  amount!: string;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  receiptDocumentId?: string;

  // Overpayment resolution. Optional at the DTO level because whether it is
  // REQUIRED depends on the SO balance, which the DTO cannot see; the service
  // enforces "required when amount exceeds the remaining balance" (400 otherwise).
  // When present, it drives which of the fields below apply.
  @IsOptional()
  @IsEnum(OverpaymentResolution, {
    message: 'overpaymentResolution must be REFUND or CREDIT',
  })
  overpaymentResolution?: OverpaymentResolution;

  // Required when overpaymentResolution is REFUND; ignored otherwise.
  @ValidateIf((o) => o.overpaymentResolution === OverpaymentResolution.REFUND)
  @IsEnum(RefundMechanism, {
    message: 'refundMechanism must be BANK_TRANSFER or CASH for a REFUND',
  })
  refundMechanism?: RefundMechanism;

  // Optional free-text note for a REFUND (e.g. a transfer reference).
  @IsOptional()
  @IsString()
  refundReference?: string;

  // Optional free-text note for a CREDIT.
  @IsOptional()
  @IsString()
  creditNotes?: string;
}

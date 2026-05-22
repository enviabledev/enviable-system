import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

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
}

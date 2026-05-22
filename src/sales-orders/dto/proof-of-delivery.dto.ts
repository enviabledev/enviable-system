import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class ProofOfDeliveryDto {
  @IsOptional()
  @IsString()
  receivedBy?: string;

  @IsOptional()
  @IsISO8601()
  signedAt?: string;
}

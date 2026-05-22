import { IsOptional, IsString } from 'class-validator';

export class CreateDeliveryNoteDto {
  @IsOptional()
  @IsString()
  vehicleReg?: string;

  @IsOptional()
  @IsString()
  driverName?: string;
}

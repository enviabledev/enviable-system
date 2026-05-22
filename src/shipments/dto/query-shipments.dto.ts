import { ShipmentStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class QueryShipmentsDto {
  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  @IsOptional()
  @IsEnum(ShipmentStatus)
  status?: ShipmentStatus;
}

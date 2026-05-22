import { SalesChannel, SalesOrderStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class QuerySalesOrdersDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsEnum(SalesOrderStatus, { message: 'status is not a valid SalesOrderStatus' })
  status?: SalesOrderStatus;

  @IsOptional()
  @IsEnum(SalesChannel, { message: 'channel is not a valid SalesChannel' })
  channel?: SalesChannel;
}

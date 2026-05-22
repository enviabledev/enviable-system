import { CounterpartyStatus, CounterpartyType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class QueryCounterpartiesDto {
  @IsOptional()
  @IsEnum(CounterpartyType)
  type?: CounterpartyType;

  @IsOptional()
  @IsEnum(CounterpartyStatus)
  status?: CounterpartyStatus;
}

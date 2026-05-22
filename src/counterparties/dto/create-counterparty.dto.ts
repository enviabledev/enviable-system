import { CounterpartyStatus, CounterpartyType, Prisma } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateCounterpartyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(CounterpartyType)
  type!: CounterpartyType;

  @IsOptional()
  @IsObject()
  contact?: Prisma.InputJsonValue;

  @IsOptional()
  @IsObject()
  bankDetails?: Prisma.InputJsonValue;

  @IsOptional()
  @IsEnum(CounterpartyStatus)
  status?: CounterpartyStatus;
}

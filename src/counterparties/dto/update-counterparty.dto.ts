import { CounterpartyStatus, CounterpartyType, Prisma } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

// All fields optional. Written out rather than PartialType to avoid adding the
// @nestjs/mapped-types dependency.
export class UpdateCounterpartyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEnum(CounterpartyType)
  type?: CounterpartyType;

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

import { CustomerStatus, CustomerType, Prisma } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

// All optional. Written out rather than PartialType to avoid the
// @nestjs/mapped-types dependency.
export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEnum(CustomerType, { message: 'type is not a valid CustomerType' })
  type?: CustomerType;

  @IsOptional()
  @IsString()
  tierId?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsObject()
  address?: Prisma.InputJsonValue;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsEnum(CustomerStatus, { message: 'status is not a valid CustomerStatus' })
  status?: CustomerStatus;
}

import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsString,
  ValidateNested,
} from 'class-validator';

// Offline-critical action types supported by the sync intake. Each maps to an
// existing module service; the sync layer never reimplements the business rules.
export enum SyncActionType {
  UNIT_RECEIPT = 'unit.receipt',
  ASSEMBLY_START = 'assembly.start',
  ASSEMBLY_COMPLETE = 'assembly.complete',
  SALES_ORDER_CREATE = 'salesorder.create',
}

export class SyncActionDto {
  // Client-generated idempotency key (UUID). Replaying the same clientId never
  // double-processes.
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @IsEnum(SyncActionType, {
    message: `type must be one of ${Object.values(SyncActionType).join(', ')}`,
  })
  type!: SyncActionType;

  // Action-specific body. Validated per-type in the dispatcher against the
  // reused module DTO, so a malformed payload errors for its action alone.
  @IsObject()
  payload!: Record<string, unknown>;
}

export class SyncBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SyncActionDto)
  actions!: SyncActionDto[];
}

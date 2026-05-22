import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

// Entity types that field-level sync updates may target. Each maps to a server
// model with an allowlist of updatable fields (enforced in the merge service).
export const MERGEABLE_ENTITY_TYPES = ['customer', 'unit'] as const;
export type MergeableEntityType = (typeof MERGEABLE_ENTITY_TYPES)[number];

export class FieldChangeDto {
  // Field name on the entity (a flat field; nested paths are not supported yet).
  @IsString()
  @IsNotEmpty()
  path!: string;

  // The value the offline device started from (its base). Used to detect a
  // same-field collision: if the server value no longer equals oldValue (and is
  // not already the newValue), another device changed this field. Optional; when
  // omitted there is no base to compare and the change applies directly.
  // @Allow() keeps it under whitelist validation (it carries no other decorator,
  // so without @Allow the whitelist would strip the value, silently dropping it).
  @Allow()
  oldValue?: unknown;

  // The value the device wants to set.
  @Allow()
  newValue?: unknown;
}

export class UpdateEntityPayloadDto {
  @IsIn(MERGEABLE_ENTITY_TYPES, {
    message: `entityType must be one of ${MERGEABLE_ENTITY_TYPES.join(', ')}`,
  })
  entityType!: MergeableEntityType;

  @IsString()
  @IsNotEmpty()
  entityId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FieldChangeDto)
  changes!: FieldChangeDto[];
}

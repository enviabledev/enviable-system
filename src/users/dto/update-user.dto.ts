import { UserStatus } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

// All optional (PATCH). Written out rather than PartialType to avoid the
// @nestjs/mapped-types dependency, matching the other modules. Password is NEVER
// updatable through this endpoint; the reset flow is the only password path.
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // Only ACTIVE and INACTIVE are settable here: INACTIVE deactivates (recording
  // the actor + timestamp), ACTIVE reactivates. SUSPENDED is reserved and not
  // driven by this endpoint.
  @IsOptional()
  @IsEnum(UserStatus, { message: 'status is not a valid UserStatus' })
  @IsIn([UserStatus.ACTIVE, UserStatus.INACTIVE], {
    message: 'status must be ACTIVE or INACTIVE',
  })
  status?: UserStatus;

  // When present, the user's role set is replaced atomically with exactly this
  // list (old assignments removed, new ones added in one transaction).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  roleIds?: string[];
}

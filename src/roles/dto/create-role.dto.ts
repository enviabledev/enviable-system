import {
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Permission grants by id. May be empty (a role granting nothing).
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permissionIds!: string[];
}

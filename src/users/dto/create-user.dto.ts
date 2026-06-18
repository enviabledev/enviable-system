import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsString,
} from 'class-validator';

// Password is deliberately absent: a new user is created with the configured
// default initial password and mustResetPassword=true. No endpoint ever accepts
// a password in cleartext on create.
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsEmail()
  email!: string;

  // Role assignments by id. May be empty (a user with no roles holds no
  // permissions); the management UI can grant roles later.
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  roleIds!: string[];
}

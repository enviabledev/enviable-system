import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  // Minimum length is the only strength rule enforced server-side for now; the
  // upper bound is a guard against pathologically long argon2 inputs.
  @IsString()
  @MinLength(8, { message: 'newPassword must be at least 8 characters' })
  @MaxLength(128)
  newPassword!: string;
}

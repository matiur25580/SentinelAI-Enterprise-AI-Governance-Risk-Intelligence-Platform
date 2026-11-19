import { IsString, MaxLength, MinLength } from "class-validator";

export class PasswordResetDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

import { IsEmail, MaxLength } from "class-validator";

export class EmailActionRequestDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

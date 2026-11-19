import { IsString, MaxLength, MinLength } from "class-validator";

export class EvidenceLegalHoldDto {
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

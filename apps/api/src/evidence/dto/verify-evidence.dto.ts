import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export class VerifyEvidenceDto {
  @IsIn(["VERIFIED", "REJECTED"])
  decision!: "VERIFIED" | "REJECTED";

  @IsString()
  @MinLength(10)
  @MaxLength(3000)
  note!: string;
}

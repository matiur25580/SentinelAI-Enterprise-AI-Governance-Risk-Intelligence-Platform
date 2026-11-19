import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export class ReviewRiskAssessmentDto {
  @IsIn(["APPROVED", "REJECTED"])
  decision!: "APPROVED" | "REJECTED";

  @IsString()
  @MinLength(10)
  @MaxLength(3000)
  rationale!: string;
}

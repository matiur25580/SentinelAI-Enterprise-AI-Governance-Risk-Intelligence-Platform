import { ArrayMaxSize, IsArray, IsInt, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateRiskAssessmentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(3000)
  scope!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  intendedUse!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  dataSensitivity!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  autonomyLevel!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  impact!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  likelihood!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  exposure!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  mitigationCoverage!: number;

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  evidence!: string[];
}

import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import { RiskAssessmentStatus, RiskLevel } from "../../generated/prisma/client.js";

export class RiskAssessmentQueryDto {
  @IsOptional()
  @IsEnum(RiskAssessmentStatus)
  status?: RiskAssessmentStatus;

  @IsOptional()
  @IsEnum(RiskLevel)
  residualLevel?: RiskLevel;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

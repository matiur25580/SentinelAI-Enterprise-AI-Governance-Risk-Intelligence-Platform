import { IsDateString, IsOptional } from "class-validator";

export class GovernanceReportQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

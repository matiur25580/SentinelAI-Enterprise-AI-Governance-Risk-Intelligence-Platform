import { Type } from "class-transformer";
import { IncidentSeverity, IncidentStatus } from "../../generated/prisma/client.js";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";

export class IncidentQueryDto {
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;

  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;

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

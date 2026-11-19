import { IncidentSeverity } from "../../generated/prisma/client.js";
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateIncidentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(180)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @IsEnum(IncidentSeverity)
  severity!: IncidentSeverity;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  assetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

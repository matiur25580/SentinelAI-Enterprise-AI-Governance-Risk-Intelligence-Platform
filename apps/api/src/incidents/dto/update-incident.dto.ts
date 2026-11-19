import { IncidentStatus } from "../../generated/prisma/client.js";
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UpdateIncidentDto {
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(3000)
  resolution?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignedToMembershipId?: string | null;
}

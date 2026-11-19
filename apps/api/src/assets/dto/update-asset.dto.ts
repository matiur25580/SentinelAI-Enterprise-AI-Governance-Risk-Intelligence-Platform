import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { AssetStatus } from "../../generated/prisma/client.js";

export class UpdateAssetDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  modelIdentifier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  version?: string;

  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;
}

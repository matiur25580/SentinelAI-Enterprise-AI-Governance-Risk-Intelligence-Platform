import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { AssetType } from "../../generated/prisma/client.js";

export class CreateAssetDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsEnum(AssetType)
  assetType!: AssetType;

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
}

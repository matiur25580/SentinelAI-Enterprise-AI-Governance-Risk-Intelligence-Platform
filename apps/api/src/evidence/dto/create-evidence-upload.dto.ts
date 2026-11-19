import { IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateEvidenceUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  fileName!: string;

  @IsString()
  @Matches(/^(application\/pdf|image\/(png|jpeg)|text\/(plain|csv))$/)
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024)
  sizeBytes!: number;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/i)
  checksumSha256!: string;
}

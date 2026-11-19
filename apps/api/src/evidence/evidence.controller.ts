import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { CreateEvidenceUploadDto } from "./dto/create-evidence-upload.dto.js";
import { VerifyEvidenceDto } from "./dto/verify-evidence.dto.js";
import { PurgeEvidenceDto } from "./dto/purge-evidence.dto.js";
import { EvidenceLegalHoldDto } from "./dto/evidence-legal-hold.dto.js";
import { EvidenceStorageService } from "./evidence-storage.service.js";

@UseGuards(JwtAuthGuard)
@Controller("risk-assessments/:assessmentId/evidence")
export class EvidenceController {
  constructor(private readonly service: EvidenceStorageService) {}

  @Post("upload-intents")
  createUpload(@CurrentUser() user: AuthenticatedUser, @Param("assessmentId") assessmentId: string, @Body() dto: CreateEvidenceUploadDto) {
    return this.service.createUpload(user, assessmentId, dto);
  }

  @Post(":evidenceId/complete")
  complete(@CurrentUser() user: AuthenticatedUser, @Param("assessmentId") assessmentId: string, @Param("evidenceId") evidenceId: string) {
    return this.service.completeUpload(user, assessmentId, evidenceId);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("assessmentId") assessmentId: string) {
    return this.service.list(user, assessmentId);
  }

  @Post(":evidenceId/download")
  download(@CurrentUser() user: AuthenticatedUser, @Param("assessmentId") assessmentId: string, @Param("evidenceId") evidenceId: string) {
    return this.service.download(user, assessmentId, evidenceId);
  }

  @Post(":evidenceId/decision")
  decide(@CurrentUser() user: AuthenticatedUser, @Param("assessmentId") assessmentId: string, @Param("evidenceId") evidenceId: string, @Body() dto: VerifyEvidenceDto) {
    return this.service.decide(user, assessmentId, evidenceId, dto);
  }
  @Post(":evidenceId/rescan")
  rescan(@CurrentUser() user: AuthenticatedUser, @Param("assessmentId") assessmentId: string, @Param("evidenceId") evidenceId: string) {
    return this.service.rescanQuarantined(user, assessmentId, evidenceId);
  }

  @Post(":evidenceId/legal-hold")
  placeLegalHold(@CurrentUser() user: AuthenticatedUser, @Param("assessmentId") assessmentId: string, @Param("evidenceId") evidenceId: string, @Body() dto: EvidenceLegalHoldDto) {
    return this.service.placeLegalHold(user, assessmentId, evidenceId, dto);
  }

  @Post(":evidenceId/legal-hold/release")
  releaseLegalHold(@CurrentUser() user: AuthenticatedUser, @Param("assessmentId") assessmentId: string, @Param("evidenceId") evidenceId: string, @Body() dto: EvidenceLegalHoldDto) {
    return this.service.releaseLegalHold(user, assessmentId, evidenceId, dto);
  }

  @Post(":evidenceId/purge")
  purge(@CurrentUser() user: AuthenticatedUser, @Param("assessmentId") assessmentId: string, @Param("evidenceId") evidenceId: string, @Body() dto: PurgeEvidenceDto) {
    return this.service.purgeQuarantined(user, assessmentId, evidenceId, dto);
  }

}

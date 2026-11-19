import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { EvidenceController } from "./evidence.controller.js";
import { EvidenceStorageService } from "./evidence-storage.service.js";
import { S3CompatibleStorage } from "./s3-compatible-storage.js";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [EvidenceController],
  providers: [EvidenceStorageService, S3CompatibleStorage],
})
export class EvidenceModule {}

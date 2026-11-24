import { Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import { EvidenceRetentionService } from "./evidence-retention.service.js";

@Controller("internal/evidence-retention")
export class EvidenceRetentionController {
  constructor(
    private readonly config: ConfigService,
    private readonly retention: EvidenceRetentionService,
  ) {}

  // Keep the scheduled cleanup endpoint internal by requiring its configured shared token.
  @Post("run")
  async run(@Headers("x-evidence-retention-token") suppliedToken?: string) {
    const expectedToken = this.config.get<string>("EVIDENCE_RETENTION_CRON_TOKEN");
    if (!expectedToken || !suppliedToken) throw new UnauthorizedException();
    const expected = Buffer.from(expectedToken);
    const supplied = Buffer.from(suppliedToken);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new UnauthorizedException();
    }
    return this.retention.runCleanup();
  }
}

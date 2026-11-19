import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class AccountEmailService {
  constructor(private readonly config: ConfigService) {}

  async send(to: string, subject: string, text: string): Promise<void> {
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    const from = this.config.get<string>("EMAIL_FROM");
    if (!apiKey || !from) {
      if (this.config.get<string>("NODE_ENV") !== "production") return;
      throw new ServiceUnavailableException("Email delivery is not configured.");
    }

    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException("Email delivery is temporarily unavailable.");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Email delivery is temporarily unavailable.");
    }
  }

  publicUrl(path: string, token: string): string {
    const origin = this.config.get<string>("APP_PUBLIC_URL");
    if (!origin) {
      if (this.config.get<string>("NODE_ENV") !== "production") {
        return `http://localhost:3000/${path}?token=${encodeURIComponent(token)}`;
      }
      throw new ServiceUnavailableException("Public application URL is not configured.");
    }
    const url = new URL(path, origin);
    url.searchParams.set("token", token);
    return url.toString();
  }
}

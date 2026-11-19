import net from "node:net";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export type MalwareScanResult = { clean: true } | { clean: false; signature: string };

@Injectable()
export class ClamAvScanner {
  constructor(private readonly config: ConfigService) {}

  async scan(bytes: Buffer): Promise<MalwareScanResult> {
    const host = this.config.get<string>("CLAMAV_HOST");
    const port = Number(this.config.get<string>("CLAMAV_PORT") ?? 3310);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ServiceUnavailableException("Evidence malware scanning is not configured; upload completion is blocked.");
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const response: Buffer[] = [];
      let settled = false;
      const finish = (error?: Error, result?: MalwareScanResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(result!);
      };
      socket.setTimeout(15_000);
      socket.on("connect", () => {
        socket.write(Buffer.from("zINSTREAM\\0"));
        for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
          const chunk = bytes.subarray(offset, Math.min(offset + 64 * 1024, bytes.length));
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on("data", (chunk) => {
        response.push(chunk);
        const text = Buffer.concat(response).toString("utf8");
        if (!text.includes("\\0")) return;
        if (text.includes(" OK\\0")) finish(undefined, { clean: true });
        else if (text.includes(" FOUND\\0")) {
          const signature = text.split(": ").pop()?.replace(/ FOUND\\0$/, "") ?? "Malware";
          finish(undefined, { clean: false, signature });
        } else finish(new Error("ClamAV returned an unexpected scan response."));
      });
      socket.on("timeout", () => finish(new Error("ClamAV scan timed out.")));
      socket.on("error", () => finish(new Error("ClamAV scanner is unavailable.")));
      socket.on("end", () => {
        if (!settled) finish(new Error("ClamAV closed the connection before returning a result."));
      });
    }).catch(() => {
      throw new ServiceUnavailableException("Evidence malware scanning failed or timed out; the file remains unavailable.");
    });
  }
}

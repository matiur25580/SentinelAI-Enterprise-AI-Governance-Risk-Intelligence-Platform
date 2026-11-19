import { createHash, createHmac } from "node:crypto";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type PresignedRequest = { url: string; headers: Record<string, string> };

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase());
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string, encoding?: "hex") {
  return createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

@Injectable()
export class S3CompatibleStorage {
  constructor(private readonly config: ConfigService) {}

  private settings() {
    const endpointValue = this.config.get<string>("EVIDENCE_S3_ENDPOINT");
    const bucket = this.config.get<string>("EVIDENCE_S3_BUCKET");
    const region = this.config.get<string>("EVIDENCE_S3_REGION");
    const accessKey = this.config.get<string>("EVIDENCE_S3_ACCESS_KEY_ID");
    const secretKey = this.config.get<string>("EVIDENCE_S3_SECRET_ACCESS_KEY");
    const sessionToken = this.config.get<string>("EVIDENCE_S3_SESSION_TOKEN");
    if (!endpointValue || !bucket || !region || !accessKey || !secretKey) {
      throw new ServiceUnavailableException("Private evidence storage is not configured.");
    }
    const endpoint = new URL(endpointValue);
    if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new ServiceUnavailableException("Evidence storage endpoint configuration is invalid.");
    }
    return { endpoint, bucket, region, accessKey, secretKey, sessionToken };
  }

  private objectUrl(key: string) {
    const { endpoint, bucket } = this.settings();
    const basePath = endpoint.pathname.replace(/\/$/, "");
    const objectPath = key.split("/").map(awsEncode).join("/");
    const url = new URL(endpoint.toString());
    url.pathname = basePath + "/" + awsEncode(bucket) + "/" + objectPath;
    return url;
  }

  private signingKey(secret: string, date: string, region: string) {
    const dateKey = createHmac("sha256", "AWS4" + secret).update(date).digest();
    const regionKey = createHmac("sha256", dateKey).update(region).digest();
    const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
    return createHmac("sha256", serviceKey).update("aws4_request").digest();
  }

  presign(method: "PUT" | "GET", key: string, expiresSeconds: number, contentType?: string, checksumBase64?: string): PresignedRequest {
    const { endpoint, region, accessKey, secretKey, sessionToken } = this.settings();
    const url = this.objectUrl(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const scope = date + "/" + region + "/s3/aws4_request";
    const headers: Record<string, string> = { host: url.host };
    if (method === "PUT") {
      if (!contentType || !checksumBase64) throw new Error("Upload content type and checksum are required.");
      headers["content-type"] = contentType;
      headers["x-amz-checksum-sha256"] = checksumBase64;
    }
    const signedHeaders = Object.keys(headers).sort().join(";");
    const query: Array<[string, string]> = [
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", accessKey + "/" + scope],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(expiresSeconds)],
      ["X-Amz-SignedHeaders", signedHeaders],
    ];
    if (sessionToken) query.push(["X-Amz-Security-Token", sessionToken]);
    const canonicalQuery = query.map(([k,v]) => [awsEncode(k),awsEncode(v)] as const).sort((a,b) => a[0].localeCompare(b[0])).map(([k,v]) => k + "=" + v).join("&");
    const canonicalHeaders = Object.keys(headers).sort().map(name => name + ":" + headers[name].trim() + "\n").join("");
    const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signatureValue = signature(this.signingKey(secretKey, date, region), stringToSign);
    url.search = canonicalQuery + "&X-Amz-Signature=" + signatureValue;
    return {
      url: url.toString(),
      headers: method === "PUT" ? { "content-type": contentType!, "x-amz-checksum-sha256": checksumBase64! } : {},
    };
  }

  async inspectObject(key: string) {
    const { region, accessKey, secretKey, sessionToken } = this.settings();
    const url = this.objectUrl(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const payloadHash = "UNSIGNED-PAYLOAD";
    const headers: Record<string,string> = {
      host: url.host,
      "x-amz-checksum-mode": "ENABLED",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (sessionToken) headers["x-amz-security-token"] = sessionToken;
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort().map(name => name + ":" + headers[name].trim() + "\n").join("");
    const canonicalRequest = ["HEAD", url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = date + "/" + region + "/s3/aws4_request";
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signatureValue = signature(this.signingKey(secretKey, date, region), stringToSign);
    const authorization = "AWS4-HMAC-SHA256 Credential=" + accessKey + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signatureValue;
    const response = await fetch(url, {
      method: "HEAD",
      headers: { ...headers, authorization },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new ServiceUnavailableException("Evidence object storage could not verify the uploaded object.");
    const sizeBytes = Number(response.headers.get("content-length"));
    const checksum = response.headers.get("x-amz-checksum-sha256");
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    return { sizeBytes, checksumSha256: checksum, contentType };
  }
}

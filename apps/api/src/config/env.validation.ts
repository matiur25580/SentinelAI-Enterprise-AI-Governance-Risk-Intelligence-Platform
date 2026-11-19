const PLACEHOLDER_SECRET_PREFIXES = ["replace-", "change-this", "your-"];

export function validateEnvironment(config: Record<string, unknown>) {
  const errors: string[] = [];
  const nodeEnv = String(config.NODE_ENV ?? "development");
  if (!["development", "test", "production"].includes(nodeEnv)) errors.push("NODE_ENV must be development, test, or production.");

  for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const) {
    const value = config[key];
    if (typeof value !== "string" || value.length < 32) { errors.push(`${key} must contain at least 32 characters.`); continue; }
    if (PLACEHOLDER_SECRET_PREFIXES.some((prefix) => value.toLowerCase().startsWith(prefix))) errors.push(`${key} must not use a placeholder value.`);
  }
  if (typeof config.JWT_ACCESS_SECRET === "string" && typeof config.JWT_REFRESH_SECRET === "string" && config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) errors.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.");

  const databaseUrl = config.DATABASE_URL;
  if (typeof databaseUrl !== "string") errors.push("DATABASE_URL is required.");
  else {
    try { const parsed = new URL(databaseUrl); if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") errors.push("DATABASE_URL must use the PostgreSQL protocol."); }
    catch { errors.push("DATABASE_URL must be a valid PostgreSQL connection URL."); }
  }

  const port = Number(config.API_PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("API_PORT must be an integer between 1 and 65535.");
  if (config.TRUST_PROXY_HOPS !== undefined) { const hops = Number(config.TRUST_PROXY_HOPS); if (!Number.isInteger(hops) || hops < 1) errors.push("TRUST_PROXY_HOPS must be a positive integer when configured."); }
  if (config.METRICS_BEARER_TOKEN !== undefined) {
    const token = config.METRICS_BEARER_TOKEN;
    if (typeof token !== "string" || token.length < 32 || /\\s/.test(token) || PLACEHOLDER_SECRET_PREFIXES.some((prefix) => token.toLowerCase().startsWith(prefix))) {
      errors.push("METRICS_BEARER_TOKEN must be at least 32 non-whitespace characters and must not be a placeholder.");
    }
  }

  const evidenceStorageKeys = ["EVIDENCE_S3_ENDPOINT", "EVIDENCE_S3_BUCKET", "EVIDENCE_S3_REGION", "EVIDENCE_S3_ACCESS_KEY_ID", "EVIDENCE_S3_SECRET_ACCESS_KEY"] as const;
  const configuredEvidenceKeys = evidenceStorageKeys.filter((key) => typeof config[key] === "string" && String(config[key]).length > 0);
  if (configuredEvidenceKeys.length > 0 && configuredEvidenceKeys.length !== evidenceStorageKeys.length) {
    errors.push("Evidence storage requires EVIDENCE_S3_ENDPOINT, EVIDENCE_S3_BUCKET, EVIDENCE_S3_REGION, EVIDENCE_S3_ACCESS_KEY_ID, and EVIDENCE_S3_SECRET_ACCESS_KEY together.");
  }
  if (typeof config.EVIDENCE_S3_ENDPOINT === "string") {
    try {
      const endpoint = new URL(config.EVIDENCE_S3_ENDPOINT);
      if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) errors.push("EVIDENCE_S3_ENDPOINT must be a valid object storage endpoint without credentials, query, or fragment.");
      if (nodeEnv === "production" && endpoint.protocol !== "https:") errors.push("EVIDENCE_S3_ENDPOINT must use HTTPS in production.");
    } catch { errors.push("EVIDENCE_S3_ENDPOINT must be a valid URL."); }
  }
  if (typeof config.EVIDENCE_S3_SESSION_TOKEN === "string" && configuredEvidenceKeys.length !== evidenceStorageKeys.length) {
    errors.push("EVIDENCE_S3_SESSION_TOKEN requires the complete evidence storage configuration.");
  }

  const clamavHost = config.CLAMAV_HOST;
  const clamavPort = Number(config.CLAMAV_PORT ?? 3310);
  if (clamavHost !== undefined && (typeof clamavHost !== "string" || clamavHost.trim().length === 0)) errors.push("CLAMAV_HOST must be a non-empty hostname when configured.");
  if (config.CLAMAV_PORT !== undefined && (!Number.isInteger(clamavPort) || clamavPort < 1 || clamavPort > 65535)) errors.push("CLAMAV_PORT must be an integer between 1 and 65535.");
  if (nodeEnv === "production" && configuredEvidenceKeys.length === evidenceStorageKeys.length && !clamavHost) errors.push("CLAMAV_HOST is required when private evidence storage is enabled in production.");

  const origins = typeof config.WEB_ORIGIN === "string" ? config.WEB_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean) : [];
  if (nodeEnv === "production" && origins.length === 0) errors.push("WEB_ORIGIN must be explicitly configured in production.");
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) { errors.push("WEB_ORIGIN entries must be valid origins without paths or credentials."); break; }
      if (nodeEnv === "production" && parsed.protocol !== "https:") { errors.push("WEB_ORIGIN must use HTTPS in production."); break; }
    } catch { errors.push("WEB_ORIGIN must contain comma-separated valid origins."); break; }
  }
  if (errors.length > 0) throw new Error(`Invalid environment configuration: ${errors.join(" ")}`);
  return { ...config, NODE_ENV: nodeEnv, API_PORT: port };
}

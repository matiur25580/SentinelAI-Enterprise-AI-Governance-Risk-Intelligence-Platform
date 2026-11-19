#!/usr/bin/env node

const apiValue = process.env.API_BASE_URL;
const webValue = process.env.WEB_ORIGIN;
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? "8000");

function parseBaseUrl(value, name) {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query parameters, or fragments`);
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`${name} must use HTTPS (HTTP is allowed only for localhost)`);
  }
  return url;
}

async function probe(name, url, validate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "application/json, text/html;q=0.9, */*;q=0.8" },
      signal: controller.signal,
    });
    const body = await response.text();
    const result = await validate(response, body);
    if (!result.ok) {
      console.error(`FAIL ${name}: ${result.reason}`);
      return false;
    }
    console.log(`PASS ${name}: HTTP ${response.status}`);
    return true;
  } catch (error) {
    const reason = error?.name === "AbortError" ? `timed out after ${timeoutMs}ms` : error.message;
    console.error(`FAIL ${name}: ${reason}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new Error("SMOKE_TIMEOUT_MS must be an integer from 1000 to 30000");
  }

  const api = parseBaseUrl(apiValue, "API_BASE_URL");
  const checks = [
    ["API liveness", new URL("/api/v1/health", api), async (response, body) => {
      if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
      try {
        const data = JSON.parse(body);
        return data.status === "ok" && data.service === "sentinelai-api"
          ? { ok: true }
          : { ok: false, reason: "unexpected liveness payload" };
      } catch {
        return { ok: false, reason: "response was not valid JSON" };
      }
    }],
    ["API database readiness", new URL("/api/v1/health/ready", api), async (response, body) => {
      if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
      try {
        const data = JSON.parse(body);
        return data.status === "ok" && data.checks?.database === "ok"
          ? { ok: true }
          : { ok: false, reason: "database readiness check did not report ok" };
      } catch {
        return { ok: false, reason: "response was not valid JSON" };
      }
    }],
  ];

  if (webValue) {
    const web = parseBaseUrl(webValue, "WEB_ORIGIN");
    checks.push(["Web origin", web, async (response) => (
      response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status}` }
    )]);
  }

  let passed = 0;
  for (const [name, url, validate] of checks) {
    if (await probe(name, url, validate)) passed += 1;
  }
  console.log(`Smoke checks: ${passed}/${checks.length} passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Configuration error: ${error.message}`);
  process.exitCode = 2;
});

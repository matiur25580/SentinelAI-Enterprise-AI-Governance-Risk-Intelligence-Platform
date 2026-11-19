import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

let server;
let baseUrl;
let readinessStatus = 200;
let readinessPayload = { status: "ok", checks: { database: "ok" } };

before(async () => {
  server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/health") {
      response.writeHead(200);
      response.end(JSON.stringify({ status: "ok", service: "sentinelai-api" }));
      return;
    }
    if (request.url === "/api/v1/health/ready") {
      response.writeHead(readinessStatus);
      response.end(JSON.stringify(readinessPayload));
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>SentinelAI</title>");
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

function runSmoke(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/production-smoke-check.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        API_BASE_URL: baseUrl,
        WEB_ORIGIN: "",
        SMOKE_TIMEOUT_MS: "2000",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("passes API liveness and database readiness, plus optional web origin", async () => {
  readinessStatus = 200;
  readinessPayload = { status: "ok", checks: { database: "ok" } };
  const result = await runSmoke({ WEB_ORIGIN: baseUrl });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /PASS API liveness: HTTP 200/);
  assert.match(result.stdout, /PASS API database readiness: HTTP 200/);
  assert.match(result.stdout, /PASS Web origin: HTTP 200/);
  assert.match(result.stdout, /Smoke checks: 3\/3 passed/);
});

test("fails when the database readiness endpoint reports unavailable", async () => {
  readinessStatus = 503;
  readinessPayload = { status: "error", checks: { database: "unavailable" } };
  const result = await runSmoke();
  assert.equal(result.code, 1);
  assert.match(result.stderr, /FAIL API database readiness: HTTP 503/);
  assert.match(result.stdout, /Smoke checks: 1\/2 passed/);
});

test("rejects a non-HTTPS non-local API origin before making requests", async () => {
  const result = await runSmoke({ API_BASE_URL: "http://example.com" });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /API_BASE_URL must use HTTPS/);
});

test("rejects missing API configuration", async () => {
  const result = await runSmoke({ API_BASE_URL: "" });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /API_BASE_URL is required/);
});

test("rejects credentials in configured origins", async () => {
  const result = await runSmoke({ API_BASE_URL: "http://user:secret@127.0.0.1" });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /must not contain credentials/);
});

test("rejects out-of-range request timeouts", async () => {
  const result = await runSmoke({ SMOKE_TIMEOUT_MS: "100" });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /SMOKE_TIMEOUT_MS must be an integer/);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import pg from "pg";

const { Pool } = pg;

const port = 4319;
const baseUrl = `http://127.0.0.1:${port}/api/v1`;
let apiProcess;
let apiOutput = "";

async function resetAuthRateLimits() {
  const database = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await database.query('DELETE FROM "ApiRateLimitBucket"'); }
  finally { await database.end(); }
}

async function request(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  return { response, data };
}

before(async () => {
  // Integration suites share PostgreSQL; isolate their authentication rate-limit buckets.
  await resetAuthRateLimits();
  apiProcess = spawn(process.execPath, ["dist/main.js"], {
    cwd: process.cwd(),
    env: { ...process.env, API_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout.on("data", chunk => { apiOutput += chunk.toString(); });
  apiProcess.stderr.on("data", chunk => { apiOutput += chunk.toString(); });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error(`API exited before becoming healthy.\n${apiOutput}`);
    try { const health = await request("/health"); if (health.response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy.\n${apiOutput}`);
});

test("incident lifecycle is audited, role-protected, and organization-scoped", { timeout: 90_000 }, async () => {
  const suffix = Date.now();
  const password = "Incident-Workflow-Integration-2026!";
  const owner = await request("/auth/register", { method: "POST", body: {
    name: "Incident Owner", email: `incident-owner-${suffix}@example.test`, password, organizationName: "Incident Workspace",
  }});
  assert.equal(owner.response.status, 201, JSON.stringify(owner.data));
  const token = owner.data.accessToken;

  const created = await request("/incidents", { method: "POST", token, body: {
    title: "Unexpected sensitive output in assistant response",
    description: "A production assistant response appears to contain customer information that should not have been disclosed.",
    severity: "HIGH",
    source: "Customer escalation",
  }});
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.status, "OPEN");

  const invalidSkip = await request(`/incidents/${created.data.id}`, { method: "PATCH", token, body: { status: "INVESTIGATING" } });
  assert.equal(invalidSkip.response.status, 409);

  const triaged = await request(`/incidents/${created.data.id}`, { method: "PATCH", token, body: { status: "TRIAGED" } });
  assert.equal(triaged.response.status, 200, JSON.stringify(triaged.data));
  const investigating = await request(`/incidents/${created.data.id}`, { method: "PATCH", token, body: { status: "INVESTIGATING" } });
  assert.equal(investigating.response.status, 200);
  const missingResolution = await request(`/incidents/${created.data.id}`, { method: "PATCH", token, body: { status: "RESOLVED" } });
  assert.equal(missingResolution.response.status, 400);
  const resolved = await request(`/incidents/${created.data.id}`, { method: "PATCH", token, body: {
    status: "RESOLVED", resolution: "The output path was disabled and the affected customer was notified through the approved process.",
  }});
  assert.equal(resolved.response.status, 200, JSON.stringify(resolved.data));
  assert.ok(resolved.data.resolvedAt);
  const closed = await request(`/incidents/${created.data.id}`, { method: "PATCH", token, body: { status: "CLOSED" } });
  assert.equal(closed.response.status, 200);
  assert.ok(closed.data.closedAt);
  const reopenClosed = await request(`/incidents/${created.data.id}`, { method: "PATCH", token, body: { status: "INVESTIGATING" } });
  assert.equal(reopenClosed.response.status, 409);

  const filtered = await request("/incidents?severity=HIGH&status=CLOSED&page=1&limit=10", { token });
  assert.equal(filtered.response.status, 200);
  assert.equal(filtered.data.pagination.total, 1);
  assert.equal(filtered.data.data[0].id, created.data.id);

  const outsider = await request("/auth/register", { method: "POST", body: {
    name: "Other Tenant", email: `incident-outsider-${suffix}@example.test`, password, organizationName: "Other Incident Workspace",
  }});
  assert.equal(outsider.response.status, 201);
  const outsiderList = await request("/incidents", { token: outsider.data.accessToken });
  assert.equal(outsiderList.response.status, 200);
  assert.equal(outsiderList.data.pagination.total, 0);
  const outsiderDetail = await request(`/incidents/${created.data.id}`, { token: outsider.data.accessToken });
  assert.equal(outsiderDetail.response.status, 404);

  const audit = await request("/audit-logs?action=incident.create", { token });
  assert.equal(audit.response.status, 200);
  assert.equal(audit.data.pagination.total, 1);
  const integrity = await request("/audit-logs/integrity", { token });
  assert.equal(integrity.response.status, 200);
  assert.equal(integrity.data.verified, true, JSON.stringify(integrity.data));
});

after(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill("SIGTERM");
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 5_000);
      apiProcess.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
});

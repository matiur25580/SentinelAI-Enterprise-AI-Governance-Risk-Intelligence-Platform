import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import pg from "pg";
import { inflateRawSync } from "node:zlib";

const { Pool } = pg;

const port = 4320;
const baseUrl = `http://127.0.0.1:${port}/api/v1`;
let apiProcess;
let apiOutput = "";

async function resetAuthRateLimits() {
  const database = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await database.query('DELETE FROM "ApiRateLimitBucket"'); }
  finally { await database.end(); }
}

async function requestBuffer(path, { token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { response, buffer: Buffer.from(await response.arrayBuffer()) };
}

function unzipLocalEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    assert.equal(method, 8, "ZIP entries use DEFLATE");
    entries.set(name, inflateRawSync(compressed));
    offset = dataStart + compressedSize;
  }
  return entries;
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
  return { response, data, raw };
}

before(async () => {
  // Integration suites share PostgreSQL; isolate their authentication rate-limit buckets.
  await resetAuthRateLimits();
  apiProcess = spawn(process.execPath, ["dist/main.js"], {
    cwd: process.cwd(), env: { ...process.env, API_PORT: String(port) },
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

test("governance report and downloadable PDF/ZIP audit package stay organization-scoped", { timeout: 90_000 }, async () => {
  const suffix = Date.now();
  const password = "Governance-Report-Integration-2026!";
  const owner = await request("/auth/register", { method: "POST", body: {
    name: "Report Owner", email: `report-owner-${suffix}@example.test`, password, organizationName: "Report Workspace",
  }});
  assert.equal(owner.response.status, 201, JSON.stringify(owner.data));
  const token = owner.data.accessToken;

  const empty = await request("/governance/reports/summary", { token });
  assert.equal(empty.response.status, 200, JSON.stringify(empty.data));
  assert.equal(empty.data.assets.total, 0);
  assert.equal(empty.data.assessments.total, 0);
  assert.equal(empty.data.incidents.total, 0);
  assert.equal(empty.data.evidence.total, 0);
  assert.equal(empty.data.audit.total, 1, "workspace registration is retained in the audit chain");

  const incident = await request("/incidents", { method: "POST", token, body: {
    title: "Governance report test incident",
    description: "An integration test incident used to verify report aggregation and tenant boundaries.",
    severity: "CRITICAL",
    source: "Automated integration test",
  }});
  assert.equal(incident.response.status, 201, JSON.stringify(incident.data));

  const report = await request("/governance/reports/summary", { token });
  assert.equal(report.response.status, 200, JSON.stringify(report.data));
  assert.equal(report.data.incidents.total, 1);
  assert.deepEqual(report.data.incidents.bySeverity, [{ severity: "CRITICAL", count: 1 }]);
  assert.equal(report.data.audit.total, 2);
  assert.equal(report.data.audit.recentActivity[0].action, "incident.create");

  const invalidRange = await request("/governance/reports/summary?from=2026-11-20T00:00:00.000Z&to=2026-11-01T00:00:00.000Z", { token });
  assert.equal(invalidRange.response.status, 400);

  const csv = await request("/governance/reports/export.csv", { token });
  assert.equal(csv.response.status, 200);
  assert.match(csv.response.headers.get("content-type") || "", /text\/csv/);
  assert.match(csv.raw, /AI incidents/);
  assert.match(csv.raw, /Incident severity: CRITICAL/);


  const archiveResponse = await requestBuffer("/governance/reports/export.zip", { token });
  assert.equal(archiveResponse.response.status, 200);
  assert.match(archiveResponse.response.headers.get("content-type") || "", /application\/zip/);
  assert.match(archiveResponse.response.headers.get("content-disposition") || "", /sentinelai-governance-audit-package\.zip/);
  assert.equal(archiveResponse.response.headers.get("cache-control"), "no-store");
  assert.equal(archiveResponse.buffer.subarray(0, 4).toString("hex"), "504b0304", "response is a ZIP archive");
  const packageFiles = unzipLocalEntries(archiveResponse.buffer);
  for (const name of ["README.txt", "report.pdf", "manifest.json", "governance-summary.json", "assets.csv", "risk-assessments.csv", "evidence-inventory.csv", "incidents.csv", "audit-trail.csv"]) {
    assert.ok(packageFiles.has(name), `package includes ${name}`);
  }
  assert.equal(packageFiles.get("report.pdf").subarray(0, 8).toString("ascii"), "%PDF-1.4");
  const packageData = JSON.parse(packageFiles.get("governance-summary.json").toString("utf8"));
  assert.equal(packageData.inventory.incidents.length, 1);
  assert.equal(packageData.inventory.incidents[0].title, "Governance report test incident");
  assert.ok(packageData.inventory.auditEvents.some(event => event.action === "governance.audit_package_export"));
  assert.equal(packageData.auditIntegrity.verified, true);
  const packageText = packageFiles.get("governance-summary.json").toString("utf8");
  assert.doesNotMatch(packageText, /storageKey|signedUrl|secretAccessKey|passwordHash/);

  const filteredArchive = await requestBuffer("/governance/reports/export.zip?from=2035-01-01T00:00:00.000Z&to=2035-01-02T00:00:00.000Z", { token });
  assert.equal(filteredArchive.response.status, 200);
  const filteredFiles = unzipLocalEntries(filteredArchive.buffer);
  const filteredData = JSON.parse(filteredFiles.get("governance-summary.json").toString("utf8"));
  assert.equal(filteredData.inventory.incidents.length, 0, "date filters constrain detailed ZIP inventories");
  assert.equal(filteredData.inventory.auditEvents.length, 0, "date filters constrain selected-period audit rows");
  assert.equal(filteredData.auditIntegrity.verified, true, "integrity check still verifies the full organization chain");


  const outsider = await request("/auth/register", { method: "POST", body: {
    name: "Other Tenant", email: `report-outsider-${suffix}@example.test`, password, organizationName: "Other Report Workspace",
  }});
  assert.equal(outsider.response.status, 201);
  const isolated = await request("/governance/reports/summary", { token: outsider.data.accessToken });
  assert.equal(isolated.response.status, 200);
  assert.equal(isolated.data.incidents.total, 0);
  assert.equal(isolated.data.audit.total, 1);
  const outsiderPackage = await requestBuffer("/governance/reports/export.zip", { token: outsider.data.accessToken });
  assert.equal(outsiderPackage.response.status, 200);
  const outsiderFiles = unzipLocalEntries(outsiderPackage.buffer);
  const outsiderData = JSON.parse(outsiderFiles.get("governance-summary.json").toString("utf8"));
  assert.equal(outsiderData.inventory.incidents.length, 0, "ZIP export never includes another tenant's incidents");
  assert.ok(!outsiderFiles.get("incidents.csv").toString("utf8").includes("Governance report test incident"));

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

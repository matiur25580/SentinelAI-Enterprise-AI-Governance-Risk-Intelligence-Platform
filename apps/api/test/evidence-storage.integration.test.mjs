import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { after, before, test as nodeTest } from "node:test";
import pg from "pg";

const { Pool } = pg;
const apiPort = 4320;
const storagePort = 4321;
const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
const storageObjects = new Map();
let apiProcess;
let apiOutput = "";
let storageServer;

async function resetAuthRateLimits() {
  const database = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await database.query('DELETE FROM "ApiRateLimitBucket"');
  } finally {
    await database.end();
  }
}

async function request(path, { method = "GET", body, token } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  return { response, data };
}

before(async () => {
  // Keep this integration suite independent from rate-limit buckets left by earlier CI suites.
  const rateLimitDatabase = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await rateLimitDatabase.query('DELETE FROM "ApiRateLimitBucket"');
  } finally {
    await rateLimitDatabase.end();
  }

  storageServer = createServer(async (req, res) => {
    const key = new URL(req.url || "/", `http://127.0.0.1:${storagePort}`).pathname;
    if (req.method === "PUT") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const checksum = createHash("sha256").update(bytes).digest("base64");
      if (checksum !== req.headers["x-amz-checksum-sha256"]) {
        res.writeHead(400).end("checksum mismatch");
        return;
      }
      storageObjects.set(key, { bytes, contentType: req.headers["content-type"], checksum });
      res.writeHead(200).end();
      return;
    }
    const object = storageObjects.get(key);
    if (!object) { res.writeHead(404).end(); return; }
    if (req.method === "HEAD") {
      res.writeHead(200, {
        "content-length": String(object.bytes.length),
        "content-type": object.contentType,
        "x-amz-checksum-sha256": object.checksum,
      }).end();
      return;
    }
    if (req.method === "GET") {
      res.writeHead(200, { "content-length": String(object.bytes.length), "content-type": object.contentType }).end(object.bytes);
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise((resolve) => storageServer.listen(storagePort, "127.0.0.1", resolve));

  apiProcess = spawn(process.execPath, ["dist/main.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(apiPort),
      EVIDENCE_S3_ENDPOINT: `http://127.0.0.1:${storagePort}`,
      EVIDENCE_S3_BUCKET: "sentinel-evidence-test",
      EVIDENCE_S3_REGION: "us-east-1",
      EVIDENCE_S3_ACCESS_KEY_ID: "ci-evidence-access-key",
      EVIDENCE_S3_SECRET_ACCESS_KEY: "ci-evidence-secret-key-for-local-tests",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout.on("data", (chunk) => { apiOutput += chunk.toString(); });
  apiProcess.stderr.on("data", (chunk) => { apiOutput += chunk.toString(); });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error("API exited before becoming healthy.\n" + apiOutput);
    try {
      const health = await request("/health");
      if (health.response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("API did not become healthy within 30 seconds.\n" + apiOutput);
});

nodeTest("private evidence upload, checksum validation, tenant isolation, and independent verification", { timeout: 120_000 }, async () => {
  const suffix = Date.now();
  const password = "Evidence-Workflow-Integration-2026!";
  const ownerEmail = `evidence-owner-${suffix}@example.test`;
  const reviewerEmail = `evidence-reviewer-${suffix}@example.test`;
  const outsiderEmail = `evidence-outsider-${suffix}@example.test`;

  await resetAuthRateLimits();
  const ownerRegister = await request("/auth/register", {
    method: "POST",
    body: { name: "Evidence Owner", email: ownerEmail, password, organizationName: "Evidence Governance Workspace" },
  });
  assert.equal(ownerRegister.response.status, 201, JSON.stringify(ownerRegister.data));
  const ownerToken = ownerRegister.data.accessToken;
  const ownerProfile = await request("/auth/me", { token: ownerToken });

  const asset = await request("/assets", {
    method: "POST", token: ownerToken,
    body: { name: "Evidence Test AI", assetType: "LLM_APPLICATION", provider: "Internal", modelIdentifier: "evidence-test" },
  });
  assert.equal(asset.response.status, 201, JSON.stringify(asset.data));

  const assessment = await request(`/assets/${asset.data.id}/risk-assessments`, {
    method: "POST", token: ownerToken,
    body: {
      title: "Evidence storage security assessment",
      scope: "Validate private evidence handling, storage integrity, and access control.",
      intendedUse: "Demonstrate an auditable evidence attachment and independent review workflow.",
      dataSensitivity: 2, autonomyLevel: 1, impact: 3, likelihood: 2, exposure: 2, mitigationCoverage: 25,
      evidence: [],
    },
  });
  assert.equal(assessment.response.status, 201, JSON.stringify(assessment.data));
  const assessmentId = assessment.data.id;
  const evidencePath = `/risk-assessments/${assessmentId}/evidence`;

  const badType = await request(evidencePath + "/upload-intents", {
    method: "POST", token: ownerToken,
    body: { fileName: "payload.exe", contentType: "application/x-msdownload", sizeBytes: 10, checksumSha256: "a".repeat(64) },
  });
  assert.equal(badType.response.status, 400);
  const oversized = await request(evidencePath + "/upload-intents", {
    method: "POST", token: ownerToken,
    body: { fileName: "large.pdf", contentType: "application/pdf", sizeBytes: 20 * 1024 * 1024 + 1, checksumSha256: "a".repeat(64) },
  });
  assert.equal(oversized.response.status, 400);
  const pathTraversal = await request(evidencePath + "/upload-intents", {
    method: "POST", token: ownerToken,
    body: { fileName: "../private.pdf", contentType: "application/pdf", sizeBytes: 10, checksumSha256: "a".repeat(64) },
  });
  assert.equal(pathTraversal.response.status, 400);

  const fileBytes = Buffer.from("%PDF-1.7\nSentinelAI evidence fixture\n%%EOF\n");
  const checksum = createHash("sha256").update(fileBytes).digest("hex");
  const intent = await request(evidencePath + "/upload-intents", {
    method: "POST", token: ownerToken,
    body: { fileName: "model-card.pdf", contentType: "application/pdf", sizeBytes: fileBytes.length, checksumSha256: checksum },
  });
  assert.equal(intent.response.status, 201, JSON.stringify(intent.data));
  assert.equal(intent.data.evidence.status, "PENDING_UPLOAD");
  assert.match(intent.data.upload.url, /X-Amz-Signature=/);
  assert.equal(intent.data.upload.method, "PUT");
  assert.equal(intent.data.upload.expiresInSeconds, 300);

  const prematureComplete = await request(evidencePath + "/" + intent.data.evidence.id + "/complete", {
    method: "POST", token: ownerToken,
  });
  assert.equal(prematureComplete.response.status, 409);

  const put = await fetch(intent.data.upload.url, {
    method: "PUT",
    headers: intent.data.upload.headers,
    body: fileBytes,
  });
  assert.equal(put.status, 200);
  const completed = await request(evidencePath + "/" + intent.data.evidence.id + "/complete", {
    method: "POST", token: ownerToken,
  });
  assert.equal(completed.response.status, 201, JSON.stringify(completed.data));
  assert.equal(completed.data.status, "UPLOADED");

  const list = await request(evidencePath, { token: ownerToken });
  assert.equal(list.response.status, 200);
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].checksumSha256, checksum);
  assert.equal(list.data[0].status, "UPLOADED");

  const download = await request(evidencePath + "/" + intent.data.evidence.id + "/download", {
    method: "POST", token: ownerToken,
  });
  assert.equal(download.response.status, 201, JSON.stringify(download.data));
  assert.equal(download.data.method, "GET");
  assert.equal(download.data.expiresInSeconds, 120);
  const downloaded = await fetch(download.data.url);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), fileBytes);

  await resetAuthRateLimits();
  const outsider = await request("/auth/register", {
    method: "POST",
    body: { name: "Evidence Outsider", email: outsiderEmail, password, organizationName: "Unrelated Workspace" },
  });
  assert.equal(outsider.response.status, 201);
  const crossTenantList = await request(evidencePath, { token: outsider.data.accessToken });
  assert.equal(crossTenantList.response.status, 404);
  const crossTenantDownload = await request(evidencePath + "/" + intent.data.evidence.id + "/download", {
    method: "POST", token: outsider.data.accessToken,
  });
  assert.equal(crossTenantDownload.response.status, 404);

  const selfVerify = await request(evidencePath + "/" + intent.data.evidence.id + "/decision", {
    method: "POST", token: ownerToken,
    body: { decision: "VERIFIED", note: "I confirm my own uploaded evidence." },
  });
  assert.equal(selfVerify.response.status, 403);

  await resetAuthRateLimits();
  const reviewer = await request("/auth/register", {
    method: "POST",
    body: { name: "Evidence Reviewer", email: reviewerEmail, password, organizationName: "Reviewer Personal Workspace" },
  });
  assert.equal(reviewer.response.status, 201);
  const database = new Pool({ connectionString: process.env.DATABASE_URL });
  const reviewerMembershipId = `evidence-reviewer-${suffix}`;
  try {
    await database.query(
      'INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "isActive", "createdAt", "updatedAt") SELECT $1, "id", $2, \'SECURITY_ANALYST\', true, NOW(), NOW() FROM "User" WHERE "email" = $3',
      [reviewerMembershipId, ownerProfile.data.organization.id, reviewerEmail],
    );
  } finally {
    await database.end();
  }
  const reviewerLogin = await request("/auth/login", {
    method: "POST",
    body: { email: reviewerEmail, password, organizationSlug: ownerProfile.data.organization.slug },
  });
  assert.equal(reviewerLogin.response.status, 201, JSON.stringify(reviewerLogin.data));

  const verified = await request(evidencePath + "/" + intent.data.evidence.id + "/decision", {
    method: "POST", token: reviewerLogin.data.accessToken,
    body: { decision: "VERIFIED", note: "Checksum, file metadata, and evidence ownership reviewed independently." },
  });
  assert.equal(verified.response.status, 201, JSON.stringify(verified.data));
  assert.equal(verified.data.status, "VERIFIED");
  assert.ok(verified.data.verifiedAt);

  const finalList = await request(evidencePath, { token: ownerToken });
  assert.equal(finalList.response.status, 200);
  assert.equal(finalList.data[0].status, "VERIFIED");
  assert.equal(finalList.data[0].verifiedByMembership.user.name, "Evidence Reviewer");

  const repeatDecision = await request(evidencePath + "/" + intent.data.evidence.id + "/decision", {
    method: "POST", token: reviewerLogin.data.accessToken,
    body: { decision: "REJECTED", note: "Attempt to rewrite a final evidence decision." },
  });
  assert.equal(repeatDecision.response.status, 409);

  const audit = await request("/audit-logs?action=evidence.verify", { token: ownerToken });
  assert.equal(audit.response.status, 200);
  assert.equal(audit.data.pagination.total, 1);
  assert.equal(audit.data.data[0].entityId, intent.data.evidence.id);
});

after(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 5_000);
      apiProcess.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
  if (storageServer) await new Promise((resolve) => storageServer.close(resolve));
});

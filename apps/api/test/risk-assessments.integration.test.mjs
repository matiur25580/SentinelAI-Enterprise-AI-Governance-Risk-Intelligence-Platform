import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import pg from "pg";

const { Pool } = pg;
const port = 4318;
const baseUrl = `http://127.0.0.1:${port}/api/v1`;
let apiProcess;
let apiOutput = "";

async function request(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  return { response, data };
}

before(async () => {
  apiProcess = spawn(process.execPath, ["dist/main.js"], {
    cwd: process.cwd(),
    env: { ...process.env, API_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout.on("data", (chunk) => { apiOutput += chunk.toString(); });
  apiProcess.stderr.on("data", (chunk) => { apiOutput += chunk.toString(); });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error(`API exited before becoming healthy.\n${apiOutput}`);
    try {
      const result = await request("/health");
      if (result.response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy within 30 seconds.\n${apiOutput}`);
});

test("risk assessment scoring, tenant isolation, submission, independent approval, and audit trail", { timeout: 120_000 }, async () => {
  const suffix = Date.now();
  const ownerEmail = `risk-owner-${suffix}@example.test`;
  const reviewerEmail = `risk-reviewer-${suffix}@example.test`;
  const password = "Risk-Workflow-Integration-2026!";
  const ownerRegistration = await request("/auth/register", {
    method: "POST",
    body: { name: "Risk Owner", email: ownerEmail, password, organizationName: "Risk Workflow Workspace" },
  });
  assert.equal(ownerRegistration.response.status, 201, JSON.stringify(ownerRegistration.data));
  const ownerToken = ownerRegistration.data.accessToken;
  const ownerProfile = await request("/auth/me", { token: ownerToken });
  assert.equal(ownerProfile.response.status, 200);

  const asset = await request("/assets", {
    method: "POST",
    token: ownerToken,
    body: { name: "High Impact Decision Agent", assetType: "AI_AGENT", provider: "Internal", modelIdentifier: "decision-agent", version: "1.0.0" },
  });
  assert.equal(asset.response.status, 201, JSON.stringify(asset.data));

  const assessmentInput = {
    title: "Production decision automation risk review",
    scope: "Evaluate the agent's use in customer eligibility decisions and its downstream operational impact.",
    intendedUse: "Assist trained operations staff with recommendations; a human must make the final decision.",
    dataSensitivity: 5,
    autonomyLevel: 4,
    impact: 5,
    likelihood: 4,
    exposure: 4,
    mitigationCoverage: 20,
    evidence: ["Model card reviewed", "Human override procedure documented"],
  };
  const invalid = await request(`/assets/${asset.data.id}/risk-assessments`, {
    method: "POST",
    token: ownerToken,
    body: { ...assessmentInput, impact: 9 },
  });
  assert.equal(invalid.response.status, 400, "Risk dimensions outside the 1–5 range must be rejected.");

  const created = await request(`/assets/${asset.data.id}/risk-assessments`, {
    method: "POST",
    token: ownerToken,
    body: assessmentInput,
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.status, "DRAFT");
  assert.equal(created.data.inherentScore, 150);
  assert.equal(created.data.residualScore, 120);
  assert.equal(created.data.inherentLevel, "HIGH");
  assert.equal(created.data.residualLevel, "HIGH");
  assert.equal(created.data.scoringVersion, "sentinelai-risk-v1");

  const ownerSelfReview = await request(`/risk-assessments/${created.data.id}/decision`, {
    method: "POST",
    token: ownerToken,
    body: { decision: "APPROVED", rationale: "I reviewed my own work and approve it." },
  });
  assert.equal(ownerSelfReview.response.status, 403, "Creators must not approve their own assessments.");

  const submitted = await request(`/risk-assessments/${created.data.id}/submit`, {
    method: "POST",
    token: ownerToken,
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.data));
  assert.equal(submitted.data.status, "IN_REVIEW");

  const duplicateSubmit = await request(`/risk-assessments/${created.data.id}/submit`, {
    method: "POST",
    token: ownerToken,
  });
  assert.equal(duplicateSubmit.response.status, 409, "Only draft assessments may be submitted.");

  const reviewerRegistration = await request("/auth/register", {
    method: "POST",
    body: { name: "Independent Reviewer", email: reviewerEmail, password, organizationName: "Reviewer Home Workspace" },
  });
  assert.equal(reviewerRegistration.response.status, 201, JSON.stringify(reviewerRegistration.data));
  const outsiderList = await request("/risk-assessments", { token: reviewerRegistration.data.accessToken });
  assert.equal(outsiderList.response.status, 200);
  assert.equal(outsiderList.data.pagination.total, 0, "Risk assessments must remain organization-scoped.");

  const database = new Pool({ connectionString: process.env.DATABASE_URL });
  let reviewerMembershipId;
  try {
    reviewerMembershipId = `risk-reviewer-${suffix}`;
    await database.query(
      'INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "isActive", "createdAt", "updatedAt") SELECT $1, "id", $2, \'COMPLIANCE_OFFICER\', true, NOW(), NOW() FROM "User" WHERE "email" = $3',
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

  const approved = await request(`/risk-assessments/${created.data.id}/decision`, {
    method: "POST",
    token: reviewerLogin.data.accessToken,
    body: { decision: "APPROVED", rationale: "Independent review completed; residual risk accepted with documented human oversight." },
  });
  assert.equal(approved.response.status, 201, JSON.stringify(approved.data));
  assert.equal(approved.data.status, "APPROVED");
  assert.equal(approved.data.reviewedByMembershipId, reviewerMembershipId);
  assert.match(approved.data.reviewRationale, /Independent review completed/);

  const repeatDecision = await request(`/risk-assessments/${created.data.id}/decision`, {
    method: "POST",
    token: reviewerLogin.data.accessToken,
    body: { decision: "REJECTED", rationale: "Attempt to change a completed decision." },
  });
  assert.equal(repeatDecision.response.status, 409, "A completed assessment decision must be immutable through this workflow.");

  const filtered = await request("/risk-assessments?status=APPROVED&residualLevel=HIGH&page=1&limit=10", {
    token: ownerToken,
  });
  assert.equal(filtered.response.status, 200, JSON.stringify(filtered.data));
  assert.equal(filtered.data.pagination.total, 1);
  assert.equal(filtered.data.data[0].id, created.data.id);

  const detail = await request(`/risk-assessments/${created.data.id}`, { token: ownerToken });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.asset.name, "High Impact Decision Agent");
  assert.equal(detail.data.createdByMembership.user.email, ownerEmail);
  assert.equal(detail.data.reviewedByMembership.user.email, reviewerEmail);

  const deletion = await request(`/assets/${asset.data.id}`, { method: "DELETE", token: ownerToken });
  assert.equal(deletion.response.status, 409, "Assets with risk history must not be hard-deleted.");

  const audit = await request("/audit-logs?action=risk_assessment.approve", { token: ownerToken });
  assert.equal(audit.response.status, 200);
  assert.equal(audit.data.pagination.total, 1);
  assert.equal(audit.data.data[0].entityId, created.data.id);
});

after(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 5_000);
      apiProcess.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
});

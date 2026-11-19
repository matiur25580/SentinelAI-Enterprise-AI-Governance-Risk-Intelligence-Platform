import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import pg from "pg";

const { Pool } = pg;

const port = 4317;
const baseUrl = `http://127.0.0.1:${port}/api/v1`;
let apiProcess;
let apiOutput = "";

async function request(path, { method = "GET", body, token, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { response, data };
}

before(async () => {
  apiProcess = spawn(process.execPath, ["dist/main.js"], {
    cwd: process.cwd(),
    env: { ...process.env, API_PORT: String(port), METRICS_BEARER_TOKEN: "ci-metrics-token-for-integration-tests-only-2026" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout.on("data", (chunk) => { apiOutput += chunk.toString(); });
  apiProcess.stderr.on("data", (chunk) => { apiOutput += chunk.toString(); });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) {
      throw new Error(`API exited before becoming healthy.\n${apiOutput}`);
    }
    try {
      const { response } = await request("/health");
      if (response.ok) return;
    } catch {
      // The API may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy within 30 seconds.\n${apiOutput}`);
});

test("Prometheus metrics endpoint requires its bearer token and exports request metrics", async () => {
  const denied = await request("/metrics");
  assert.equal(denied.response.status, 404);

  const allowed = await request("/metrics", {
    headers: { authorization: "Bearer ci-metrics-token-for-integration-tests-only-2026" },
  });
  assert.equal(allowed.response.status, 200);
  assert.match(allowed.response.headers.get("content-type") ?? "", /text\/plain/);
  assert.ok(allowed.data.raw?.includes("# TYPE sentinelai_http_requests_total counter"));
  assert.ok(allowed.data.raw?.includes("# TYPE sentinelai_http_request_duration_seconds histogram"));
  assert.ok(allowed.data.raw?.includes('route="/api/v1/health"'));
});

test("request telemetry returns a fresh correlation ID and excludes query strings", async () => {
  const marker = `sensitive-query-marker-${Date.now()}`;
  const { response } = await request(`/health?secret=${marker}`, {
    headers: { "x-request-id": "untrusted-client-request-id" },
  });

  assert.equal(response.status, 200);
  const requestId = response.headers.get("x-request-id");
  assert.match(requestId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(requestId, "untrusted-client-request-id");
  assert.ok(!apiOutput.includes(marker), "Query strings must never be written to request logs.");
  assert.ok(apiOutput.includes('"event":"http.request"'));
  assert.ok(apiOutput.includes('"route":"/api/v1/health"'));
});

after(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 5_000);
      apiProcess.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
});

test("register, login, refresh rotation, and logout work against PostgreSQL", { timeout: 120_000 }, async () => {
  const email = `auth-integration-${Date.now()}@example.test`;
  const password = "Integration-Test-Password-2026!";
  const register = await request("/auth/register", {
    method: "POST",
    body: {
      name: "CI Integration User",
      email,
      password,
      organizationName: "SentinelAI CI Workspace",
    },
  });

  assert.equal(register.response.status, 201, JSON.stringify(register.data));
  assert.equal(register.data.tokenType, "Bearer");
  assert.ok(register.data.accessToken);
  assert.ok(register.data.refreshToken);

  const profile = await request("/auth/me", { token: register.data.accessToken });
  assert.equal(profile.response.status, 200, JSON.stringify(profile.data));
  assert.equal(profile.data.user.email, email);
  assert.equal(profile.data.organization.name, "SentinelAI CI Workspace");

  // A user may belong to multiple workspaces, but each access token must
  // remain scoped to the membership selected at login.
  const database = new Pool({ connectionString: process.env.DATABASE_URL });
  const secondOrganizationId = `org_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const secondMembershipId = `membership_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const secondOrganizationSlug = `sentinelai-secondary-${Date.now()}`;
  try {
    await database.query(
      'INSERT INTO "Organization" ("id", "name", "slug", "createdAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW())',
      [secondOrganizationId, "SentinelAI Secondary Workspace", secondOrganizationSlug],
    );
    await database.query(
      'INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "isActive", "createdAt", "updatedAt") SELECT $1, "id", $2, \'MEMBER\', true, NOW(), NOW() FROM "User" WHERE "email" = $3',
      [secondMembershipId, secondOrganizationId, email],
    );

    const secondaryLogin = await request("/auth/login", {
      method: "POST",
      body: { email, password, organizationSlug: secondOrganizationSlug },
    });
    assert.equal(secondaryLogin.response.status, 201, JSON.stringify(secondaryLogin.data));
    const secondaryProfile = await request("/auth/me", { token: secondaryLogin.data.accessToken });
    assert.equal(secondaryProfile.response.status, 200, JSON.stringify(secondaryProfile.data));
    assert.equal(secondaryProfile.data.organization.id, secondOrganizationId);
    assert.equal(secondaryProfile.data.organization.name, "SentinelAI Secondary Workspace");
    assert.notEqual(secondaryProfile.data.organization.id, profile.data.organization.id);
    // Use an authorized role so the cross-tenant update test reaches the
    // tenant-scoped service and verifies its 404 non-disclosure behavior.
    await database.query(
      'UPDATE "Membership" SET "role" = \'OWNER\', "updatedAt" = NOW() WHERE "id" = $1',
      [secondMembershipId],
    );

    // Auditors can read only their own workspace's compliance history.
    await database.query('UPDATE "Membership" SET "role" = \'AUDITOR\', "updatedAt" = NOW() WHERE "id" = $1', [secondMembershipId]);
    const secondaryAuditLogs = await request("/audit-logs", { token: secondaryLogin.data.accessToken });
    assert.equal(secondaryAuditLogs.response.status, 200, JSON.stringify(secondaryAuditLogs.data));
    assert.equal(secondaryAuditLogs.data.pagination.total, 1);
    assert.ok(
      secondaryAuditLogs.data.data.every((entry) =>
        entry.organizationId === secondOrganizationId && entry.action === "auth.login"
      ),
      "A workspace must see only its own audit history, never another workspace's asset events.",
    );
    const secondaryIntegrity = await request("/audit-logs/integrity", {
      token: secondaryLogin.data.accessToken,
    });
    assert.equal(secondaryIntegrity.response.status, 200, JSON.stringify(secondaryIntegrity.data));
    assert.equal(secondaryIntegrity.data.verified, true);
    const secondaryAuditExport = await request("/audit-logs/export.csv", {
      token: secondaryLogin.data.accessToken,
    });
    assert.equal(secondaryAuditExport.response.status, 200);
    assert.match(secondaryAuditExport.response.headers.get("content-type"), /text\/csv/);
    assert.match(secondaryAuditExport.response.headers.get("content-disposition"), /attachment/);
    assert.match(secondaryAuditExport.data.raw, /auth\.login/);
    assert.ok(!secondaryAuditExport.data.raw.includes("Customer Support LLM"));
    assert.ok(!secondaryAuditExport.data.raw.includes(profile.data.organization.id));
    await database.query('UPDATE "Membership" SET "role" = \'OWNER\', "updatedAt" = NOW() WHERE "id" = $1', [secondMembershipId]);

    const primaryMembership = await database.query(
      'SELECT "id" FROM "Membership" WHERE "userId" = (SELECT "id" FROM "User" WHERE "email" = $1) AND "organizationId" = $2',
      [email, profile.data.organization.id],
    );
    assert.equal(primaryMembership.rowCount, 1);
    const primaryMembershipId = primaryMembership.rows[0].id;
    const setPrimaryRole = async (role) => database.query(
      'UPDATE "Membership" SET "role" = $1, "updatedAt" = NOW() WHERE "id" = $2',
      [role, primaryMembershipId],
    );

    const createdAsset = await request("/assets", {
      method: "POST",
      token: register.data.accessToken,
      body: {
        name: "Customer Support LLM",
        description: "Primary workspace model inventory entry",
        assetType: "LLM_APPLICATION",
        provider: "SentinelAI",
        modelIdentifier: "support-assistant",
        version: "1.0.0",
      },
    });
    assert.equal(createdAsset.response.status, 201, JSON.stringify(createdAsset.data));
    assert.equal(createdAsset.data.organizationId, profile.data.organization.id);
    assert.equal(createdAsset.data.name, "Customer Support LLM");

    const primaryAssetList = await request("/assets", { token: register.data.accessToken });
    assert.equal(primaryAssetList.response.status, 200);
    assert.ok(primaryAssetList.data.some((asset) => asset.id === createdAsset.data.id));

    const secondaryAssetList = await request("/assets", { token: secondaryLogin.data.accessToken });
    assert.equal(secondaryAssetList.response.status, 200);
    assert.equal(secondaryAssetList.data.length, 0, "A workspace must not list another workspace's assets.");

    const crossWorkspaceRead = await request(`/assets/${createdAsset.data.id}`, { token: secondaryLogin.data.accessToken });
    assert.equal(crossWorkspaceRead.response.status, 404, "Cross-workspace asset reads must not disclose asset existence.");

    const crossWorkspaceUpdate = await request(`/assets/${createdAsset.data.id}`, {
      method: "PATCH",
      token: secondaryLogin.data.accessToken,
      body: { name: "Unauthorized overwrite" },
    });
    assert.equal(crossWorkspaceUpdate.response.status, 404, "Cross-workspace asset updates must be denied.");

    // Workspace role changes take effect immediately for existing access tokens.
    await setPrimaryRole("MEMBER");
    const memberAssetList = await request("/assets", { token: register.data.accessToken });
    assert.equal(memberAssetList.response.status, 200, "Members may read workspace assets.");
    const memberCreateDenied = await request("/assets", {
      method: "POST",
      token: register.data.accessToken,
      body: { name: "Unauthorized Asset", assetType: "LLM_APPLICATION" },
    });
    assert.equal(memberCreateDenied.response.status, 403, "MEMBER cannot create assets.");
    const memberUpdateDenied = await request(`/assets/${createdAsset.data.id}`, {
      method: "PATCH",
      token: register.data.accessToken,
      body: { name: "Unauthorized overwrite" },
    });
    assert.equal(memberUpdateDenied.response.status, 403, "MEMBER cannot update assets.");
    const memberAuditDenied = await request("/audit-logs", { token: register.data.accessToken });
    assert.equal(memberAuditDenied.response.status, 403, "MEMBER cannot read compliance audit logs.");
    const memberAuditExportDenied = await request("/audit-logs/export.csv", { token: register.data.accessToken });
    assert.equal(memberAuditExportDenied.response.status, 403, "MEMBER cannot export compliance audit logs.");

    await setPrimaryRole("AI_ENGINEER");
    const updatedAsset = await request(`/assets/${createdAsset.data.id}`, {
      method: "PATCH",
      token: register.data.accessToken,
      body: { name: "Customer Support LLM v2", status: "IN_REVIEW" },
    });
    assert.equal(updatedAsset.response.status, 200, JSON.stringify(updatedAsset.data));
    assert.equal(updatedAsset.data.name, "Customer Support LLM v2");
    assert.equal(updatedAsset.data.status, "IN_REVIEW");

    const engineerDeleteDenied = await request(`/assets/${createdAsset.data.id}`, {
      method: "DELETE",
      token: register.data.accessToken,
    });
    assert.equal(engineerDeleteDenied.response.status, 403, "AI_ENGINEER cannot delete assets.");

    await setPrimaryRole("ADMIN");
    const deletedAsset = await request(`/assets/${createdAsset.data.id}`, {
      method: "DELETE",
      token: register.data.accessToken,
    });
    assert.equal(deletedAsset.response.status, 200, JSON.stringify(deletedAsset.data));
    assert.equal(deletedAsset.data.success, true);

    const deletedAssetRead = await request(`/assets/${createdAsset.data.id}`, { token: register.data.accessToken });
    assert.equal(deletedAssetRead.response.status, 404);

    const auditLogs = await request("/audit-logs?entityType=AIAsset&page=1&limit=10", {
      token: register.data.accessToken,
    });
    assert.equal(auditLogs.response.status, 200, JSON.stringify(auditLogs.data));
    assert.ok(auditLogs.data.pagination.total >= 3);
    assert.ok(auditLogs.data.data.some((entry) => entry.action === "asset.create"));
    assert.ok(auditLogs.data.data.some((entry) => entry.action === "asset.update"));
    assert.ok(auditLogs.data.data.some((entry) => entry.action === "asset.delete"));
    assert.ok(auditLogs.data.data.every((entry) => entry.organizationId === profile.data.organization.id));
    assert.ok(auditLogs.data.data.every((entry) => entry.actor?.email === email));

    const primaryIntegrity = await request("/audit-logs/integrity", {
      token: register.data.accessToken,
    });
    assert.equal(primaryIntegrity.response.status, 200, JSON.stringify(primaryIntegrity.data));
    assert.equal(primaryIntegrity.data.verified, true);
    assert.ok(primaryIntegrity.data.recordsChecked >= 4);

    const auditEntryId = auditLogs.data.data[0].id;
    await assert.rejects(
      database.query('UPDATE "AuditLog" SET "action" = \'tampered.action\' WHERE "id" = $1', [auditEntryId]),
      /append-only/,
      "Database trigger must reject audit record updates.",
    );
    await assert.rejects(
      database.query('DELETE FROM "AuditLog" WHERE "id" = $1', [auditEntryId]),
      /append-only/,
      "Database trigger must reject audit record deletion.",
    );

    const primaryAuditExport = await request("/audit-logs/export.csv?entityType=AIAsset", {
      token: register.data.accessToken,
    });
    assert.equal(primaryAuditExport.response.status, 200);
    assert.match(primaryAuditExport.data.raw, /asset\.create/);
    assert.match(primaryAuditExport.data.raw, /asset\.update/);
    assert.match(primaryAuditExport.data.raw, /asset\.delete/);
    assert.ok(!primaryAuditExport.data.raw.includes(secondOrganizationId));

    const filteredAuditExport = await request("/audit-logs/export.csv?action=asset.create&entityType=AIAsset", {
      token: register.data.accessToken,
    });
    assert.equal(filteredAuditExport.response.status, 200);
    assert.ok(filteredAuditExport.data.raw.includes("asset.create"));
    assert.ok(!filteredAuditExport.data.raw.includes("asset.delete"));

    const invalidExportRange = await request("/audit-logs/export.csv?from=2026-11-20T00:00:00Z&to=2026-11-19T00:00:00Z", {
      token: register.data.accessToken,
    });
    assert.equal(invalidExportRange.response.status, 400);

    const filteredAuditLogs = await request("/audit-logs?action=asset.create&entityType=AIAsset", {
      token: register.data.accessToken,
    });
    assert.equal(filteredAuditLogs.response.status, 200);
    assert.ok(filteredAuditLogs.data.data.length >= 1);
    assert.ok(filteredAuditLogs.data.data.every((entry) => entry.action === "asset.create"));

    const invalidAuditRange = await request("/audit-logs?from=2026-11-20T00:00:00Z&to=2026-11-19T00:00:00Z", {
      token: register.data.accessToken,
    });
    assert.equal(invalidAuditRange.response.status, 400, "Invalid date ranges must be rejected.");

    await database.query('UPDATE "Membership" SET "isActive" = false, "updatedAt" = NOW() WHERE "id" = $1', [secondMembershipId]);
    const inactiveMembershipProfile = await request("/auth/me", { token: secondaryLogin.data.accessToken });
    assert.equal(inactiveMembershipProfile.response.status, 401, "A token tied to an inactive workspace membership must be rejected.");
    const inactiveMembershipAssets = await request("/assets", { token: secondaryLogin.data.accessToken });
    assert.equal(inactiveMembershipAssets.response.status, 401, "Inactive memberships must not access protected asset routes.");

    const inactiveMembershipLogin = await request("/auth/login", {
      method: "POST",
      body: { email, password, organizationSlug: secondOrganizationSlug },
    });
    assert.equal(inactiveMembershipLogin.response.status, 401, "Inactive workspace memberships must not allow new sessions.");
  } finally {
    await database.end();
  }

  const invalidLogin = await request("/auth/login", {
    method: "POST",
    body: { email, password: "Wrong-Password-2026!" },
  });
  assert.equal(invalidLogin.response.status, 401);

  const sessionLogin = await request("/auth/login", { method: "POST", body: { email, password } });
  assert.equal(sessionLogin.response.status, 201, JSON.stringify(sessionLogin.data));
  const sessionPayload = JSON.parse(Buffer.from(sessionLogin.data.refreshToken.split(".")[1], "base64url").toString("utf8"));
  const sessions = await request("/auth/sessions", { token: sessionLogin.data.accessToken });
  assert.equal(sessions.response.status, 200, JSON.stringify(sessions.data));
  assert.ok(sessions.data.data.some((session) => session.sessionId === sessionPayload.familyId));
  const revokedSession = await request("/auth/sessions/" + sessionPayload.familyId, { method: "DELETE", token: sessionLogin.data.accessToken });
  assert.equal(revokedSession.response.status, 200, JSON.stringify(revokedSession.data));
  assert.ok(revokedSession.data.revokedTokenCount >= 1);
  const revokedSessionRefresh = await request("/auth/refresh", { method: "POST", body: { refreshToken: sessionLogin.data.refreshToken } });
  assert.equal(revokedSessionRefresh.response.status, 401, "Revoking a session must invalidate its refresh token family.");
  const revokedSessionAccess = await request("/auth/me", { token: sessionLogin.data.accessToken });
  assert.equal(revokedSessionAccess.response.status, 401, "Revoking a session must invalidate its access token immediately.");
  const revokedSessionAudit = await request("/audit-logs?action=auth.session.revoke", { token: register.data.accessToken });
  assert.equal(revokedSessionAudit.response.status, 200);
  assert.ok(revokedSessionAudit.data.data.some((entry) => entry.entityId === sessionPayload.familyId));

  const login = await request("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(login.response.status, 201, JSON.stringify(login.data));
  assert.ok(login.data.accessToken);
  assert.ok(login.data.refreshToken);

  const refresh = await request("/auth/refresh", {
    method: "POST",
    body: { refreshToken: login.data.refreshToken },
  });
  assert.equal(refresh.response.status, 201, JSON.stringify(refresh.data));
  assert.ok(refresh.data.accessToken);
  assert.ok(refresh.data.refreshToken);
  assert.notEqual(refresh.data.refreshToken, login.data.refreshToken);

  const reusedRefresh = await request("/auth/refresh", {
    method: "POST",
    body: { refreshToken: login.data.refreshToken },
  });
  assert.equal(reusedRefresh.response.status, 401, "A rotated refresh token must not be reusable.");

  const reusedFamilyDescendant = await request("/auth/refresh", {
    method: "POST",
    body: { refreshToken: refresh.data.refreshToken },
  });
  assert.equal(
    reusedFamilyDescendant.response.status,
    401,
    "Reusing a rotated token must revoke its entire refresh-token family, including the newest descendant.",
  );

  const logout = await request("/auth/logout", {
    method: "POST",
    body: { refreshToken: refresh.data.refreshToken },
  });
  assert.equal(logout.response.status, 201, JSON.stringify(logout.data));
  assert.equal(logout.data.success, true);

  const loggedOutRefresh = await request("/auth/refresh", {
    method: "POST",
    body: { refreshToken: refresh.data.refreshToken },
  });
  assert.equal(loggedOutRefresh.response.status, 401, "A logged-out refresh token must be rejected.");

  const rateLimitResults = [];
  for (let attempt = 0; attempt < 15; attempt += 1) {
    rateLimitResults.push(await request("/auth/login", {
      method: "POST",
      body: { email, password: "Rate-Limit-Probe-Password!" },
    }));
  }
  const blockedAttempt = rateLimitResults.findIndex((result) => result.response.status === 429);
  assert.ok(
    blockedAttempt >= 0 && blockedAttempt <= 10,
    `A login request must be rate limited after no more than 10 attempts in the shared 15-minute window. Observed: ${rateLimitResults.map((result) => `${result.response.status}:${result.response.headers.get("ratelimit-remaining") ?? "no-header"}`).join(", ")}`,
  );
  assert.ok(
    rateLimitResults.slice(0, blockedAttempt).every((result) => result.response.status === 401),
    "Requests before the rate limit must be processed normally.",
  );
  assert.ok(Number(rateLimitResults[blockedAttempt].response.headers.get("retry-after")) > 0);
  assert.equal(rateLimitResults[blockedAttempt].data.statusCode, 429);

});

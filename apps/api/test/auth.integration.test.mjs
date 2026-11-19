import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const port = 4317;
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
    env: { ...process.env, API_PORT: String(port) },
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

  const invalidLogin = await request("/auth/login", {
    method: "POST",
    body: { email, password: "Wrong-Password-2026!" },
  });
  assert.equal(invalidLogin.response.status, 401);

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
});

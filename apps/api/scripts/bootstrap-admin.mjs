import argon2 from "argon2";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the one-time administrator bootstrap.`);
  return value;
}

async function main() {
  if (process.env.NODE_ENV !== "production") {
    throw new Error("The administrator bootstrap command must run with NODE_ENV=production.");
  }

  const connectionString = required("DATABASE_URL");
  const email = required("BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
  const name = required("BOOTSTRAP_ADMIN_NAME");
  const password = required("BOOTSTRAP_ADMIN_PASSWORD");
  const organizationName = required("BOOTSTRAP_ORGANIZATION_NAME");

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL must be a valid email address of at most 254 characters.");
  }
  if (name.length < 2 || name.length > 100) throw new Error("BOOTSTRAP_ADMIN_NAME must be between 2 and 100 characters.");
  if (organizationName.length < 2 || organizationName.length > 100) throw new Error("BOOTSTRAP_ORGANIZATION_NAME must be between 2 and 100 characters.");
  if (password.length < 16 || password.length > 128) throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be between 16 and 128 characters.");

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const organizationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const slugBase = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "workspace";
  const slug = `${slugBase}-${randomBytes(3).toString("hex")}`;
  const now = new Date();

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["sentinelai:first-owner-bootstrap"]);
    const existing = await client.query('SELECT COUNT(*)::int AS count FROM "User"');
    if (existing.rows[0].count !== 0) {
      throw new Error("Bootstrap refused: the database already contains user accounts. This command is strictly first-user only.");
    }

    await client.query(
      'INSERT INTO "Organization" ("id", "name", "slug", "isActive", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, $4, $4)',
      [organizationId, organizationName, slug, now],
    );
    await client.query(
      'INSERT INTO "User" ("id", "email", "name", "passwordHash", "isActive", "emailVerifiedAt", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, true, $5, $5, $5)',
      [userId, email, name, passwordHash, now],
    );
    await client.query(
      'INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "isActive", "createdAt", "updatedAt") VALUES ($1, $2, $3, \'OWNER\', true, $4, $4)',
      [membershipId, userId, organizationId, now],
    );
    await client.query(
      'INSERT INTO "AuditLog" ("id", "organizationId", "actorId", "action", "entityType", "entityId", "metadata", "createdAt") VALUES ($1, $2, $3, \'auth.bootstrap.owner\', \'User\', $3, $4::jsonb, $5)',
      [randomUUID(), organizationId, userId, JSON.stringify({ email, bootstrap: true }), now],
    );
    await client.query("COMMIT");
    process.stdout.write(`Created the first verified workspace owner: ${email} (${slug}).\n`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`Administrator bootstrap failed: ${error instanceof Error ? error.message : "Unknown error"}\n`);
  process.exitCode = 1;
});

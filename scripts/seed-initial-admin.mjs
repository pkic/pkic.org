import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpus } from "node:os";

function parseArgs(argv) {
  let mode = "local";
  let database = process.env.D1_DATABASE_NAME ?? "pkic-db";
  let wranglerEnv = null;
  let persistTo = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--remote") {
      mode = "remote";
      continue;
    }

    if (arg === "--local") {
      mode = "local";
      continue;
    }

    if (arg === "--db" && argv[index + 1]) {
      database = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--env" && argv[index + 1]) {
      wranglerEnv = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--persist-to" && argv[index + 1]) {
      persistTo = argv[index + 1];
      index += 1;
    }
  }

  return { mode, database, wranglerEnv, persistTo };
}

// Seeds one admin account per CPU core so parallel Playwright workers each
// get their own magic-link identity instead of colliding on
// EMAIL_RATE_LIMITER's shared 3-per-60s-per-address limit — see
// tests/helpers/e2e-admin.ts, which derives the matching email per worker.
// Worker 0 keeps the original "admin@pkic.org" address for backward
// compatibility with every existing fixture/reference to it.
function workerAdminEmails() {
  const workerCount = Math.max(1, Math.min(cpus().length, 32));
  return Array.from({ length: workerCount }, (_, index) =>
    index === 0 ? "admin@pkic.org" : `admin.w${index}@pkic.org`,
  );
}

function runSeed(mode, database, wranglerEnv, persistTo) {
  const values = workerAdminEmails()
    .map((email) => `('${randomUUID()}', '${email}', '${email}', 'admin', 1, datetime('now'), datetime('now'))`)
    .join(",\n       ");
  const sql =
    "INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at) " +
    `VALUES ${values} ` +
    "ON CONFLICT(email) DO UPDATE SET normalized_email = excluded.normalized_email, role = 'admin', active = 1, updated_at = datetime('now');";

  const args = [
    "wrangler",
    "d1",
    "execute",
    database,
    ...(wranglerEnv ? ["--env", wranglerEnv] : []),
    mode === "remote" ? "--remote" : "--local",
    ...(persistTo ? [`--persist-to=${persistTo}`] : []),
    "--command",
    sql,
  ];

  execFileSync("pnpm", ["exec", ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

const { mode, database, wranglerEnv, persistTo } = parseArgs(process.argv.slice(2));
runSeed(mode, database, wranglerEnv, persistTo);

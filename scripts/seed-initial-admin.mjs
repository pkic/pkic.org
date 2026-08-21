import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { e2eAdminEmailsForWorkerCount } from "./e2e-admin-identities.mjs";

function parseArgs(argv) {
  let mode = "local";
  let database = process.env.D1_DATABASE_NAME ?? "pkic-db";
  let wranglerEnv = null;
  let persistTo = null;
  let e2eWorkerPool = false;

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
      continue;
    }

    if (arg === "--e2e-worker-pool") {
      e2eWorkerPool = true;
    }
  }

  return { mode, database, wranglerEnv, persistTo, e2eWorkerPool };
}

// Only under --e2e-worker-pool (passed by scripts/e2e-start.sh, never by
// `pnpm run seed:local|preview|production`): seeds one admin account per CPU
// core and auth scenario so parallel and serial Playwright runs each get
// isolated magic-link identities instead of colliding on EMAIL_RATE_LIMITER's
// shared 3-per-60s-per-address limit. The naming contract is shared with the
// test helper through e2e-admin-identities.mjs. Gated behind an explicit flag
// so preview/production seeding never creates these test-only accounts.
function workerAdminEmails() {
  const workerCount = Math.max(1, Math.min(cpus().length, 32));
  return e2eAdminEmailsForWorkerCount(workerCount);
}

function runSeed(mode, database, wranglerEnv, persistTo, e2eWorkerPool) {
  const emails = e2eWorkerPool ? workerAdminEmails() : ["admin@pkic.org"];
  const values = emails
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

const { mode, database, wranglerEnv, persistTo, e2eWorkerPool } = parseArgs(process.argv.slice(2));
runSeed(mode, database, wranglerEnv, persistTo, e2eWorkerPool);

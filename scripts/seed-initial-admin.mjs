/**
 * Local/E2E administrator setup and one-time remote bootstrap.
 * On an existing production database, --recover explicitly restores the existing
 * admin@pkic.org account; it never runs event, template, or member import seeds.
 * Retain local/E2E and recovery use after removing production bootstrap.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { E2E_WORKER_COUNT, e2eAdminEmailsForWorkerCount } from "./e2e-admin-identities.mjs";
import { readSeedDatabaseRows } from "./lib/production-seed-guard.mjs";
import { buildWranglerD1ExecuteArgs } from "./lib/seed-cli.mjs";

function parseArgs(argv) {
  let mode = "local";
  let database = process.env.D1_DATABASE_NAME ?? "pkic-db";
  let wranglerEnv = null;
  let persistTo = null;
  let e2eWorkerPool = false;
  let recover = false;

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
    if (arg === "--recover") recover = true;
  }

  return { mode, database, wranglerEnv, persistTo, e2eWorkerPool, recover };
}

// Only under --e2e-worker-pool (passed by scripts/e2e-start.sh, never by
// `pnpm run seed:local|preview|production`): seeds one admin account per auth
// scenario and worker slot, so each spec gets an isolated magic-link identity
// instead of colliding on EMAIL_RATE_LIMITER's 3-per-60s-per-address limit.
// Both the scenario names and the worker count come from
// e2e-admin-identities.mjs, which playwright.config.ts reads too. Gated behind
// an explicit flag so preview/production seeding never creates these
// test-only accounts.
function workerAdminEmails() {
  return e2eAdminEmailsForWorkerCount(E2E_WORKER_COUNT);
}

/**
 * D1's documented ceiling for one statement.
 *
 * https://developers.cloudflare.com/d1/platform/limits/ — "Maximum SQL
 * statement length: 100,000 bytes". Miniflare enforces it locally too: the
 * pool built as a single INSERT reached 105KB on a ten-core machine and was
 * refused with `statement too long: SQLITE_TOOBIG`, which surfaced as the
 * whole e2e harness failing to start.
 */
const D1_MAX_STATEMENT_BYTES = 100_000;

/*
 * Rows per INSERT.
 *
 * The pool is scenarios × workers, so a single statement grew on two axes and
 * would cross the ceiling again on a bigger machine or with more scenarios.
 * Fifty rows is roughly 9KB — an order of magnitude of headroom — and the file
 * is still one `wrangler d1 execute`.
 *
 * These are SQL literals rather than bound parameters, which is what `--file`
 * requires and what keeps the row count free of D1's *other* ceiling: 100
 * bound parameters per query would cap this at fourteen rows a statement. The
 * values are a closed list built from `E2E_ADMIN_SCOPES`, never user input.
 */
const ROWS_PER_STATEMENT = 50;

function insertStatements(emails, { recover = false } = {}) {
  const statements = [];
  for (let start = 0; !recover && start < emails.length; start += ROWS_PER_STATEMENT) {
    const values = emails
      .slice(start, start + ROWS_PER_STATEMENT)
      .map(
        (email) =>
          `('${randomUUID()}', '${email}', '${email}', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      )
      .join(",\n       ");
    statements.push(
      "INSERT INTO users (id, email, normalized_email, active, created_at, updated_at) " +
        `VALUES ${values} ` +
        "ON CONFLICT(email) DO UPDATE SET normalized_email = excluded.normalized_email, active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');",
    );
  }
  for (const email of emails) {
    statements.push(
      `UPDATE user_roles SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE user_id = (SELECT id FROM users WHERE normalized_email = '${email}')
          AND role_id = 'role-admin' AND context_type IS NULL AND context_id IS NULL
          AND revoked_at IS NULL AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');`,
    );
    if (recover)
      statements.push(
        `UPDATE users SET active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE normalized_email = '${email}';`,
      );
    statements.push(
      `INSERT INTO user_roles (id, user_id, role_id, created_at)
       SELECT '${randomUUID()}', u.id, 'role-admin', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         FROM users u WHERE u.normalized_email = '${email}'
          AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id
            AND ur.role_id = 'role-admin' AND ur.context_type IS NULL AND ur.context_id IS NULL
            AND ur.revoked_at IS NULL);`,
    );
  }
  return statements;
}

function runSeed(mode, database, wranglerEnv, persistTo, e2eWorkerPool, recover) {
  if (mode === "remote" && !["preview", "production"].includes(wranglerEnv)) {
    throw new Error("Remote administrator setup requires an explicit preview or production environment.");
  }
  if (e2eWorkerPool && (mode !== "local" || recover)) {
    throw new Error("The E2E administrator pool requires local bootstrap.");
  }
  const emails = e2eWorkerPool ? workerAdminEmails() : ["admin@pkic.org"];
  const options = { mode, database, wranglerEnv, persistTo };
  if (recover || (mode === "remote" && wranglerEnv === "production")) {
    const users = readSeedDatabaseRows(
      options,
      "SELECT EXISTS (SELECT 1 FROM users) AS has_users, EXISTS (SELECT 1 FROM users WHERE normalized_email = 'admin@pkic.org') AS administrator_exists",
    );
    if (recover ? users[0]?.administrator_exists !== 1 : users[0]?.has_users !== 0) {
      throw new Error(
        recover
          ? "Administrator recovery requires the existing admin@pkic.org account."
          : "Production administrator bootstrap requires no users. Use --recover explicitly for an existing account.",
      );
    }
  }
  // A file rather than `--command`: several statements, and none of them on a
  // command line whose length is another limit to grow into.
  const sqlPath = path.join(tmpdir(), `pkic-seed-initial-admin-${String(process.pid)}.sql`);
  fs.writeFileSync(sqlPath, `${insertStatements(emails, { recover }).join("\n")}\n`, "utf8");

  const args = [...buildWranglerD1ExecuteArgs(options), "--file", sqlPath];

  try {
    execFileSync("pnpm", ["exec", ...args], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  } finally {
    fs.rmSync(sqlPath, { force: true });
  }
}

export { insertStatements, runSeed, ROWS_PER_STATEMENT, D1_MAX_STATEMENT_BYTES, workerAdminEmails };

/*
 * Only when run as a command. Without the guard, importing this module to test
 * how it builds its SQL would seed a database as a side effect of the import.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { mode, database, wranglerEnv, persistTo, e2eWorkerPool, recover } = parseArgs(process.argv.slice(2));
  runSeed(mode, database, wranglerEnv, persistTo, e2eWorkerPool, recover);
}

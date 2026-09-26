import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { E2E_WORKER_COUNT, e2eAdminEmailsForWorkerCount } from "./e2e-admin-identities.mjs";

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

function insertStatements(emails) {
  const statements = [];
  for (let start = 0; start < emails.length; start += ROWS_PER_STATEMENT) {
    const values = emails
      .slice(start, start + ROWS_PER_STATEMENT)
      .map((email) => `('${randomUUID()}', '${email}', '${email}', 'admin', 1, datetime('now'), datetime('now'))`)
      .join(",\n       ");
    statements.push(
      "INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at) " +
        `VALUES ${values} ` +
        "ON CONFLICT(email) DO UPDATE SET normalized_email = excluded.normalized_email, role = 'admin', active = 1, updated_at = datetime('now');",
    );
  }
  return statements;
}

function runSeed(mode, database, wranglerEnv, persistTo, e2eWorkerPool) {
  const emails = e2eWorkerPool ? workerAdminEmails() : ["admin@pkic.org"];
  // A file rather than `--command`: several statements, and none of them on a
  // command line whose length is another limit to grow into.
  const sqlPath = path.join(tmpdir(), `pkic-seed-initial-admin-${String(process.pid)}.sql`);
  fs.writeFileSync(sqlPath, `${insertStatements(emails).join("\n")}\n`, "utf8");

  const args = [
    "wrangler",
    "d1",
    "execute",
    database,
    ...(wranglerEnv ? ["--env", wranglerEnv] : []),
    mode === "remote" ? "--remote" : "--local",
    ...(persistTo ? [`--persist-to=${persistTo}`] : []),
    "--file",
    sqlPath,
  ];

  try {
    execFileSync("pnpm", ["exec", ...args], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  } finally {
    fs.rmSync(sqlPath, { force: true });
  }
}

export { insertStatements, ROWS_PER_STATEMENT, D1_MAX_STATEMENT_BYTES, workerAdminEmails };

/*
 * Only when run as a command. Without the guard, importing this module to test
 * how it builds its SQL would seed a database as a side effect of the import.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { mode, database, wranglerEnv, persistTo, e2eWorkerPool } = parseArgs(process.argv.slice(2));
  runSeed(mode, database, wranglerEnv, persistTo, e2eWorkerPool);
}

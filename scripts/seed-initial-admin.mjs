import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

function parseArgs(argv) {
  let mode = "local";
  let database = process.env.D1_DATABASE_NAME ?? "pkic-db";

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
    }
  }

  return { mode, database };
}

function runSeed(mode, database) {
  const userId = randomUUID();
  const sql =
    "INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at) " +
    `VALUES ('${userId}', 'admin@pkic.org', 'admin@pkic.org', 'admin', 1, datetime('now'), datetime('now')) ` +
    "ON CONFLICT(email) DO UPDATE SET normalized_email = excluded.normalized_email, role = 'admin', active = 1, updated_at = datetime('now');";

  const args = [
    "wrangler",
    "d1",
    "execute",
    database,
    mode === "remote" ? "--remote" : "--local",
    "--command",
    sql,
  ];

  execFileSync("npx", args, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

const { mode, database } = parseArgs(process.argv.slice(2));
runSeed(mode, database);

/**
 * One-time seed for the Board of Directors / Executive Council rosters
 * (consolidated migration 0035), matching what content/about/board.md and
 * executive-council.md hardcoded before the Leadership admin tab replaced
 * them. Not a schema migration — user ids differ per environment, so this
 * resolves each entry by email at run time via
 * `INSERT INTO leadership_positions ... SELECT ... FROM users WHERE email = ?`,
 * the same "resolve by stable identifier, not by a hardcoded id" approach
 * scripts/migrate-members-yaml-to-d1.mjs uses. An email with no matching
 * user in the target environment silently inserts zero rows (visible in
 * the printed per-row changes count) rather than failing the whole run —
 * add that person via the admin Leadership tab instead.
 *
 * "Kirk Hall" (past Board Chair / EC Chair, 2022-06-01 to 2025-02-01) has no
 * corresponding `users` row in any environment checked while building this
 * script — add that past position by hand via the admin UI once a user
 * record exists for them.
 *
 * Usage:
 *   node scripts/seed-leadership-positions.mjs --local
 *   node scripts/seed-leadership-positions.mjs --preview
 *   node scripts/seed-leadership-positions.mjs --production
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const ENVS = {
  local: { wranglerFlag: "--local", wranglerEnv: "local", database: "pkic-db-local" },
  preview: { wranglerFlag: "--remote", wranglerEnv: "preview", database: "pkic-db-preview" },
  production: { wranglerFlag: "--remote", wranglerEnv: "production", database: "pkic-db" },
};

function parseEnv(argv) {
  for (const name of Object.keys(ENVS)) {
    if (argv.includes(`--${name}`)) return name;
  }
  throw new Error("Pass one of --local, --preview, --production");
}

// One entry per person/body/title/date-range, matching board.md / executive-council.md.
const POSITIONS = [
  { body: "board", email: "chris.bailey@pkic.org", title: "Board Chair", startsAt: "2025-03-01", endsAt: null },
  { body: "board", email: "mads.henriksveen@buypass.no", title: "Board Member", startsAt: "2022-06-01", endsAt: null },
  { body: "board", email: "dzacharo@harica.gr", title: "Board Member", startsAt: "2022-06-01", endsAt: null },
  { body: "board", email: "chris@ssl.com", title: "Board Member", startsAt: "2022-06-01", endsAt: null },
  { body: "board", email: "tim.callan@sectigo.com", title: "Board Member", startsAt: "2022-06-01", endsAt: null },
  { body: "board", email: "jbuselli@us.ibm.com", title: "Board Member", startsAt: "2026-07-01", endsAt: null },

  {
    body: "executive_council",
    email: "chris.bailey@pkic.org",
    title: "EC Chair",
    startsAt: "2025-03-01",
    endsAt: null,
  },
  {
    body: "executive_council",
    email: "paul.vanbrouwershaven@digitorus.com",
    title: "PKI Consortium Chair",
    startsAt: "2021-01-01",
    endsAt: null,
  },
  {
    body: "executive_council",
    email: "clemens.wanko@tuv-austria.com",
    title: "EC Member",
    startsAt: "2022-06-01",
    endsAt: null,
  },
  {
    body: "executive_council",
    email: "mads.henriksveen@buypass.no",
    title: "EC Member",
    startsAt: "2022-06-01",
    endsAt: null,
  },
  { body: "executive_council", email: "dzacharo@harica.gr", title: "EC Member", startsAt: "2022-06-01", endsAt: null },
  { body: "executive_council", email: "chris@ssl.com", title: "EC Member", startsAt: "2022-06-01", endsAt: null },
  {
    body: "executive_council",
    email: "tim.callan@sectigo.com",
    title: "EC Member",
    startsAt: "2022-06-01",
    endsAt: null,
  },
  {
    body: "executive_council",
    email: "tomas.gustavsson@keyfactor.com",
    title: "EC Member",
    startsAt: "2022-06-01",
    endsAt: null,
  },
  {
    body: "executive_council",
    email: "sudha.e.iyer@citi.com",
    title: "EC Member",
    startsAt: "2024-07-01",
    endsAt: null,
  },
  {
    body: "executive_council",
    email: "sven.rajala@keyfactor.com",
    title: "EC Member",
    startsAt: "2026-07-01",
    endsAt: null,
  },
  { body: "executive_council", email: "aaronp@ssl.com", title: "EC Member", startsAt: "2026-07-01", endsAt: null },
  {
    body: "executive_council",
    email: "ganesh.mallaya@appviewx.com",
    title: "EC Member",
    startsAt: "2026-07-01",
    endsAt: null,
  },
  {
    body: "executive_council",
    email: "mark@pkisolutions.com",
    title: "EC Member",
    startsAt: "2026-07-01",
    endsAt: null,
  },
];

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildSql() {
  const lines = [];
  for (const p of POSITIONS) {
    lines.push(
      `INSERT INTO leadership_positions (id, body, user_id, title, starts_at, ends_at, created_at, updated_at)
SELECT lower(hex(randomblob(16))), ${sqlString(p.body)}, users.id, ${sqlString(p.title)}, ${sqlString(p.startsAt)}, ${sqlString(p.endsAt)}, datetime('now'), datetime('now')
FROM users WHERE users.email = ${sqlString(p.email)}
AND NOT EXISTS (
  SELECT 1 FROM leadership_positions lp
  WHERE lp.user_id = users.id AND lp.body = ${sqlString(p.body)} AND lp.title = ${sqlString(p.title)} AND lp.starts_at = ${sqlString(p.startsAt)}
);`,
    );
  }
  return lines.join("\n\n");
}

function main() {
  const env = parseEnv(process.argv.slice(2));
  const cfg = ENVS[env];
  const sql = buildSql();

  const tmpPath = path.join(os.tmpdir(), `pkic-seed-leadership-${Date.now()}.sql`);
  fs.writeFileSync(tmpPath, sql, "utf8");
  try {
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", cfg.database, "--env", cfg.wranglerEnv, cfg.wranglerFlag, "--file", tmpPath],
      { cwd: ROOT, stdio: "inherit" },
    );
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

main();

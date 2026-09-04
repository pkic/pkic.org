/**
 * One-time seed for the Board of Directors and Executive Council rosters,
 * matching what content/about/board.md and executive-council.md hardcoded
 * before the portal took over. Board and Executive Council are ordinary groups
 * (consolidated migration 0035): a seat is a dated group membership and a
 * chair is a capacity-bound leadership term, both written here exactly as the
 * portal writes them.
 *
 * Not a schema migration — user and identity ids differ per environment, so
 * every row resolves its person by email and their Member capacity through
 * the canonical identity_member_capacities projection at run time. An email
 * with no user, or a user with no active organization capacity, inserts zero
 * rows (visible in the printed per-statement changes count) rather than
 * failing the run — add that person from the group's Members tab instead.
 *
 * "Kirk Hall" (Board Chair and Executive Council Chair, 2022-06-01 to
 * 2025-02-01) had no `users` row in any environment checked while building
 * this script; record that former seat and term from the portal once one
 * exists, using "record a former seat" and a closed leadership term.
 *
 * Usage:
 *   node scripts/seed-governance-rosters.mjs --local
 *   node scripts/seed-governance-rosters.mjs --preview
 *   node scripts/seed-governance-rosters.mjs --production
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

const BOARD = "board";
const EXECUTIVE_COUNCIL = "executive-council";

// One seat per person and group; `title` is the roster title beyond "Member".
const SEATS = [
  { group: BOARD, email: "chris.bailey@pkic.org", joinedAt: "2025-03-01" },
  { group: BOARD, email: "mads.henriksveen@buypass.no", joinedAt: "2022-06-01" },
  { group: BOARD, email: "dzacharo@harica.gr", joinedAt: "2022-06-01" },
  { group: BOARD, email: "chris@ssl.com", joinedAt: "2022-06-01" },
  { group: BOARD, email: "tim.callan@sectigo.com", joinedAt: "2022-06-01" },
  { group: BOARD, email: "jbuselli@us.ibm.com", joinedAt: "2026-07-01" },

  { group: EXECUTIVE_COUNCIL, email: "chris.bailey@pkic.org", joinedAt: "2025-03-01" },
  {
    group: EXECUTIVE_COUNCIL,
    email: "paul.vanbrouwershaven@digitorus.com",
    joinedAt: "2021-01-01",
    title: "PKI Consortium Chair",
  },
  { group: EXECUTIVE_COUNCIL, email: "clemens.wanko@tuv-austria.com", joinedAt: "2022-06-01" },
  { group: EXECUTIVE_COUNCIL, email: "mads.henriksveen@buypass.no", joinedAt: "2022-06-01" },
  { group: EXECUTIVE_COUNCIL, email: "dzacharo@harica.gr", joinedAt: "2022-06-01" },
  { group: EXECUTIVE_COUNCIL, email: "chris@ssl.com", joinedAt: "2022-06-01" },
  { group: EXECUTIVE_COUNCIL, email: "tim.callan@sectigo.com", joinedAt: "2022-06-01" },
  { group: EXECUTIVE_COUNCIL, email: "tomas.gustavsson@keyfactor.com", joinedAt: "2022-06-01" },
  { group: EXECUTIVE_COUNCIL, email: "sudha.e.iyer@citi.com", joinedAt: "2024-07-01" },
  { group: EXECUTIVE_COUNCIL, email: "sven.rajala@keyfactor.com", joinedAt: "2026-07-01" },
  { group: EXECUTIVE_COUNCIL, email: "aaronp@ssl.com", joinedAt: "2026-07-01" },
  { group: EXECUTIVE_COUNCIL, email: "ganesh.mallaya@appviewx.com", joinedAt: "2026-07-01" },
  { group: EXECUTIVE_COUNCIL, email: "mark@pkisolutions.com", joinedAt: "2026-07-01" },
];

// Leadership terms: the seat above must exist for the same person and group.
const TERMS = [
  { group: BOARD, email: "chris.bailey@pkic.org", roleId: "role-group_lead", title: "Chair", startsAt: "2025-03-01" },
  {
    group: EXECUTIVE_COUNCIL,
    email: "chris.bailey@pkic.org",
    roleId: "role-group_lead",
    title: "Chair",
    startsAt: "2025-03-01",
  },
];

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function instant(date) {
  return `${date}T00:00:00.000Z`;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** The person's one active organization capacity; individual capacity when they represent nobody. */
function capacitySql(email) {
  return `SELECT capacity.user_id, capacity.identity_id, capacity.member_id
            FROM users
            JOIN identity_member_capacities capacity ON capacity.user_id = users.id
            JOIN identities identity ON identity.id = capacity.identity_id
           WHERE users.email = ${sqlString(email)}
             AND users.active = 1
             AND capacity.member_status = 'active'
             AND identity.started_at IS NOT NULL
             AND identity.ended_at IS NULL
             AND identity.blocked_at IS NULL
           ORDER BY CASE WHEN identity.organization_id IS NULL THEN 1 ELSE 0 END, identity.started_at DESC
           LIMIT 1`;
}

function seatSql(seat) {
  return `INSERT INTO group_memberships
  (id, group_id, user_id, identity_id, member_id, source, created_by_user_id, title, joined_at, left_at, created_at, updated_at)
SELECT lower(hex(randomblob(16))), g.id, capacity.user_id, capacity.identity_id, capacity.member_id, 'migration', NULL,
       ${sqlString(seat.title ?? null)}, ${sqlString(instant(seat.joinedAt))}, NULL, ${NOW}, ${NOW}
  FROM groups g
  JOIN (${capacitySql(seat.email)}) capacity
 WHERE g.slug = ${sqlString(seat.group)}
   AND NOT EXISTS (
     SELECT 1 FROM group_memberships existing
      WHERE existing.group_id = g.id AND existing.user_id = capacity.user_id AND existing.member_id = capacity.member_id
        AND existing.left_at IS NULL
   );`;
}

function termSql(term) {
  return `INSERT INTO user_roles
  (id, user_id, identity_id, member_id, role_id, context_type, context_id, title, starts_at,
   granted_by_user_id, single_holder_per_context, created_at)
SELECT lower(hex(randomblob(16))), seat.user_id, seat.identity_id, seat.member_id, ${sqlString(term.roleId)}, 'group', g.id,
       ${sqlString(term.title)}, ${sqlString(instant(term.startsAt))}, NULL, 0, ${NOW}
  FROM groups g
  JOIN users ON users.email = ${sqlString(term.email)}
  JOIN group_memberships seat ON seat.group_id = g.id AND seat.user_id = users.id AND seat.left_at IS NULL
 WHERE g.slug = ${sqlString(term.group)}
   AND NOT EXISTS (
     SELECT 1 FROM user_roles existing
      WHERE existing.context_type = 'group' AND existing.context_id = g.id AND existing.user_id = users.id
        AND existing.role_id = ${sqlString(term.roleId)} AND existing.revoked_at IS NULL
   )
 LIMIT 1;`;
}

function buildSql() {
  return [...SEATS.map(seatSql), ...TERMS.map(termSql)].join("\n\n");
}

function main() {
  const env = parseEnv(process.argv.slice(2));
  const cfg = ENVS[env];
  const sql = buildSql();

  const tmpPath = path.join(os.tmpdir(), `pkic-seed-governance-${Date.now()}.sql`);
  fs.writeFileSync(tmpPath, sql, "utf8");
  try {
    execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        cfg.database,
        "--env",
        cfg.wranglerEnv,
        cfg.wranglerFlag,
        "--file",
        tmpPath,
      ],
      { cwd: ROOT, stdio: "inherit" },
    );
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

main();

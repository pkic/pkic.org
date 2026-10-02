/**
 * Seeds group seats and leadership terms in the LOCAL D1 so the public
 * chair/vice-chair and consortium-leadership widgets have something to render.
 *
 * The published pages read leadership from the portal, not from front matter,
 * so a database with no assignments renders an empty widget — which is
 * indistinguishable from a broken one when you are looking at the page. This
 * gives local development a roster to look at.
 *
 * Local only: it writes through `wrangler d1 execute --local`. It is
 * idempotent — running it twice leaves the same rows.
 *
 * Usage:
 *   node scripts/seed-local-group-leadership.mjs
 *   node scripts/seed-local-group-leadership.mjs --groups pqc,cm
 */

import { execFileSync } from "node:child_process";

const GROUPS = (() => {
  const flag = process.argv.indexOf("--groups");
  // `all-members` carries the consortium's own chair and vice chair, which the
  // About page shows above the board and council.
  if (flag === -1) return ["all-members", "pqc", "cm", "pkimm", "cbom", "ca", "tcwg", "board", "executive-council"];
  return (process.argv[flag + 1] ?? "").split(",").filter(Boolean);
})();

/** One `wrangler d1 execute` round trip, returning the parsed rows. */
function query(sql) {
  const raw = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "DB", "--env", "local", "--local", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const start = raw.indexOf("[");
  if (start === -1) throw new Error(`Unexpected d1 output:\n${raw.slice(0, 400)}`);
  const parsed = JSON.parse(raw.slice(start));
  return parsed[0]?.results ?? [];
}

function escape(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * People who can hold a seat: an active member reached through a live identity
 * capacity, which is exactly what `assignLocalGroupLeadership` requires.
 */
const candidates = query(`
  SELECT i.id AS identity_id, i.user_id, c.member_id,
         COALESCE(u.first_name || ' ' || u.last_name, u.email) AS who
    FROM identities i
    JOIN identity_member_capacities c ON c.identity_id = i.id
    JOIN members m ON m.id = c.member_id AND m.status = 'active'
    JOIN users u ON u.id = i.user_id AND u.active = 1
   WHERE i.started_at IS NOT NULL AND i.ended_at IS NULL AND i.blocked_at IS NULL
   ORDER BY u.created_at, i.id
   LIMIT 40
`);

if (candidates.length < 2) {
  console.error("[seed-leadership] Not enough active representatives in the local database.");
  process.exit(1);
}

const ROLES = [
  { id: "role-group_lead", title: "Chair" },
  { id: "role-group_deputy_lead", title: "Vice Chair" },
];

let seeded = 0;
for (const [index, slug] of GROUPS.entries()) {
  const [group] = query(`SELECT id, name FROM groups WHERE slug = ${escape(slug)} AND active = 1`);
  if (!group) {
    console.log(`[seed-leadership] no active group ${slug}, skipped`);
    continue;
  }

  for (const [offset, role] of ROLES.entries()) {
    // A different pair per group, so the pages do not all show one person.
    const person = candidates[(index * ROLES.length + offset) % candidates.length];

    const [existingSeat] = query(`
      SELECT id FROM group_memberships
       WHERE group_id = ${escape(group.id)} AND user_id = ${escape(person.user_id)} AND left_at IS NULL
    `);
    if (!existingSeat) {
      query(`
        INSERT INTO group_memberships
          (id, group_id, user_id, identity_id, member_id, source, joined_at, left_at, created_at, updated_at)
        VALUES (lower(hex(randomblob(16))), ${escape(group.id)}, ${escape(person.user_id)},
                ${escape(person.identity_id)}, ${escape(person.member_id)}, 'staff',
                datetime('now'), NULL, datetime('now'), datetime('now'))
      `);
    }

    const [existingRole] = query(`
      SELECT id FROM user_roles
       WHERE context_type = 'group' AND context_id = ${escape(group.id)}
         AND role_id = ${escape(role.id)} AND revoked_at IS NULL
    `);
    if (existingRole) continue;

    query(`
      INSERT INTO user_roles
        (id, user_id, identity_id, member_id, role_id, context_type, context_id, title, starts_at,
         granted_by_user_id, single_holder_per_context, expires_at, revoked_at, created_at)
      VALUES (lower(hex(randomblob(16))), ${escape(person.user_id)}, ${escape(person.identity_id)},
              ${escape(person.member_id)}, ${escape(role.id)}, 'group', ${escape(group.id)},
              ${escape(role.title)}, datetime('now'), NULL, 0, NULL, NULL, datetime('now'))
    `);
    seeded += 1;
    console.log(`[seed-leadership] ${group.name}: ${role.title} → ${person.who}`);
  }
}

console.log(`[seed-leadership] ${seeded} assignment(s) written.`);

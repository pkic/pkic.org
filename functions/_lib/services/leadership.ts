/**
 * Board of Directors / Executive Council leadership positions (migration
 * 0049) — admin CRUD plus the public roster read, and the PKIC forum
 * chair/vice-chair public read (resolved from role-forum_chair/
 * role-forum_vice_chair, migration 0040 — the same source the admin
 * Leadership tab's "Forum" card already manages via user_roles).
 *
 * Organization/photo/LinkedIn enrichment mirrors
 * members-directory.ts's getWorkingGroupChairsPublic: resolved live from
 * the person's current active `members`/`organizations` row, not from a
 * value captured at the time the position was created — so a Board
 * member's displayed affiliation always reflects who they work for today.
 */
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { parseLinksJson, findLinkedinUrl } from "../../../assets/shared/schemas/api";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

export type LeadershipBody = "board" | "executive_council";

export interface LeadershipPositionAdmin {
  id: string;
  body: LeadershipBody;
  userId: string;
  name: string;
  email: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadershipPublicPerson {
  name: string;
  title: string;
  organizationName: string | null;
  organizationLogoUrl: string | null;
  organizationWebsite: string | null;
  photoUrl: string | null;
  linkedin: string | null;
  startsAt: string;
  endsAt: string | null;
}

export interface ForumChairPublic {
  name: string;
  organizationName: string | null;
  organizationLogoUrl: string | null;
  organizationWebsite: string | null;
  photoUrl: string | null;
  linkedin: string | null;
  startsAt: string;
}

interface LeadershipPositionRow {
  id: string;
  body: LeadershipBody;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

const ADMIN_POSITION_SELECT = `
  SELECT lp.id, lp.body, lp.user_id, u.first_name, u.last_name, u.email,
         lp.title, lp.starts_at, lp.ends_at, lp.created_at, lp.updated_at
  FROM leadership_positions lp
  JOIN users u ON u.id = lp.user_id
`;

function toAdmin(row: LeadershipPositionRow): LeadershipPositionAdmin {
  return {
    id: row.id,
    body: row.body,
    userId: row.user_id,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listLeadershipPositionsAdmin(
  db: DatabaseLike,
  body: LeadershipBody,
): Promise<LeadershipPositionAdmin[]> {
  const rows = await all<LeadershipPositionRow>(
    db,
    `${ADMIN_POSITION_SELECT} WHERE lp.body = ? ORDER BY (lp.ends_at IS NOT NULL) ASC, lp.starts_at DESC`,
    [body],
  );
  return rows.map(toAdmin);
}

export async function createLeadershipPosition(
  db: DatabaseLike,
  input: { body: LeadershipBody; userId: string; title: string; startsAt: string; endsAt?: string | null },
): Promise<LeadershipPositionAdmin> {
  const user = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [input.userId]);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const id = uuid();
  const now = nowIso();
  await run(
    db,
    `INSERT INTO leadership_positions (id, body, user_id, title, starts_at, ends_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.body, input.userId, input.title, input.startsAt, input.endsAt ?? null, now, now],
  );

  const row = await first<LeadershipPositionRow>(db, `${ADMIN_POSITION_SELECT} WHERE lp.id = ?`, [id]);
  return toAdmin(row!);
}

export async function updateLeadershipPosition(
  db: DatabaseLike,
  id: string,
  patch: { title?: string; startsAt?: string; endsAt?: string | null },
): Promise<LeadershipPositionAdmin> {
  const existing = await first<{ id: string }>(db, "SELECT id FROM leadership_positions WHERE id = ?", [id]);
  if (!existing) {
    throw new AppError(404, "NOT_FOUND", "Position not found");
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    setClauses.push("title = ?");
    values.push(patch.title);
  }
  if (patch.startsAt !== undefined) {
    setClauses.push("starts_at = ?");
    values.push(patch.startsAt);
  }
  if (patch.endsAt !== undefined) {
    setClauses.push("ends_at = ?");
    values.push(patch.endsAt);
  }

  setClauses.push("updated_at = ?");
  values.push(nowIso());
  values.push(id);
  await run(db, `UPDATE leadership_positions SET ${setClauses.join(", ")} WHERE id = ?`, values);

  const row = await first<LeadershipPositionRow>(db, `${ADMIN_POSITION_SELECT} WHERE lp.id = ?`, [id]);
  return toAdmin(row!);
}

export async function deleteLeadershipPosition(db: DatabaseLike, id: string): Promise<void> {
  const existing = await first<{ id: string }>(db, "SELECT id FROM leadership_positions WHERE id = ?", [id]);
  if (!existing) {
    throw new AppError(404, "NOT_FOUND", "Position not found");
  }
  await run(db, "DELETE FROM leadership_positions WHERE id = ?", [id]);
}

interface PublicPositionRow extends LeadershipPositionRow {
  org_id: string | null;
  org_name: string | null;
  org_logo_r2_key: string | null;
  org_website: string | null;
  member_id: string | null;
  headshot_r2_key: string | null;
  links_json: string | null;
}

export async function getLeadershipPublic(
  db: DatabaseLike,
  body: LeadershipBody,
): Promise<{ current: LeadershipPublicPerson[]; past: LeadershipPublicPerson[] }> {
  const rows = await all<PublicPositionRow>(
    db,
    `SELECT lp.id, lp.body, lp.user_id, u.first_name, u.last_name, u.email,
            lp.title, lp.starts_at, lp.ends_at, lp.created_at, lp.updated_at,
            o.id AS org_id, o.name AS org_name, o.logo_r2_key AS org_logo_r2_key, o.website AS org_website,
            COALESCE(rep.id, mi.id) AS member_id, u.headshot_r2_key, u.links_json
     FROM leadership_positions lp
     JOIN users u ON u.id = lp.user_id
     -- A leadership holder can represent more than one organization at once
     -- (migration 0037) — join to a single deterministic representative
     -- row (earliest joined_at) instead of fanning out one result row per
     -- represented organization.
     LEFT JOIN organization_representatives rep ON rep.id = (
       SELECT r2.id FROM organization_representatives r2
       WHERE r2.user_id = u.id AND r2.left_at IS NULL
       ORDER BY r2.joined_at ASC LIMIT 1
     )
     LEFT JOIN members m ON m.id = rep.member_id
     LEFT JOIN members mi ON mi.user_id = u.id AND mi.status = 'active'
     LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE lp.body = ?
     ORDER BY lp.starts_at ASC`,
    [body],
  );

  const toPublic = (row: PublicPositionRow): LeadershipPublicPerson => ({
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
    title: row.title,
    organizationName: row.org_name,
    organizationLogoUrl: row.org_logo_r2_key && row.org_id ? `/api/v1/members/${row.org_id}/logo` : null,
    organizationWebsite: row.org_website,
    photoUrl: row.headshot_r2_key && row.member_id ? `/api/v1/members/${row.member_id}/logo` : null,
    linkedin: findLinkedinUrl(parseLinksJson(row.links_json)),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  });

  const current = rows.filter((r) => !r.ends_at).map(toPublic);
  const past = rows
    .filter((r) => r.ends_at)
    .map(toPublic)
    // Most recently ended first, matching consortium-leadership.html's past-positions timeline.
    .sort((a, b) => (b.endsAt ?? "").localeCompare(a.endsAt ?? ""));
  return { current, past };
}

interface ForumChairRow {
  role_id: string;
  first_name: string | null;
  last_name: string | null;
  org_id: string | null;
  org_name: string | null;
  org_logo_r2_key: string | null;
  org_website: string | null;
  member_id: string | null;
  headshot_r2_key: string | null;
  links_json: string | null;
  created_at: string;
}

/**
 * Public PKIC forum chair/vice-chair — same role-forum_chair/
 * role-forum_vice_chair query members-directory.ts's
 * getWorkingGroupChairsPublic runs for WG chairs, but global-context
 * (context_type IS NULL) instead of scoped to a working group.
 */
export async function getForumChairsPublic(
  db: DatabaseLike,
): Promise<{ chair: ForumChairPublic | null; viceChair: ForumChairPublic | null }> {
  const rows = await all<ForumChairRow>(
    db,
    `SELECT ur.role_id, u.first_name, u.last_name, o.id AS org_id, o.name AS org_name,
            o.logo_r2_key AS org_logo_r2_key, o.website AS org_website,
            COALESCE(rep.id, mi.id) AS member_id, u.headshot_r2_key, u.links_json, ur.created_at
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     -- A forum chair/vice-chair can represent more than one organization at
     -- once (migration 0037) — join to a single deterministic
     -- representative row (earliest joined_at) instead of fanning out one
     -- result row per represented organization.
     LEFT JOIN organization_representatives rep ON rep.id = (
       SELECT r2.id FROM organization_representatives r2
       WHERE r2.user_id = u.id AND r2.left_at IS NULL
       ORDER BY r2.joined_at ASC LIMIT 1
     )
     LEFT JOIN members m ON m.id = rep.member_id
     LEFT JOIN members mi ON mi.user_id = u.id AND mi.status = 'active'
     LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE ur.context_type IS NULL AND ur.context_id IS NULL
       AND ur.role_id IN ('role-forum_chair', 'role-forum_vice_chair')
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ORDER BY ur.created_at DESC`,
  );

  const toPublic = (row: ForumChairRow | undefined): ForumChairPublic | null => {
    if (!row) return null;
    return {
      name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
      organizationName: row.org_name,
      organizationLogoUrl: row.org_logo_r2_key && row.org_id ? `/api/v1/members/${row.org_id}/logo` : null,
      organizationWebsite: row.org_website,
      photoUrl: row.headshot_r2_key && row.member_id ? `/api/v1/members/${row.member_id}/logo` : null,
      linkedin: findLinkedinUrl(parseLinksJson(row.links_json)),
      startsAt: row.created_at,
    };
  };

  return {
    chair: toPublic(rows.find((r) => r.role_id === "role-forum_chair")),
    viceChair: toPublic(rows.find((r) => r.role_id === "role-forum_vice_chair")),
  };
}

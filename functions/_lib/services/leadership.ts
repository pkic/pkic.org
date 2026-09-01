/**
 * Board of Directors / Executive Council leadership positions (consolidated
 * migration 0035) — System CRUD plus the public roster read, and the consortium
 * chair/vice-chair public read. The public leadership surface resolves the
 * explicitly published All Members group's canonical lead/deputy-lead roles;
 * there is no separate consortium authorization model.
 *
 * Board/EC positions store the exact acting identity they explicitly use. This
 * avoids assigning an arbitrary organization to people who concurrently
 * represent more than one member.
 */
import { all, first } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { parseLinksJson, findLinkedinUrl } from "../../../assets/shared/schemas/links";
import { sanitizeLegacyHttpUrl } from "../../../assets/shared/schemas/urls";
import { toPublicRoleProfile, type PublicRoleProfile } from "./membership/public-role-profile";
import { prepareAuditLog } from "./audit";
import { resolveLeadershipAffiliation } from "./leadership-affiliations";
import { AppError } from "../errors";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import type { DatabaseLike } from "../types";
import type { LeadershipBody, LeadershipPositionsListQuery } from "../../../assets/shared/schemas/leadership";
import { SYSTEM_ROLE_IDS } from "../../../assets/shared/schemas/access-control";

export type { LeadershipBody };

export interface LeadershipPositionRecord {
  id: string;
  body: LeadershipBody;
  userId: string;
  identityId: string | null;
  organizationName: string | null;
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
  jobTitle: string | null;
  title: string;
  organizationName: string | null;
  organizationLogoUrl: string | null;
  organizationWebsite: string | null;
  photoUrl: string | null;
  linkedin: string | null;
  startsAt: string;
  endsAt: string | null;
}

export interface ConsortiumChairPublic extends PublicRoleProfile {
  startsAt: string;
}

interface LeadershipPositionRow {
  id: string;
  body: LeadershipBody;
  user_id: string;
  identity_id: string | null;
  organization_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

const LEADERSHIP_POSITION_SELECT = `
  SELECT lp.id, lp.body, lp.user_id, lp.identity_id, o.name AS organization_name,
         u.first_name, u.last_name, u.email,
         lp.title, lp.starts_at, lp.ends_at, lp.created_at, lp.updated_at
  FROM leadership_positions lp
  JOIN users u ON u.id = lp.user_id
  LEFT JOIN identities identity ON identity.id = lp.identity_id
  LEFT JOIN organizations o ON o.id = identity.organization_id
`;

function toLeadershipPosition(row: LeadershipPositionRow): LeadershipPositionRecord {
  return {
    id: row.id,
    body: row.body,
    userId: row.user_id,
    identityId: row.identity_id,
    organizationName: row.organization_name,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listLeadershipPositions(
  db: DatabaseLike,
  query: LeadershipPositionsListQuery,
): Promise<{ positions: LeadershipPositionRecord[]; total: number }> {
  const conditions = ["lp.body = ?"];
  const bindings: unknown[] = [query.body];
  if (query.status === "current") conditions.push("(lp.ends_at IS NULL OR lp.ends_at >= date('now'))");
  if (query.status === "past") conditions.push("lp.ends_at < date('now')");
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, [
      "u.first_name",
      "u.last_name",
      "u.first_name || ' ' || u.last_name",
      "u.email",
      "lp.title",
      "o.name",
    ]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const orderBy = resolveMappedOrderBy(
    query.sort,
    {
      name: "LOWER(COALESCE(u.last_name, ''))",
      title: "LOWER(lp.title)",
      starts_at: "lp.starts_at",
      ends_at: "lp.ends_at",
      created_at: "lp.created_at",
    },
    "(lp.ends_at IS NOT NULL) ASC, lp.starts_at DESC",
    "lp.id ASC",
  );
  const { rows, total } = await queryPage<LeadershipPositionRow>(db, {
    sql: `${LEADERSHIP_POSITION_SELECT} ${where}`,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  return { positions: rows.map(toLeadershipPosition), total };
}

export async function createLeadershipPosition(
  db: DatabaseLike,
  input: {
    body: LeadershipBody;
    userId: string;
    identityId?: string | null;
    title: string;
    startsAt: string;
    endsAt?: string | null;
  },
  actorUserId: string,
): Promise<LeadershipPositionRecord> {
  const user = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [input.userId]);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const identityId = await resolveLeadershipAffiliation(db, input.userId, input.identityId);
  const id = uuid();
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO leadership_positions
           (id, body, user_id, identity_id, title, starts_at, ends_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, input.body, input.userId, identityId, input.title, input.startsAt, input.endsAt ?? null, now, now),
    prepareAuditLog(
      db,
      "admin",
      actorUserId,
      "leadership_position_created",
      "leadership_position",
      id,
      { body: input.body, userId: input.userId, identityId, title: input.title },
      now,
    ),
  ]);

  const row = await first<LeadershipPositionRow>(db, `${LEADERSHIP_POSITION_SELECT} WHERE lp.id = ?`, [id]);
  return toLeadershipPosition(row!);
}

export async function updateLeadershipPosition(
  db: DatabaseLike,
  id: string,
  patch: { identityId?: string | null; title?: string; startsAt?: string; endsAt?: string | null },
  actorUserId: string,
): Promise<LeadershipPositionRecord> {
  const existing = await first<{ id: string; user_id: string; starts_at: string; ends_at: string | null }>(
    db,
    "SELECT id, user_id, starts_at, ends_at FROM leadership_positions WHERE id = ?",
    [id],
  );
  if (!existing) {
    throw new AppError(404, "NOT_FOUND", "Position not found");
  }

  const nextStartsAt = patch.startsAt ?? existing.starts_at;
  const nextEndsAt = patch.endsAt === undefined ? existing.ends_at : patch.endsAt;
  if (nextEndsAt && nextEndsAt < nextStartsAt) {
    throw new AppError(422, "INVALID_DATE_RANGE", "endsAt cannot be before startsAt");
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (patch.identityId !== undefined) {
    setClauses.push("identity_id = ?");
    values.push(await resolveLeadershipAffiliation(db, existing.user_id, patch.identityId));
  }
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

  const now = nowIso();
  setClauses.push("updated_at = ?");
  values.push(now);
  values.push(id);
  await db.batch([
    db.prepare(`UPDATE leadership_positions SET ${setClauses.join(", ")} WHERE id = ?`).bind(...values),
    prepareAuditLog(db, "admin", actorUserId, "leadership_position_updated", "leadership_position", id, patch, now),
  ]);

  const row = await first<LeadershipPositionRow>(db, `${LEADERSHIP_POSITION_SELECT} WHERE lp.id = ?`, [id]);
  return toLeadershipPosition(row!);
}

export async function deleteLeadershipPosition(db: DatabaseLike, id: string, actorUserId: string): Promise<void> {
  const existing = await first<{ id: string }>(db, "SELECT id FROM leadership_positions WHERE id = ?", [id]);
  if (!existing) {
    throw new AppError(404, "NOT_FOUND", "Position not found");
  }
  const now = nowIso();
  await db.batch([
    db.prepare("DELETE FROM leadership_positions WHERE id = ?").bind(id),
    prepareAuditLog(db, "admin", actorUserId, "leadership_position_deleted", "leadership_position", id, {}, now),
  ]);
}

interface PublicPositionRow extends LeadershipPositionRow {
  job_title: string | null;
  org_id: string | null;
  org_name: string | null;
  org_logo_r2_key: string | null;
  org_website: string | null;
  photo_identity_id: string | null;
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
            CASE WHEN identity.organization_id IS NULL THEN category.label ELSE identity.job_title END AS job_title,
            lp.identity_id, lp.title, lp.starts_at, lp.ends_at, lp.created_at, lp.updated_at,
            o.id AS org_id, o.name AS org_name, o.logo_r2_key AS org_logo_r2_key, o.website AS org_website,
            identity.id AS photo_identity_id, u.headshot_r2_key, identity.links_json
     FROM leadership_positions lp
     JOIN users u ON u.id = lp.user_id
     LEFT JOIN identities identity ON identity.id = lp.identity_id AND identity.user_id = lp.user_id
     LEFT JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
     LEFT JOIN membership_categories category ON category.code = capacity.membership_category
     LEFT JOIN organizations o ON o.id = identity.organization_id
     WHERE lp.body = ?
     ORDER BY lp.starts_at ASC`,
    [body],
  );

  const toPublic = (row: PublicPositionRow): LeadershipPublicPerson => ({
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
    jobTitle: row.job_title,
    title: row.title,
    organizationName: row.org_name,
    organizationLogoUrl: row.org_logo_r2_key && row.org_id ? `/api/v1/members/${row.org_id}/logo` : null,
    organizationWebsite: sanitizeLegacyHttpUrl(row.org_website),
    photoUrl: row.headshot_r2_key && row.photo_identity_id ? `/api/v1/members/${row.photo_identity_id}/logo` : null,
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

interface ConsortiumChairRow {
  role_id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  org_id: string | null;
  org_name: string | null;
  org_logo_r2_key: string | null;
  org_website: string | null;
  identity_id: string | null;
  headshot_r2_key: string | null;
  links_json: string | null;
  created_at: string;
}

/**
 * Public consortium chair/vice-chair response. Its source is
 * the ordinary All Members group and publication is controlled on that group.
 */
export async function getConsortiumChairsPublic(
  db: DatabaseLike,
): Promise<{ chair: ConsortiumChairPublic | null; viceChair: ConsortiumChairPublic | null }> {
  const rows = await all<ConsortiumChairRow>(
    db,
    `SELECT ur.role_id, u.first_name, u.last_name,
            CASE WHEN identity.organization_id IS NULL THEN category.label ELSE identity.job_title END AS job_title,
            o.id AS org_id, o.name AS org_name,
            o.logo_r2_key AS org_logo_r2_key, o.website AS org_website,
            identity.id AS identity_id, u.headshot_r2_key, identity.links_json,
            ur.created_at
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     JOIN groups leadership_group
       ON leadership_group.id = ur.context_id
      AND leadership_group.slug = 'all-members'
      AND leadership_group.active = 1
      AND leadership_group.public_leadership = 1
     JOIN group_memberships membership
       ON membership.group_id = leadership_group.id
      AND membership.user_id = ur.user_id
      AND membership.member_id = ur.member_id
      AND membership.left_at IS NULL
     JOIN members m ON m.id = membership.member_id AND m.status = 'active'
     JOIN identities identity ON identity.id = membership.identity_id
      AND identity.user_id = ur.user_id
      AND identity.started_at IS NOT NULL
      AND identity.ended_at IS NULL
      AND identity.blocked_at IS NULL
     JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
      AND capacity.member_id = m.id
     JOIN membership_categories category ON category.code = capacity.membership_category
     LEFT JOIN organizations o ON o.id = identity.organization_id
     WHERE ur.context_type = 'group'
       AND ur.role_id IN (?, ?)
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ORDER BY ur.created_at DESC`,
    [SYSTEM_ROLE_IDS.groupLead, SYSTEM_ROLE_IDS.groupDeputyLead],
  );

  const toPublic = (row: ConsortiumChairRow | undefined): ConsortiumChairPublic | null => {
    if (!row) return null;
    return {
      ...toPublicRoleProfile(row),
      startsAt: row.created_at,
    };
  };

  return {
    chair: toPublic(rows.find((r) => r.role_id === SYSTEM_ROLE_IDS.groupLead)),
    viceChair: toPublic(rows.find((r) => r.role_id === SYSTEM_ROLE_IDS.groupDeputyLead)),
  };
}

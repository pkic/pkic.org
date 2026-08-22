import { first, run } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import type { DatabaseLike, StatementLike } from "../types";

export interface UserRecord {
  id: string;
  email: string;
  normalized_email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  data_json: string | null;
}

const USER_RECORD_COLUMN_NAMES = [
  "id",
  "email",
  "normalized_email",
  "first_name",
  "last_name",
  "preferred_name",
  "organization_name",
  "job_title",
  "biography",
  "links_json",
  "data_json",
] as const;

/**
 * Best-effort split for legacy/admin inputs that still submit one display
 * name. Callers with separately collected names should preserve those fields
 * instead of round-tripping them through this helper.
 */
export function splitPersonName(fullName: string): { firstName: string | null; lastName: string | null } {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: null, lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };
  return { firstName: tokens.slice(0, -1).join(" "), lastName: tokens[tokens.length - 1] };
}

/** Canonical projection for the deliberately narrow user domain record. */
export function userRecordColumns(tableAlias?: string): string {
  return USER_RECORD_COLUMN_NAMES.map((column) => (tableAlias ? `${tableAlias}.${column}` : column)).join(", ");
}

/**
 * Matches a `users` row by its primary email OR by any secondary email
 * recorded in `user_emails` (admin-managed aliases) -- so admin
 * find-or-create flows (adding a
 * representative, the Interim Admin Tool) recognize a person by any known
 * address instead of creating a duplicate `users` row. Login lookups
 * (magic-link request/verify in `_lib/auth/admin.ts`/`_lib/auth/member.ts`)
 * deliberately do NOT go through this helper -- secondary emails are
 * admin/display/search only and must not grant login via an alias.
 */
async function findExistingUserByAnyEmail(db: DatabaseLike, normalizedEmail: string): Promise<UserRecord | null> {
  const direct = await first<UserRecord>(db, `SELECT ${userRecordColumns()} FROM users WHERE normalized_email = ?`, [
    normalizedEmail,
  ]);
  if (direct) return direct;
  return first<UserRecord>(
    db,
    `SELECT ${userRecordColumns("u")}
     FROM users u JOIN user_emails ue ON ue.user_id = u.id
     WHERE ue.normalized_email = ?`,
    [normalizedEmail],
  );
}

export async function findUserByEmail(db: DatabaseLike, email: string): Promise<UserRecord | null> {
  return findExistingUserByAnyEmail(db, normalizeEmail(email));
}

export async function getNormalizedEmailForUser(db: DatabaseLike, userId: string): Promise<string | null> {
  return (
    (await first<{ normalized_email: string }>(db, "SELECT normalized_email FROM users WHERE id = ?", [userId]))
      ?.normalized_email ?? null
  );
}

export interface FindOrCreateUserPayload {
  email: string;
  firstName?: string;
  lastName?: string;
  organizationName?: string;
  jobTitle?: string;
  biography?: string | null;
  linksJson?: string | null;
  preferredName?: string | null;
  dataJson?: string | null;
  /** Whether to merge submitted profile fields into an existing record.
   *  Default: false — public submissions do not update existing profiles. */
  allowProfileUpdate?: boolean;
}

export interface UserProfilePatch {
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  organizationName?: string | null;
  jobTitle?: string | null;
  biography?: string | null;
  linksJson?: string | null;
  headshotR2Key?: string | null;
}

/** Shared explicit-presence profile patch for every authenticated/admin flow. */
export function prepareUserProfileStatement(
  db: DatabaseLike,
  userId: string,
  payload: UserProfilePatch,
): StatementLike {
  const now = nowIso();
  const assignments: string[] = [];
  const values: Array<string | null> = [];

  const add = (column: string, value: string | null | undefined): void => {
    if (value === undefined) return;
    assignments.push(`${column} = ?`);
    values.push(value);
  };
  add("first_name", payload.firstName);
  add("last_name", payload.lastName);
  add("preferred_name", payload.preferredName);
  add("organization_name", payload.organizationName);
  add("job_title", payload.jobTitle);
  add("biography", payload.biography);
  add("links_json", payload.linksJson);
  if (payload.headshotR2Key !== undefined) {
    add("headshot_r2_key", payload.headshotR2Key);
    add("headshot_updated_at", payload.headshotR2Key ? now : null);
  }
  assignments.push("updated_at = ?");
  values.push(now);
  return db.prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`).bind(...values, userId);
}

/**
 * Resolves what `findOrCreateUser` would do for `payload` — the resulting
 * `UserRecord` and, if a write is needed, its query + bound values — without
 * executing anything. Shared by `findOrCreateUser` (executes immediately)
 * and `buildFindOrCreateUserStatement` (returns an unexecuted statement for
 * a caller-assembled atomic `db.batch()`).
 */
async function resolveUserWrite(
  db: DatabaseLike,
  payload: FindOrCreateUserPayload,
): Promise<
  | { user: UserRecord; query: string; values: unknown[]; created: boolean }
  | { user: UserRecord; query: null; created: false }
> {
  const normalized = normalizeEmail(payload.email);
  const existing = await findExistingUserByAnyEmail(db, normalized);

  if (!existing) {
    const user: UserRecord = {
      id: uuid(),
      email: payload.email,
      normalized_email: normalized,
      first_name: payload.firstName ?? null,
      last_name: payload.lastName ?? null,
      preferred_name: payload.preferredName ?? null,
      organization_name: payload.organizationName ?? null,
      job_title: payload.jobTitle ?? null,
      biography: payload.biography ?? null,
      links_json: payload.linksJson ?? null,
      data_json: payload.dataJson ?? null,
    };

    const now = nowIso();
    return {
      user,
      created: true,
      query: `INSERT INTO users (
        id, email, normalized_email, first_name, last_name, preferred_name,
        organization_name, job_title, biography, links_json,
        data_json, role, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', 1, ?, ?)`,
      values: [
        user.id,
        user.email,
        user.normalized_email,
        user.first_name,
        user.last_name,
        user.preferred_name,
        user.organization_name,
        user.job_title,
        user.biography,
        user.links_json,
        user.data_json,
        now,
        now,
      ],
    };
  }

  // Public submissions must not overwrite existing profile data.
  if (!payload.allowProfileUpdate) {
    return { user: existing, query: null, created: false };
  }

  const updatedFirstName = payload.firstName ?? existing.first_name;
  const updatedLastName = payload.lastName ?? existing.last_name;
  const updatedPreferredName = payload.preferredName ?? existing.preferred_name;
  const updatedOrganizationName = payload.organizationName ?? existing.organization_name;
  const updatedJobTitle = payload.jobTitle ?? existing.job_title;
  const updatedBiography = payload.biography ?? existing.biography;
  const updatedLinksJson = payload.linksJson ?? existing.links_json;
  const updatedDataJson = payload.dataJson ?? existing.data_json;

  const user: UserRecord = {
    ...existing,
    first_name: updatedFirstName,
    last_name: updatedLastName,
    preferred_name: updatedPreferredName,
    organization_name: updatedOrganizationName,
    job_title: updatedJobTitle,
    biography: updatedBiography,
    links_json: updatedLinksJson,
    data_json: updatedDataJson,
  };

  return {
    user,
    created: false,
    query: `UPDATE users
     SET first_name = ?,
         last_name = ?,
         preferred_name = ?,
         organization_name = ?,
         job_title = ?,
         biography = ?,
         links_json = ?,
         data_json = ?,
         updated_at = ?
     WHERE id = ?`,
    values: [
      updatedFirstName,
      updatedLastName,
      updatedPreferredName,
      updatedOrganizationName,
      updatedJobTitle,
      updatedBiography,
      updatedLinksJson,
      updatedDataJson,
      nowIso(),
      existing.id,
    ],
  };
}

/**
 * Finds an existing user by email or creates a new one.
 *
 * SECURITY: `allowProfileUpdate` defaults to false. Public registration flows
 * (unauthenticated) must never overwrite an existing user's profile — an
 * attacker could otherwise hijack someone else's name/org by submitting a
 * registration with their email address. Set allowProfileUpdate only in
 * authenticated or admin-controlled contexts.
 */
export async function findOrCreateUser(db: DatabaseLike, payload: FindOrCreateUserPayload): Promise<UserRecord> {
  const resolved = await resolveUserWrite(db, payload);
  if (resolved.query) {
    await run(db, resolved.query, resolved.values);
  }
  return resolved.user;
}

/**
 * Same resolution as `findOrCreateUser`, but returns an unexecuted
 * statement instead of writing immediately — lets a caller that's already
 * assembling a larger atomic `db.batch()` (e.g. admin-members.ts's
 * createAdminMember, membership/provisioning.ts's provisionOrganizationMembership)
 * fold the user write into that same transition instead of committing it
 * ahead of a batch that might still fail.
 */
export async function buildFindOrCreateUserStatement(
  db: DatabaseLike,
  payload: FindOrCreateUserPayload,
): Promise<{ user: UserRecord; statement: StatementLike | null; created: boolean }> {
  const resolved = await resolveUserWrite(db, payload);
  if (!resolved.query) {
    return { user: resolved.user, statement: null, created: resolved.created };
  }
  return {
    user: resolved.user,
    statement: db.prepare(resolved.query).bind(...resolved.values),
    created: resolved.created,
  };
}

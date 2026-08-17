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

/**
 * Matches a `users` row by its primary email OR by any secondary email
 * recorded in `user_emails` (admin-managed, e.g. from the user-merge tool
 * or manually added aliases) -- so admin find-or-create flows (adding a
 * representative, the Interim Admin Tool) recognize a person by any known
 * address instead of creating a duplicate `users` row. Login lookups
 * (magic-link request/verify in `_lib/auth/admin.ts`/`_lib/auth/member.ts`)
 * deliberately do NOT go through this helper -- secondary emails are
 * admin/display/search only and must not grant login via an alias.
 */
async function findExistingUserByAnyEmail(db: DatabaseLike, normalizedEmail: string): Promise<UserRecord | null> {
  const direct = await first<UserRecord>(db, "SELECT * FROM users WHERE normalized_email = ?", [normalizedEmail]);
  if (direct) return direct;
  return first<UserRecord>(
    db,
    `SELECT u.* FROM users u JOIN user_emails ue ON ue.user_id = u.id WHERE ue.normalized_email = ?`,
    [normalizedEmail],
  );
}

export async function findUserByEmail(db: DatabaseLike, email: string): Promise<UserRecord | null> {
  return findExistingUserByAnyEmail(db, normalizeEmail(email));
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
): Promise<{ user: UserRecord; query: string; values: unknown[] } | { user: UserRecord; query: null }> {
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
    return { user: existing, query: null };
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
): Promise<{ user: UserRecord; statement: StatementLike | null }> {
  const resolved = await resolveUserWrite(db, payload);
  if (!resolved.query) {
    return { user: resolved.user, statement: null };
  }
  return { user: resolved.user, statement: db.prepare(resolved.query).bind(...resolved.values) };
}

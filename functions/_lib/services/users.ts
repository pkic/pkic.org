import { first, run } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import type { DatabaseLike } from "../types";

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

export async function findUserByEmail(db: DatabaseLike, email: string): Promise<UserRecord | null> {
  return first<UserRecord>(db, "SELECT * FROM users WHERE normalized_email = ?", [normalizeEmail(email)]);
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
export async function findOrCreateUser(
  db: DatabaseLike,
  payload: {
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
  },
): Promise<UserRecord> {
  const normalized = normalizeEmail(payload.email);
  const existing = await first<UserRecord>(db, "SELECT * FROM users WHERE normalized_email = ?", [normalized]);

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
    await run(
      db,
      `INSERT INTO users (
        id, email, normalized_email, first_name, last_name, preferred_name,
        organization_name, job_title, biography, links_json,
        data_json, role, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', 1, ?, ?)`,
      [
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
    );

    return user;
  }

  // Public submissions must not overwrite existing profile data.
  if (!payload.allowProfileUpdate) {
    return existing;
  }

  const updatedFirstName = payload.firstName ?? existing.first_name;
  const updatedLastName = payload.lastName ?? existing.last_name;
  const updatedPreferredName = payload.preferredName ?? existing.preferred_name;
  const updatedOrganizationName = payload.organizationName ?? existing.organization_name;
  const updatedJobTitle = payload.jobTitle ?? existing.job_title;
  const updatedBiography = payload.biography ?? existing.biography;
  const updatedLinksJson = payload.linksJson ?? existing.links_json;
  const updatedDataJson = payload.dataJson ?? existing.data_json;

  await run(
    db,
    `UPDATE users
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
    [
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
  );

  return {
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
}

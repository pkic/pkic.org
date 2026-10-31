import { firstNameSchema, lastNameSchema } from "../../../assets/shared/schemas/api-common";
import {
  readEmailOwnership,
  provedMailboxUserId,
  provedMailboxUserIdSelection,
  prepareEmailOwnershipClaim,
  type EmailOwnership,
} from "./email-ownership";
import { first } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL } from "./people/profile-publication-sql";
import { publicGroupProfileUserCondition } from "./groups/profile-publication";
import { PUBLIC_MEMBER_USER_SOURCE_SQL } from "./membership/public-profile-sql";
import { prepareSitePublicationRequest } from "./site-publication-requests";
import type { DatabaseLike, StatementLike } from "../types";

export interface UserRecord {
  id: string;
  email: string;
  normalized_email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  data_json: string | null;
}

const USER_RECORD_COLUMN_NAMES = [
  "id",
  "email",
  "normalized_email",
  "first_name",
  "last_name",
  "preferred_name",
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
 * recorded in `user_emails` (admin-managed aliases) -- so find-or-create
 * flows recognize a person by any known address instead of creating a
 * duplicate `users` row. Human login requires a verified, explicitly enabled alias through
 * `_lib/auth/user-session.ts`; this broader helper must never be used as an
 * authentication decision.
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
  preferredName?: string | null;
  dataJson?: string | null;
  /** Whether to merge submitted profile fields into an existing record.
   *  Default: false — public submissions do not update existing profiles. */
  allowProfileUpdate?: boolean;
  /** Set only after a signed mailbox challenge has been verified. */
  mailboxVerified?: boolean;
  /**
   * Every person holds an identity. A new account receives an individual
   * identity in the same batch, unless the caller creates an identity for
   * the person in that batch itself.
   */
  identityInBatch?: boolean;
}

export interface UserProfilePatch {
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  headshotR2Key?: string | null;
}

interface UserProfilePatchSnapshot {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  headshot_r2_key: string | null;
}

/** True only when at least one explicitly supplied profile field differs. */
export async function userProfilePatchWouldChange(
  db: DatabaseLike,
  userId: string,
  payload: UserProfilePatch,
): Promise<boolean> {
  const user = await first<UserProfilePatchSnapshot>(
    db,
    `SELECT first_name, last_name, preferred_name, headshot_r2_key
       FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) return false;
  return (
    (payload.firstName !== undefined && payload.firstName !== user.first_name) ||
    (payload.lastName !== undefined && payload.lastName !== user.last_name) ||
    (payload.preferredName !== undefined && payload.preferredName !== user.preferred_name) ||
    (payload.headshotR2Key !== undefined && payload.headshotR2Key !== user.headshot_r2_key)
  );
}

/** The request precedes the UPDATE, which stays last for callers' immediate change/audit guards. */
export function prepareUserProfileStatements(
  db: DatabaseLike,
  userId: string,
  payload: UserProfilePatch,
  now = nowIso(),
): StatementLike[] {
  const assignments: string[] = [];
  const values: Array<string | null> = [];
  const memberDifferences: string[] = [];
  const memberValues: Array<string | null> = [];
  const personNameDifferences: string[] = [];
  const personNameValues: Array<string | null> = [];

  const add = (column: string, value: string | null | undefined, onMemberPage = true): void => {
    if (value === undefined) return;
    assignments.push(`${column} = ?`);
    values.push(value);
    if (column === "first_name" || column === "last_name" || column === "preferred_name") {
      personNameDifferences.push(`person.${column} IS NOT ?`);
      personNameValues.push(value);
    }
    if (onMemberPage) {
      memberDifferences.push(`person.${column} IS NOT ?`);
      memberValues.push(value);
    }
  };
  add("first_name", payload.firstName == null ? payload.firstName : firstNameSchema.parse(payload.firstName));
  add("last_name", payload.lastName == null ? payload.lastName : lastNameSchema.parse(payload.lastName));
  add("preferred_name", payload.preferredName, false);
  if (payload.headshotR2Key !== undefined) {
    add("headshot_r2_key", payload.headshotR2Key);
    add("headshot_updated_at", payload.headshotR2Key ? now : null, false);
  }
  assignments.push("updated_at = ?");
  values.push(now);
  const groups = publicGroupProfileUserCondition(userId);
  const sources = [
    ...(memberDifferences.length
      ? [
          {
            sql: `EXISTS(SELECT 1 ${PUBLIC_MEMBER_USER_SOURCE_SQL} AND person.id=? AND (${memberDifferences.join(" OR ")}))`,
            bindings: [userId, ...memberValues],
          },
        ]
      : []),
    ...(memberDifferences.length
      ? [
          {
            sql: `EXISTS(SELECT 1 FROM users person WHERE person.id=? AND (${memberDifferences.join(" OR ")}) AND (${groups.sql}))`,
            bindings: [userId, ...memberValues, ...groups.bindings],
          },
        ]
      : []),
    ...(personNameDifferences.length
      ? [
          {
            sql: `EXISTS(SELECT 1 ${PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL} AND person.id=? AND (${personNameDifferences.join(" OR ")}))`,
            bindings: [userId, ...personNameValues],
          },
        ]
      : []),
  ];
  return [
    ...(sources.length
      ? [
          prepareSitePublicationRequest(
            db,
            {
              resourceType: "user_profile",
              resourceId: userId,
              revision: Date.parse(now),
              reasonCode: "user_profile_changed",
              deduplicationKey: `user-profile:${userId}:${crypto.randomUUID()}`,
            },
            {
              sql: sources.map((source) => source.sql).join(" OR "),
              bindings: sources.flatMap((source) => source.bindings),
            },
          ),
        ]
      : []),
    db.prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`).bind(...values, userId),
  ];
}

/**
 * Resolves what `findOrCreateUser` would do for `payload` — the resulting
 * `UserRecord` and, if a write is needed, its query + bound values — without
 * executing anything. Shared by `findOrCreateUser` (executes immediately)
 * and `buildFindOrCreateUserStatement` (returns an unexecuted statement for
 * a caller-assembled atomic `db.batch()`).
 */
interface ResolvedUserWrite {
  user: UserRecord;
  created: boolean;
  statements: StatementLike[];
}

/** Request-owned database observations, never client-supplied authority. */
export interface VerifiedUserWriteObservation {
  ownership: EmailOwnership | null;
  existing: UserRecord | null;
}

export function provedMailboxUserSelection(email: string) {
  const owner = provedMailboxUserIdSelection(email);
  return { sql: `SELECT ${userRecordColumns()} FROM users WHERE id=(${owner.sql})`, bindings: owner.bindings };
}

/** The individual identity a new account starts with: no organization, no title, not on any profile. */
export function prepareAccountIdentityStatement(db: DatabaseLike, userId: string, at: string): StatementLike {
  return db
    .prepare(
      `INSERT INTO identities (
        id, user_id, organization_id, source, show_on_organization_profile,
        invited_at, started_at, created_at, updated_at
      ) VALUES (?, ?, NULL, 'account', 0, ?, ?, ?, ?)`,
    )
    .bind(uuid(), userId, at, at, at, at);
}

/**
 * The same individual identity for an existing person who holds none — for
 * example one who only held organization identities and now takes part as an
 * individual. Inserts nothing when they already hold an active one.
 */
export function prepareIndividualIdentityStatement(
  db: DatabaseLike,
  userId: string,
  at: string,
  identityId = uuid(),
): StatementLike {
  return db
    .prepare(
      `INSERT INTO identities (
        id, user_id, organization_id, source, show_on_organization_profile,
        invited_at, started_at, created_at, updated_at
      )
      SELECT ?, ?, NULL, 'account', 0, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM identities held
          WHERE held.user_id = ? AND held.organization_id IS NULL
            AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL)`,
    )
    .bind(identityId, userId, at, at, at, at, userId);
}

async function resolveUserWrite(
  db: DatabaseLike,
  payload: FindOrCreateUserPayload,
  observed?: VerifiedUserWriteObservation,
): Promise<ResolvedUserWrite> {
  const normalized = normalizeEmail(payload.email);
  const ownership = payload.mailboxVerified
    ? observed
      ? observed.ownership
      : await readEmailOwnership(db, normalized)
    : null;
  const provedUserId = provedMailboxUserId(ownership);
  const existing =
    payload.mailboxVerified && observed
      ? observed.existing
      : payload.mailboxVerified
        ? provedUserId
          ? await first<UserRecord>(db, `SELECT ${userRecordColumns()} FROM users WHERE id=?`, [provedUserId])
          : null
        : await findExistingUserByAnyEmail(db, normalized);

  if (!existing) {
    const user: UserRecord = {
      id: uuid(),
      email: payload.email,
      normalized_email: normalized,
      first_name: payload.firstName === undefined ? null : firstNameSchema.parse(payload.firstName),
      last_name: payload.lastName === undefined ? null : lastNameSchema.parse(payload.lastName),
      preferred_name: payload.preferredName ?? null,
      data_json: payload.dataJson ?? null,
    };

    const now = nowIso();
    const insert = db
      .prepare(
        `INSERT INTO users (
        id, email, normalized_email, first_name, last_name, preferred_name,
        data_json, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        user.id,
        user.email,
        user.normalized_email,
        user.first_name,
        user.last_name,
        user.preferred_name,
        user.data_json,
        now,
        now,
      );
    return {
      user,
      created: true,
      statements: [
        ...(payload.mailboxVerified ? prepareEmailOwnershipClaim(db, normalized, user.id, ownership) : []),
        insert,
        ...(payload.identityInBatch ? [] : [prepareAccountIdentityStatement(db, user.id, now)]),
      ],
    };
  }

  // Public submissions must not overwrite existing profile data.
  if (!payload.allowProfileUpdate) {
    return {
      user: existing,
      created: false,
      statements: payload.mailboxVerified ? prepareEmailOwnershipClaim(db, normalized, existing.id, ownership) : [],
    };
  }

  const updatedFirstName =
    payload.firstName === undefined ? existing.first_name : firstNameSchema.parse(payload.firstName);
  const updatedLastName = payload.lastName === undefined ? existing.last_name : lastNameSchema.parse(payload.lastName);
  const updatedPreferredName = payload.preferredName ?? existing.preferred_name;
  const updatedDataJson = payload.dataJson ?? existing.data_json;

  const user: UserRecord = {
    ...existing,
    first_name: updatedFirstName,
    last_name: updatedLastName,
    preferred_name: updatedPreferredName,
    data_json: updatedDataJson,
  };

  const update = db
    .prepare(
      `UPDATE users
     SET first_name = ?,
         last_name = ?,
         preferred_name = ?,
         data_json = ?,
         updated_at = ?
     WHERE id = ?`,
    )
    .bind(updatedFirstName, updatedLastName, updatedPreferredName, updatedDataJson, nowIso(), existing.id);
  return { user, created: false, statements: [update] };
}

/**
 * Finds an existing user by email or creates a new one.
 *
 * SECURITY: `allowProfileUpdate` defaults to false. Public registration flows
 * (unauthenticated) must never overwrite an existing user's profile — an
 * attacker could otherwise hijack someone else's name/org by submitting a
 * registration with their email address. Set allowProfileUpdate only in
 * authenticated or staff-controlled contexts.
 */
export async function findOrCreateUser(db: DatabaseLike, payload: FindOrCreateUserPayload): Promise<UserRecord> {
  const resolved = await resolveUserWrite(db, payload);
  if (resolved.statements.length > 0) await db.batch(resolved.statements);
  return resolved.user;
}

/**
 * Same resolution as `findOrCreateUser`, but returns the unexecuted
 * statements (a new account's identity included) instead of writing immediately — lets a caller that's already
 * assembling a larger atomic `db.batch()` (for example, membership
 * provisioning or application approval)
 * fold the user write into that same transition instead of committing it
 * ahead of a batch that might still fail.
 */
export async function buildFindOrCreateUserStatement(
  db: DatabaseLike,
  payload: FindOrCreateUserPayload,
  observed?: VerifiedUserWriteObservation,
): Promise<ResolvedUserWrite> {
  return resolveUserWrite(db, payload, observed);
}

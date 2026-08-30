/**
 * Secondary email addresses on a user account. A verified address is an
 * alternate sign-in identity for the same canonical user; an unverified
 * address only reserves the namespace and supports staff reconciliation.
 */
import {
  USER_EMAILS_SORT_COLUMNS,
  type UserEmailRecord,
  type UserEmailsListQuery,
  userEmailResponseSchema,
} from "../../../assets/shared/schemas/user-emails";
import { buildPageInfo, type PageInfo } from "../../../assets/shared/schemas/pagination";
import { first } from "../db/queries";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { AppError } from "../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../types";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { authorizedUserMutationDb } from "./user-management-authorization";

interface UserEmailRow {
  id: string;
  user_id: string;
  email: string;
  created_at: string;
}

const USER_EMAIL_SORT_EXPRESSIONS: Record<(typeof USER_EMAILS_SORT_COLUMNS)[number], string> = {
  email: "LOWER(email)",
  created_at: "created_at",
};

export interface UserEmailOwner {
  userId: string;
  kind: "primary" | "secondary" | "pending";
  verified: number;
}

/** Recognizes database-boundary collisions for the shared email namespace. */
export function isEmailReservationConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("EMAIL_TAKEN") ||
    error.message.includes("UNIQUE constraint failed: users.pending_email") ||
    error.message.includes("UNIQUE constraint failed: users.normalized_email") ||
    error.message.includes("UNIQUE constraint failed: user_emails.normalized_email")
  );
}

export function emailTakenError(): AppError {
  return new AppError(409, "EMAIL_TAKEN", "This email address is already reserved by another account");
}

function toRecord(row: UserEmailRow): UserEmailRecord {
  return userEmailResponseSchema.parse({
    id: row.id,
    userId: row.user_id,
    email: row.email,
    createdAt: row.created_at,
  });
}

export async function listUserEmails(
  db: DatabaseLike,
  userId: string,
  query: UserEmailsListQuery,
): Promise<{ emails: UserEmailRecord[]; page: PageInfo }> {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["email"]) : null;
  const { rows, total } = await queryPage<UserEmailRow>(db, {
    sql: `SELECT id, user_id, email, created_at
            FROM user_emails
           WHERE user_id = ?${search ? ` AND ${search.sql}` : ""}`,
    bindings: [userId, ...(search?.bindings ?? [])],
    orderBy: resolveMappedOrderBy(query.sort, USER_EMAIL_SORT_EXPRESSIONS, "created_at ASC", "id ASC"),
    limit: query.limit,
    offset: query.offset,
  });
  const emails = rows.map(toRecord);
  return { emails, page: buildPageInfo(query.limit, query.offset, total, emails.length) };
}

/** Resolve the one account that reserves an email as primary, secondary, or pending verification. */
export async function findUserEmailOwner(db: DatabaseLike, normalizedEmail: string): Promise<UserEmailOwner | null> {
  return first<UserEmailOwner>(
    db,
    `SELECT id AS userId, 'primary' AS kind, email_verified_at IS NOT NULL AS verified
       FROM users
      WHERE normalized_email = ?
      UNION ALL
     SELECT user_id AS userId, 'secondary' AS kind, verified_at IS NOT NULL AS verified
       FROM user_emails
      WHERE normalized_email = ?
      UNION ALL
     SELECT id AS userId, 'pending' AS kind, 0 AS verified
       FROM users
      WHERE pending_email = ?
      LIMIT 1`,
    [normalizedEmail, normalizedEmail, normalizedEmail],
  );
}

export async function addUserEmail(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  userId: string,
  email: string,
): Promise<UserEmailRecord> {
  const user = await first<{ id: string; updated_at: string }>(
    db,
    "SELECT id, updated_at FROM users WHERE id = ? AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
    [userId],
  );
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const normalized = normalizeEmail(email);

  if (await findUserEmailOwner(db, normalized)) {
    throw new AppError(409, "EMAIL_TAKEN", "This email address is already reserved by a user account");
  }

  const id = uuid();
  const now = nowIso();
  try {
    const authorizedDb = authorizedUserMutationDb(db, actor, ["users:write"]);
    await authorizedDb.batch([
      authorizedDb
        .prepare(
          `INSERT INTO user_emails (id, user_id, email, normalized_email, created_at)
           SELECT ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM users
               WHERE id = ? AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL AND updated_at = ?
            )`,
        )
        .bind(id, userId, email, normalized, now, userId, user.updated_at),
      prepareAuditLogAfterOneChange(
        authorizedDb,
        "admin",
        actor.id,
        "user_email_added",
        "user",
        userId,
        { email },
        now,
      ),
    ]);
  } catch (error) {
    if (isEmailReservationConflict(error)) throw emailTakenError();
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "USER_LIFECYCLE_CHANGED", "The user changed while the secondary email was being added");
    }
    throw error;
  }

  return { id, userId, email, createdAt: now };
}

export async function removeUserEmail(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  userId: string,
  emailId: string,
): Promise<void> {
  const existing = await first<{ id: string; email: string }>(
    db,
    "SELECT id, email FROM user_emails WHERE id = ? AND user_id = ?",
    [emailId, userId],
  );
  if (!existing) throw new AppError(404, "EMAIL_NOT_FOUND", "Secondary email not found for this user");

  const now = nowIso();
  const authorizedDb = authorizedUserMutationDb(db, actor, ["users:write"]);
  try {
    await authorizedDb.batch([
      authorizedDb
        .prepare(
          `UPDATE organization_representatives
              SET email_id = NULL, updated_at = ?
            WHERE email_id = ? AND user_id = ?`,
        )
        .bind(now, emailId, userId),
      authorizedDb.prepare("DELETE FROM user_emails WHERE id = ? AND user_id = ?").bind(emailId, userId),
      prepareAuditLogAfterOneChange(
        authorizedDb,
        "admin",
        actor.id,
        "user_email_removed",
        "user",
        userId,
        { emailId, email: existing.email, representationEmailFallback: "primary" },
        now,
      ),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "EMAIL_CHANGED", "The secondary email changed while it was being removed");
    }
    throw error;
  }
}

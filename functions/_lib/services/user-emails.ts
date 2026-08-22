/**
 * Secondary email addresses on a user account -- admin/display/search
 * only, does not affect login (magic-link/passkey auth continue to
 * resolve strictly off `users.normalized_email`). These aliases let staff
 * associate roster email variations without mutating or merging identities.
 */
import {
  ADMIN_USER_EMAILS_SORT_COLUMNS,
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
import type { AuthAdmin, DatabaseLike } from "../types";
import { prepareAuditLogAfterOneChange } from "./audit";

interface UserEmailRow {
  id: string;
  user_id: string;
  email: string;
  created_at: string;
}

const USER_EMAIL_SORT_EXPRESSIONS: Record<(typeof ADMIN_USER_EMAILS_SORT_COLUMNS)[number], string> = {
  email: "LOWER(email)",
  created_at: "created_at",
};

export interface UserEmailOwner {
  userId: string;
  kind: "primary" | "secondary" | "pending";
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
    `SELECT id AS userId, 'primary' AS kind
       FROM users
      WHERE normalized_email = ?
      UNION ALL
     SELECT user_id AS userId, 'secondary' AS kind
       FROM user_emails
      WHERE normalized_email = ?
      UNION ALL
     SELECT id AS userId, 'pending' AS kind
       FROM users
      WHERE pending_email = ?
      LIMIT 1`,
    [normalizedEmail, normalizedEmail, normalizedEmail],
  );
}

export async function addUserEmail(
  db: DatabaseLike,
  actor: AuthAdmin,
  userId: string,
  email: string,
): Promise<UserEmailRecord> {
  const user = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [userId]);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const normalized = normalizeEmail(email);

  if (await findUserEmailOwner(db, normalized)) {
    throw new AppError(409, "EMAIL_TAKEN", "This email address is already reserved by a user account");
  }

  const id = uuid();
  const now = nowIso();
  await db.batch([
    db
      .prepare("INSERT INTO user_emails (id, user_id, email, normalized_email, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, userId, email, normalized, now),
    prepareAuditLogAfterOneChange(db, "admin", actor.id, "user_email_added", "user", userId, { email }, now),
  ]);

  return { id, userId, email, createdAt: now };
}

export async function removeUserEmail(
  db: DatabaseLike,
  actor: AuthAdmin,
  userId: string,
  emailId: string,
): Promise<void> {
  const existing = await first<{ id: string }>(db, "SELECT id FROM user_emails WHERE id = ? AND user_id = ?", [
    emailId,
    userId,
  ]);
  if (!existing) throw new AppError(404, "EMAIL_NOT_FOUND", "Secondary email not found for this user");

  await db.batch([
    db.prepare("DELETE FROM user_emails WHERE id = ? AND user_id = ?").bind(emailId, userId),
    prepareAuditLogAfterOneChange(db, "admin", actor.id, "user_email_removed", "user", userId, { emailId }),
  ]);
}

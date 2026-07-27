/**
 * Secondary email addresses on a user account -- admin/display/search
 * only, does not affect login (magic-link/passkey auth continue to
 * resolve strictly off `users.normalized_email`). Added to consolidate the
 * duplicate `users` rows the YAML->D1 migration created for the same
 * person under different Google-Groups-roster emails; see the user-merge
 * tool (`user-merge.ts`) for folding an existing duplicate account in.
 */
import { all, first, run } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

export interface UserEmailRecord {
  id: string;
  userId: string;
  email: string;
  createdAt: string;
}

interface UserEmailRow {
  id: string;
  user_id: string;
  email: string;
  created_at: string;
}

function toRecord(row: UserEmailRow): UserEmailRecord {
  return { id: row.id, userId: row.user_id, email: row.email, createdAt: row.created_at };
}

export async function listUserEmails(db: DatabaseLike, userId: string): Promise<UserEmailRecord[]> {
  const rows = await all<UserEmailRow>(
    db,
    "SELECT id, user_id, email, created_at FROM user_emails WHERE user_id = ? ORDER BY created_at ASC",
    [userId],
  );
  return rows.map(toRecord);
}

export async function addUserEmail(db: DatabaseLike, userId: string, email: string): Promise<UserEmailRecord> {
  const user = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [userId]);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const normalized = normalizeEmail(email);

  const ownEmail = await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ?", [normalized]);
  if (ownEmail) {
    throw new AppError(409, "EMAIL_TAKEN", "This email address already belongs to a user account");
  }
  const existingSecondary = await first<{ id: string }>(db, "SELECT id FROM user_emails WHERE normalized_email = ?", [
    normalized,
  ]);
  if (existingSecondary) {
    throw new AppError(409, "EMAIL_TAKEN", "This email address is already recorded on a user account");
  }

  const id = uuid();
  const now = nowIso();
  await run(db, "INSERT INTO user_emails (id, user_id, email, normalized_email, created_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    userId,
    email,
    normalized,
    now,
  ]);

  return { id, userId, email, createdAt: now };
}

export async function removeUserEmail(db: DatabaseLike, userId: string, emailId: string): Promise<void> {
  const result = await run(db, "DELETE FROM user_emails WHERE id = ? AND user_id = ?", [emailId, userId]);
  if (result.changes === 0) {
    throw new AppError(404, "EMAIL_NOT_FOUND", "Secondary email not found for this user");
  }
}

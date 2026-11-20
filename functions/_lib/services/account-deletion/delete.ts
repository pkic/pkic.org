import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { hmacSha256Hex } from "../../utils/crypto";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { promotionRenderFileKeys } from "../event-agenda/promotion-retention";
import { profileImageBucketName } from "../profile-image-storage";
import { prepareStorageDeletion } from "../storage-deletion-outbox";
import { authorizedUserMutationDb } from "../user-management-authorization";
import { prepareUserLifecyclePublication } from "../user-lifecycle-publication";
import { readAccountDeletion } from "./preview";
import { ACCOUNT_DELETION_DELETE_SQL, ACCOUNT_DELETION_UNBLOCKED_SQL } from "./selection";

/**
 * Versioned so a later lookup knows how a hash was made. Rotating the signing
 * secret ends matching for earlier deletions; the version does not change that.
 */
const EMAIL_HASH_VERSION = 1;

/** Keyed hash of an address, so a deletion can be confirmed later without keeping the address. */
export function accountDeletionEmailHash(secret: string, normalizedEmail: string): Promise<string> {
  return hmacSha256Hex(secret, `account-deletion-email:v${EMAIL_HASH_VERSION}:${normalizedEmail}`);
}

function isForeignKeyFailure(error: unknown): boolean {
  return error instanceof Error && /FOREIGN KEY constraint failed|EVENT_EVIDENCE_CAPTURE_CLOSED/.test(error.message);
}

/**
 * Deletes the account and everything its preview listed, in one D1 batch.
 * Refused unless staff confirmed the current preview and nothing keeps the
 * account; the batch checks both again, and the database's foreign keys
 * refuse a delete that would leave a reference behind.
 */
export async function deleteAccount(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  userId: string,
  revision: string,
  secret: string,
) {
  if (userId === actor.id) throw new AppError(403, "FORBIDDEN", "You cannot delete your own account");
  const { account, addresses, renders, preview } = await readAccountDeletion(db, userId);
  if (preview.revision !== revision) {
    throw new AppError(409, "ACCOUNT_CHANGED", "The account changed since you reviewed it. Review it again.");
  }
  if (!preview.deletable) throw new AppError(409, "ACCOUNT_IN_USE", "Records still keep this account");

  const at = nowIso();
  const emailHashes = await Promise.all(addresses.map((address) => accountDeletionEmailHash(secret, address)));
  const authorizedDb = authorizedUserMutationDb(db, actor, ["users:delete"]);
  const storageDeletions = [
    prepareStorageDeletion(authorizedDb, account.headshot_r2_key, at, profileImageBucketName(account.headshot_r2_key)),
    ...renders.flatMap(promotionRenderFileKeys).map((key) => prepareStorageDeletion(authorizedDb, key, at, "assets")),
  ].filter((statement): statement is StatementLike => statement !== null);
  const statements: StatementLike[] = [
    prepareUserLifecyclePublication(authorizedDb, account.id, at, "anonymize"),
    authorizedDb
      .prepare(
        `UPDATE users SET updated_at = updated_at
          WHERE id = ?1 AND updated_at = ?2 AND pii_redacted_at IS NULL
            AND ${ACCOUNT_DELETION_UNBLOCKED_SQL}`,
      )
      .bind(account.id, account.updated_at),
    prepareAuditLogAfterOneChange(authorizedDb, "admin", actor.id, "user_deleted", "user", account.id, {
      emailHashes,
      emailHashVersion: EMAIL_HASH_VERSION,
      removed: preview.removes,
    }),
    ...storageDeletions,
    ...ACCOUNT_DELETION_DELETE_SQL.map((sql) => authorizedDb.prepare(sql).bind(account.id)),
    authorizedDb.prepare("DELETE FROM users WHERE id = ?1").bind(account.id),
  ];
  try {
    await authorizedDb.batch(statements);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "ACCOUNT_CHANGED", "The account changed since you reviewed it. Review it again.");
    }
    if (isForeignKeyFailure(error)) throw new AppError(409, "ACCOUNT_IN_USE", "Records still keep this account");
    throw error;
  }
  return { userId: account.id };
}

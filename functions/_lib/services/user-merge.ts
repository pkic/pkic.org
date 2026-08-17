/**
 * Merges a duplicate user account into a survivor account. Built to
 * consolidate the duplicate `users` rows the YAML->D1 migration created for
 * the same real person under different Google-Groups-roster emails
 * -- and to give staff a way to fix any future
 * duplicate the same way.
 *
 * Reuses the `users.merged_into_user_id` column and the
 * anonymize-with-sentinel-email pattern already established by
 * `registrations/change-email.ts`'s `finalizeEmailChange` for a different
 * collision scenario -- same idea (tag the loser, keep the row so history
 * stays resolvable, don't hard-delete), applied here to an admin-initiated
 * merge instead of an end-user email-change collision.
 *
 * Deliberately reassigned: working_group_members, members (the org-less
 * individual membership row), organization_representatives, user_roles
 * (also covers representative-role grants: primary/secondary contact,
 * voting delegate), permission_grants, passkey_credentials. Deliberately
 * NOT reassigned:
 * registrations, donations, speaker_proposals, audit_log, email_outbox,
 * sessions/refresh_tokens, member_applications.assigned_to_user_id,
 * ec_decisions, vote_ballots/vote_candidates -- these keep pointing at the
 * source account's (now-anonymized-but-not-deleted) id, resolvable via
 * merged_into_user_id, matching finalizeEmailChange's own precedent of
 * only reassigning what its feature actually needed.
 */
import { first } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";

export interface UserMergeResult {
  survivorId: string;
  mergedFromUserId: string;
  mergedFromEmail: string;
}

export async function mergeUsers(
  db: DatabaseLike,
  params: { survivorId: string; sourceUserId: string },
): Promise<UserMergeResult> {
  const { survivorId, sourceUserId } = params;

  if (survivorId === sourceUserId) {
    throw new AppError(400, "SAME_USER", "Cannot merge a user account into itself");
  }

  const survivor = await first<{ id: string; merged_into_user_id: string | null }>(
    db,
    "SELECT id, merged_into_user_id FROM users WHERE id = ?",
    [survivorId],
  );
  if (!survivor) {
    throw new AppError(404, "USER_NOT_FOUND", "Survivor user not found");
  }
  if (survivor.merged_into_user_id !== null) {
    throw new AppError(
      409,
      "ALREADY_MERGED",
      "This account was itself already merged into another -- pick the root account instead",
    );
  }

  const source = await first<{
    id: string;
    email: string;
    normalized_email: string;
    merged_into_user_id: string | null;
  }>(db, "SELECT id, email, normalized_email, merged_into_user_id FROM users WHERE id = ?", [sourceUserId]);
  if (!source) {
    throw new AppError(404, "USER_NOT_FOUND", "Source user not found");
  }
  if (source.merged_into_user_id !== null) {
    throw new AppError(409, "ALREADY_MERGED", "The source account was already merged into another user");
  }

  // members holds UNIQUE(user_id) -- if both accounts hold a membership,
  // the merge can't silently pick a winner; surface it instead of guessing.
  const survivorMembership = await first<{ id: string }>(db, "SELECT id FROM members WHERE user_id = ?", [survivorId]);
  const sourceMembership = await first<{ id: string }>(db, "SELECT id FROM members WHERE user_id = ?", [sourceUserId]);
  if (survivorMembership && sourceMembership) {
    throw new AppError(409, "BOTH_HOLD_MEMBERSHIP", "Both accounts hold a membership -- remove one before merging");
  }

  const now = nowIso();
  const stmts: StatementLike[] = [];

  // 1. working_group_members: repoint the source's active rows to the
  //    survivor, unless the survivor already has an active row for that
  //    same working group (leave the source's row as harmless history).
  stmts.push(
    db
      .prepare(
        `UPDATE working_group_members
            SET user_id = ?
          WHERE user_id = ?
            AND left_at IS NULL
            AND working_group_id NOT IN (
              SELECT working_group_id FROM working_group_members WHERE user_id = ? AND left_at IS NULL
            )`,
      )
      .bind(survivorId, sourceUserId, survivorId),
  );

  // 2. members: only the source holds one (both-held case already rejected above).
  if (sourceMembership && !survivorMembership) {
    stmts.push(db.prepare(`UPDATE members SET user_id = ? WHERE user_id = ?`).bind(survivorId, sourceUserId));
  }

  // 2b. organization_representatives: repoint the source's active rows to
  //     the survivor, same "skip if survivor already actively represents
  //     that same organization" rule as working_group_members above —
  //     uq_organization_representatives_active_pair would reject a plain
  //     repoint into an existing active (member_id, survivorId) pair. A
  //     skipped row is not left dangling on the (about to be disabled)
  //     source account: it's closed (left_at set), matching what actually
  //     leaving that organization looks like everywhere else.
  stmts.push(
    db
      .prepare(
        `UPDATE organization_representatives
            SET left_at = ?, updated_at = ?
          WHERE user_id = ?
            AND left_at IS NULL
            AND member_id IN (
              SELECT member_id FROM organization_representatives WHERE user_id = ? AND left_at IS NULL
            )`,
      )
      .bind(now, now, sourceUserId, survivorId),
  );
  stmts.push(
    db
      .prepare(
        `UPDATE organization_representatives
            SET user_id = ?, updated_at = ?
          WHERE user_id = ?
            AND left_at IS NULL
            AND member_id NOT IN (
              SELECT member_id FROM organization_representatives WHERE user_id = ? AND left_at IS NULL
            )`,
      )
      .bind(survivorId, now, sourceUserId, survivorId),
  );

  // 3. user_roles: revoke the source's active singleton-role grants
  //    (uq_user_roles_single_holder_per_context, migration 0038) that would
  //    otherwise collide with a grant the survivor already actively holds
  //    for the same (context_type, context_id, role_id) — e.g. both users
  //    are representatives of the same organization and both separately
  //    hold role-primary_contact for it. Left un-revoked, the unconditional
  //    repoint below would attempt two active grants of the same singleton
  //    role in the same context and violate the unique index, failing the
  //    whole merge. Non-conflicting grants (including this same source row
  //    once revoked here) still repoint unconditionally afterward, same as
  //    permission_grants/passkey_credentials, so merge history stays
  //    resolvable through merged_into_user_id either way.
  stmts.push(
    db
      .prepare(
        `UPDATE user_roles SET revoked_at = ?
          WHERE user_id = ? AND revoked_at IS NULL AND single_holder_per_context = 1
            AND EXISTS (
              SELECT 1 FROM user_roles ur2
              WHERE ur2.user_id = ? AND ur2.revoked_at IS NULL
                AND ur2.context_type = user_roles.context_type
                AND ur2.context_id = user_roles.context_id
                AND ur2.role_id = user_roles.role_id
            )`,
      )
      .bind(now, sourceUserId, survivorId),
  );

  // 3b. user_roles / permission_grants / passkey_credentials: no other
  //     uniqueness constraints -- repoint unconditionally. Runs after 3a in
  //     the same batch, so the just-revoked conflicting grants (no longer
  //     active) repoint safely too, as inactive history.
  stmts.push(db.prepare(`UPDATE user_roles SET user_id = ? WHERE user_id = ?`).bind(survivorId, sourceUserId));
  stmts.push(db.prepare(`UPDATE permission_grants SET user_id = ? WHERE user_id = ?`).bind(survivorId, sourceUserId));
  stmts.push(db.prepare(`UPDATE passkey_credentials SET user_id = ? WHERE user_id = ?`).bind(survivorId, sourceUserId));

  // 4. Record the source's original email as a secondary email on the
  //    survivor -- unless it's already recorded as someone's secondary
  //    email (normalized_email is globally unique), in which case leave
  //    that pre-existing row alone rather than fail the whole merge on it.
  const alreadyRecorded = await first<{ id: string }>(db, "SELECT id FROM user_emails WHERE normalized_email = ?", [
    source.normalized_email,
  ]);
  if (!alreadyRecorded) {
    stmts.push(
      db
        .prepare(`INSERT INTO user_emails (id, user_id, email, normalized_email, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(uuid(), survivorId, source.email, source.normalized_email, now),
    );
  }

  // 5. Anonymize the source account, same sentinel pattern as finalizeEmailChange.
  const sentinel = `merged-${sourceUserId}@deleted.invalid`;
  stmts.push(
    db
      .prepare(
        `UPDATE users
            SET email = ?, normalized_email = ?, merged_into_user_id = ?, active = 0, updated_at = ?
          WHERE id = ?`,
      )
      .bind(sentinel, normalizeEmail(sentinel), survivorId, now, sourceUserId),
  );

  await db.batch(stmts);

  return { survivorId, mergedFromUserId: sourceUserId, mergedFromEmail: source.email };
}

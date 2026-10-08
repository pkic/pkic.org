import type { z } from "zod";
import type { eventProposalProofPersonPatchSchema } from "../../../assets/shared/schemas/event-proposal-proof";
import { parseLinksJson } from "../../../assets/shared/schemas/links";
import type { AuthenticatedIdentity } from "../auth/user-session";
import { first } from "../db/queries";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { prepareUserProfileStatement, userRecordColumns, type UserRecord } from "./users";
import { prepareEventProposalPersonOwner } from "./event-proposal-proof-owner";

/** Edits one known canonical person's names without redeeming the proposal continuation. */
export async function updateEventProposalProofPerson(
  db: DatabaseLike,
  input: {
    eventId: string;
    signingSecret: string;
    body: z.infer<typeof eventProposalProofPersonPatchSchema>;
    actor?: Pick<AuthenticatedIdentity, "userId" | "sessionId">;
  },
) {
  const at = nowIso();
  const { userId, guards, proofEmail } = await prepareEventProposalPersonOwner(db, {
    ...input,
    ...input.body,
    at,
  });
  const user = await first<UserRecord>(
    db,
    `SELECT ${userRecordColumns()} FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL`,
    [userId],
  );
  if (!user) throw new AppError(403, "PROPOSAL_PERSON_UNAVAILABLE", "Your personal details are unavailable.");
  const names = { firstName: input.body.firstName, lastName: input.body.lastName };
  try {
    await db.batch([
      ...guards,
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL AND first_name IS ? AND last_name IS ?",
        bindings: [user.id, user.first_name, user.last_name],
      }),
      prepareUserProfileStatement(db, user.id, names),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "user", id: user.id },
        "user",
        user.id,
        "user_profile_updated",
        "user",
        user.id,
        {
          eventId: input.eventId,
          firstName: { from: user.first_name, to: names.firstName ?? user.first_name },
          lastName: { from: user.last_name, to: names.lastName ?? user.last_name },
        },
        at,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error) || isAuditChangeGuardFailure(error))
      throw new AppError(409, "PROPOSAL_PERSON_CHANGED", "Your account or confirmation changed. Reload before saving.");
    throw error;
  }
  const saved = await first<UserRecord>(db, `SELECT ${userRecordColumns()} FROM users WHERE id=?`, [user.id]);
  if (!saved) throw new Error("Saved proposal person is unavailable");
  return {
    person: {
      email: proofEmail ?? saved.normalized_email,
      firstName: saved.first_name,
      lastName: saved.last_name,
      organizationName: null,
      jobTitle: null,
      bio: saved.biography,
      links: parseLinksJson(saved.links_json),
    },
  };
}

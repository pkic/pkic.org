import type { DatabaseLike, StatementLike } from "../../types";
import { prepareOrganizationIdentityPublication } from "./lifecycle-publication";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { prepareIdentityActivationNotification, prepareCancelIdentityInvitationEmails } from "./notifications";

/** One pending-to-active write plan for acceptance and authorized staff overrides. */
export function preparePendingIdentityActivation(
  db: DatabaseLike,
  input: {
    identityId: string;
    userId: string;
    at: string;
    expectedUpdatedAt?: string;
    audit: StatementLike[];
  },
): StatementLike[] {
  return [
    db
      .prepare(`UPDATE identities SET started_at=?,updated_at=? WHERE id=? AND user_id=?
      AND started_at IS NULL AND ended_at IS NULL AND blocked_at IS NULL
      AND (? IS NULL OR updated_at=?)`)
      .bind(
        input.at,
        input.at,
        input.identityId,
        input.userId,
        input.expectedUpdatedAt ?? null,
        input.expectedUpdatedAt ?? null,
      ),
    ...input.audit,
    prepareOrganizationIdentityPublication(db, input.identityId, input.at),
    prepareCancelIdentityInvitationEmails(db, input.identityId, input.at),
    prepareIdentityActivationNotification(db, input),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, input.at),
  ];
}

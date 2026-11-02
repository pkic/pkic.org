/** One guarded command: mailbox proof authorizes only its current canonical owner. */
import type { z } from "zod";
import type {
  registrationProofPersonPatchSchema,
  registrationProvedPersonSchema,
} from "../../../../assets/shared/schemas/registration-email-proof";
import type { DatabaseLike } from "../../types";
import { registrationProofOwner, readRegistrationEmailProof } from "./email-proof";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { prepareUserProfileStatements } from "../users";
import { prepareScopedAuditLogAfterOneChange, isAuditChangeGuardFailure } from "../audit";
import { prepareBadgeRenderJobsForUser } from "../badge-render-job-statements";
import { batchFirst } from "../../db/pagination";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";

export async function updateRegistrationProofPerson(
  db: DatabaseLike,
  input: {
    eventSlug: string;
    signingSecret: string;
    body: z.infer<typeof registrationProofPersonPatchSchema>;
  },
) {
  const proof = await readRegistrationEmailProof(input.signingSecret, input.body.token);
  const owner = registrationProofOwner(proof);
  const names = { firstName: input.body.firstName, lastName: input.body.lastName };
  const at = nowIso();
  try {
    const results = await db.batch([
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM users person JOIN events event ON event.id=? AND event.slug=?
          WHERE person.id=? AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
            AND person.id=(${owner.sql})`,
        bindings: [proof.eventId, input.eventSlug, input.body.userId, ...owner.bindings],
      }),
      ...prepareUserProfileStatements(db, input.body.userId, names, at),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "user", id: input.body.userId },
        "user",
        input.body.userId,
        "user_profile_updated",
        "user",
        input.body.userId,
        {
          eventId: proof.eventId,
          fields: Object.keys(names).filter((key) => names[key as keyof typeof names] !== undefined),
        },
        at,
      ),
      prepareBadgeRenderJobsForUser(db, input.body.userId, at),
      db
        .prepare("SELECT id AS userId,first_name AS firstName,last_name AS lastName FROM users WHERE id=?")
        .bind(input.body.userId),
    ]);
    const person = batchFirst<z.infer<typeof registrationProvedPersonSchema>>(results.at(-1)!);
    if (!person) throw new Error("Saved registration person is unavailable");
    return { person };
  } catch (error) {
    if (isAuthorizationGuardFailure(error) || isAuditChangeGuardFailure(error))
      throw new AppError(
        403,
        "REGISTRATION_PERSON_MISMATCH",
        "Verify your own email address before editing your details.",
      );
    throw error;
  }
}

/** Change only a representation's address; its organization and access remain intact. */
import type { z } from "zod";
import type { representationEmailChangeSchema } from "../../../../assets/shared/schemas/representation-email";
import type { OwnEmailAddressesListQuery } from "../../../../assets/shared/schemas/own-email-addresses";
import { prepareRepresentationAuthority } from "./representation-authority";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { prepareOwnEmailAddressesList } from "../own-email-addresses";
import { prepareIdentityEmailOwnershipStatements } from "./email-ownership";
import { prepareAuditLogAfterOneChange } from "../audit";
import { prepareBadgeRenderJobsForUser } from "../badge-render-job-statements";
import { prepareOrganizationIdentityPublication } from "./lifecycle-publication";
import type { DatabaseLike, Env } from "../../types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { representationEmailDomainEvidence } from "./email-domain-support";

function sourceEvidence(userId: string, identityId: string) {
  return {
    sql: "SELECT 1 FROM identities WHERE id=? AND user_id=? AND organization_id IS NOT NULL AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL",
    bindings: [identityId, userId],
  };
}
export async function readRepresentationEmailOptions(
  db: DatabaseLike,
  request: Request,
  env: Env,
  userId: string,
  identityId: string,
  query: OwnEmailAddressesListQuery,
) {
  const actor = await prepareRepresentationAuthority(db, request, env, userId, [{ permission: "users:read" }]);
  const read = prepareOwnEmailAddressesList(db, userId, query, identityId);
  try {
    const loaded = await db.batch([
      ...actor.statements,
      ...actor.evidence.map((e) => prepareAuthorizationGuard(db, e)),
      prepareAuthorizationGuard(db, sourceEvidence(userId, identityId)),
      db.prepare("SELECT email_id FROM identities WHERE id=? AND user_id=?").bind(identityId, userId),
      ...read.statements,
    ]);
    await actor.decode(loaded.slice(0, actor.statements.length));
    const selectionIndex = actor.statements.length + actor.evidence.length + 1;
    const row = loaded[selectionIndex]!.results?.[0] as { email_id: string | null };
    return { emailId: row.email_id, ...read.decode(loaded.slice(selectionIndex + 1)) };
  } catch (cause) {
    refuse(cause);
  }
}
export async function changeRepresentationEmail(
  db: DatabaseLike,
  request: Request,
  env: Env,
  userId: string,
  identityId: string,
  input: z.infer<typeof representationEmailChangeSchema>,
) {
  const actor = await prepareRepresentationAuthority(db, request, env, userId, [{ permission: "membership:write" }]);
  const at = nowIso();
  try {
    const loaded = await db.batch([
      ...actor.statements,
      ...actor.evidence.map((e) => prepareAuthorizationGuard(db, e)),
      prepareAuthorizationGuard(db, sourceEvidence(userId, identityId)),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM identities WHERE id=? AND email_id IS ?",
        bindings: [identityId, input.previousEmailId],
      }),
      prepareAuthorizationGuard(db, representationEmailDomainEvidence(identityId, input.emailId)),
      prepareAuthorizationGuard(
        db,
        input.emailId === null
          ? {
              sql: "SELECT 1 FROM users WHERE id=? AND active=1 AND email_verified_at IS NOT NULL AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
              bindings: [userId],
            }
          : {
              sql: "SELECT 1 FROM user_emails WHERE id=? AND user_id=? AND verified_at IS NOT NULL AND (identity_id IS NULL OR identity_id=?)",
              bindings: [input.emailId, userId, identityId],
            },
      ),
      prepareOrganizationIdentityPublication(db, identityId, at),
      db
        .prepare("UPDATE identities SET email_id=?,updated_at=? WHERE id=? AND user_id=? AND email_id IS ?")
        .bind(input.emailId, at, identityId, userId, input.previousEmailId),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        actor.actorId,
        "organization_identity_email_changed",
        "identity",
        identityId,
        { emailId: { from: input.previousEmailId, to: input.emailId } },
        at,
      ),
      ...prepareIdentityEmailOwnershipStatements(db, {
        userId,
        identityId,
        emailId: input.emailId,
        previousEmailId: input.previousEmailId,
      }),
      prepareBadgeRenderJobsForUser(db, userId, at),
    ]);
    await actor.decode(loaded.slice(0, actor.statements.length));
    return { success: true as const };
  } catch (cause) {
    refuse(cause);
  }
}
function refuse(cause: unknown): never {
  if (isAuthorizationGuardFailure(cause))
    throw new AppError(
      409,
      "REPRESENTATION_EMAIL_UNAVAILABLE",
      "Choose an available verified address that supports this organization, or refresh and try again.",
    );
  throw cause;
}

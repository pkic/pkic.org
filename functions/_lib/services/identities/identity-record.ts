/**
 * One identity as staff read and edit it: its profile — the job title,
 * biography and links every record made as the identity shows — beside its
 * place on the public profile. Staff edit the profile through the owner's own
 * contract and the same profile writes, so the identity has one edit rule
 * whoever changes it.
 */
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import type { IdentityRecord } from "../../../../assets/shared/schemas/identity-public-profile";
import type { IdentityProfileUpdate } from "../../../../assets/shared/schemas/own-identity-profile";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { authorizedMembershipMutationDb } from "../membership-authorization";
import { identityJobTitleSql } from "./affiliation-projection";
import { prepareIdentityProfileEdit, type EditableIdentityProfile } from "./profile-statement";
import { readIdentityPublicProfile } from "./public-profile-visibility";

export async function readIdentityRecord(db: DatabaseLike, identityId: string): Promise<IdentityRecord> {
  const visibility = await readIdentityPublicProfile(db, identityId);
  const profile = await first<{
    organization_id: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
  }>(
    db,
    `SELECT identity.organization_id, ${identityJobTitleSql("identity.id")} AS job_title,
            identity.biography, identity.links_json
       FROM identities identity WHERE identity.id = ?`,
    [identityId],
  );
  if (!profile) throw new AppError(404, "NOT_FOUND", "Identity not found");
  return {
    ...visibility,
    organizationId: profile.organization_id,
    jobTitle: profile.job_title,
    biography: profile.biography,
    links: parseLinksJson(profile.links_json),
  };
}

/** Staff edit of an active identity's profile; ended and blocked identities are records of the past. */
export async function updateIdentityProfileByStaff(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  identityId: string,
  input: IdentityProfileUpdate,
): Promise<void> {
  const current = await first<EditableIdentityProfile & { inactive: number }>(
    db,
    `SELECT identity.id, identity.user_id, identity.organization_id, identity.email_id, identity.job_title,
            identity.biography, identity.links_json, identity.show_on_organization_profile, identity.updated_at,
            title.job_title AS individual_job_title,
            (identity.ended_at IS NOT NULL OR identity.blocked_at IS NOT NULL) AS inactive
       FROM identities identity
       JOIN users person ON person.id = identity.user_id
       LEFT JOIN individual_job_titles title ON title.user_id = identity.user_id
      WHERE identity.id = ? AND identity.started_at IS NOT NULL
        AND person.merged_into_user_id IS NULL AND person.pii_redacted_at IS NULL`,
    [identityId],
  );
  if (!current) throw new AppError(404, "NOT_FOUND", "Identity not found");
  if (current.inactive) throw new AppError(409, "IDENTITY_INACTIVE", "An ended or blocked identity cannot be edited");
  const at = nowIso();
  const authorizedDb = authorizedMembershipMutationDb(db, actor, ["membership:write"]);
  const edit = prepareIdentityProfileEdit(authorizedDb, current, input, at);
  try {
    await authorizedDb.batch([
      ...(edit.publication ? [edit.publication] : []),
      edit.update,
      // Every record made as the identity shows the edit, so the audit keeps what it showed before.
      prepareAuditLogAfterOneChange(
        authorizedDb,
        "admin",
        actor.id,
        "identity_profile_updated",
        "identity",
        current.id,
        { userId: current.user_id, ...edit.changes },
        at,
      ),
      ...(edit.individualJobTitle ? [edit.individualJobTitle] : []),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_CHANGED", "The identity changed before the edit was saved");
    }
    throw error;
  }
}

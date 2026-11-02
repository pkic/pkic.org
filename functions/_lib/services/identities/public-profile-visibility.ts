/**
 * Staff withholding an identity from its person's public profile, or showing
 * it again. Identities are not hidden in principle, so this is never the
 * person's own choice; each change is one guarded write with its audit row.
 */
import { PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL } from "../people/profile-publication-sql";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import type { IdentityPublicProfile } from "../../../../assets/shared/schemas/identity-public-profile";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { authorizedMembershipMutationDb } from "../membership-authorization";
import { personDisplayNameSql } from "../people/person-name-sql";

interface IdentityRow {
  id: string;
  user_id: string;
  person_name: string;
  organization_name: string | null;
  ended_at: string | null;
  hidden_from_public_profile: number;
  updated_at: string;
}

async function readIdentity(db: DatabaseLike, identityId: string) {
  const row = await first<IdentityRow>(
    db,
    `SELECT identity.id, identity.user_id, ${personDisplayNameSql("person", "Member")} AS person_name,
            organization.name AS organization_name, identity.ended_at, identity.hidden_from_public_profile,
            identity.updated_at
       FROM identities identity
       JOIN users person ON person.id = identity.user_id
       LEFT JOIN organizations organization ON organization.id = identity.organization_id
      WHERE identity.id = ? AND identity.started_at IS NOT NULL
        AND person.merged_into_user_id IS NULL AND person.pii_redacted_at IS NULL`,
    [identityId],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "Identity not found");
  return row;
}

function present(row: IdentityRow): IdentityPublicProfile {
  return {
    identityId: row.id,
    userId: row.user_id,
    personName: row.person_name,
    organizationName: row.organization_name,
    endedAt: row.ended_at,
    hiddenFromPublicProfile: row.hidden_from_public_profile === 1,
  };
}

export async function readIdentityPublicProfile(db: DatabaseLike, identityId: string): Promise<IdentityPublicProfile> {
  return present(await readIdentity(db, identityId));
}

/** Hide the identity from the public profile, or show it again. Saving the state it already has changes nothing. */
export async function setIdentityPublicProfileHidden(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  identityId: string,
  hidden: boolean,
): Promise<IdentityPublicProfile> {
  const current = await readIdentity(db, identityId);
  if ((current.hidden_from_public_profile === 1) === hidden) return present(current);
  const at = nowIso();
  const authorizedDb = authorizedMembershipMutationDb(db, actor, ["membership:write"]);
  try {
    await authorizedDb.batch([
      authorizedDb
        .prepare("UPDATE identities SET hidden_from_public_profile = ?, updated_at = ? WHERE id = ? AND updated_at = ?")
        .bind(hidden ? 1 : 0, at, current.id, current.updated_at),
      prepareAuditLogAfterOneChange(
        authorizedDb,
        "admin",
        actor.id,
        hidden ? "identity_public_profile_hidden" : "identity_public_profile_shown",
        "identity",
        current.id,
        { userId: current.user_id, hiddenFromPublicProfile: { from: !hidden, to: hidden } },
        at,
      ),
      prepareSitePublicationRequest(
        authorizedDb,
        {
          resourceType: "identity_profile",
          resourceId: current.id,
          revision: Date.parse(at),
          reasonCode: "identity_profile_changed",
          deduplicationKey: `person-identity-visibility:${current.id}:${crypto.randomUUID()}`,
        },
        {
          sql: `EXISTS(SELECT 1 ${PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL}
            AND EXISTS(SELECT 1 FROM identities identity WHERE identity.user_id=person.id
              AND identity.id=? AND identity.started_at IS NOT NULL AND identity.blocked_at IS NULL))`,
          bindings: [current.id],
        },
      ),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_CHANGED", "The identity changed before the change was saved");
    }
    throw error;
  }
  return readIdentityPublicProfile(db, identityId);
}

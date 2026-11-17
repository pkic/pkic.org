import { organizationJobTitleMissing } from "../../../../assets/shared/schemas/identity-job-title";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { persistedUtcInstant } from "../../utils/time";
import type { UserRecord } from "../users";
import { prepareIdentityProfileEdit } from "../identities/profile-statement";
import { prepareAuditLogAfterOneChange } from "../audit";
import { ownedIdentityEmailEvidence, resolveOwnedIdentityEmail } from "../identities/owned-email";

/** Reuses an approved canonical affiliation under the caller's existing provisioning authority. */
export async function prepareExistingOrganizationAffiliation(
  db: DatabaseLike,
  user: UserRecord,
  organizationId: string,
  email: string,
  listing: { at: string; actorUserId: string | null; jobTitle?: string | null },
): Promise<{
  identityId: string;
  createdAt: string;
  statement: StatementLike;
  profileStatements: StatementLike[];
} | null> {
  const identity = await first<{
    id: string;
    email_id: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
    source: string;
    show_on_organization_profile: number;
    organization_profile_listing_approved: number | null;
    invited_at: string;
    started_at: string;
    created_at: string;
    updated_at: string;
  }>(
    db,
    `SELECT id,email_id,job_title,biography,links_json,source,show_on_organization_profile,organization_profile_listing_approved,
                 invited_at,started_at,created_at,updated_at FROM identities
            WHERE user_id=? AND organization_id=? AND started_at IS NOT NULL
              AND ended_at IS NULL AND blocked_at IS NULL LIMIT 1`,
    [user.id, organizationId],
  );
  if (!identity) return null;
  const selectedAddress = await resolveOwnedIdentityEmail(db, { user, email });
  const address = ownedIdentityEmailEvidence({ userId: user.id, ...selectedAddress });
  const profileStatements: StatementLike[] = [];
  const titleContext = { organization: true, jobTitle: identity.job_title };
  const jobTitle = organizationJobTitleMissing(titleContext, undefined) ? (listing.jobTitle ?? undefined) : undefined;
  // An unset decision is a self-join default, unlike an explicit owner/contact hide.
  if (
    identity.organization_profile_listing_approved === null &&
    identity.show_on_organization_profile === 0 &&
    !organizationJobTitleMissing(titleContext, jobTitle)
  ) {
    const edit = prepareIdentityProfileEdit(
      db,
      {
        ...identity,
        user_id: user.id,
        organization_id: organizationId,
        individual_job_title: null,
      },
      {
        showOnOrganizationProfile: true,
        jobTitle,
      },
      listing.at,
    );
    if (edit.publication) profileStatements.push(edit.publication);
    profileStatements.push(
      edit.update,
      prepareAuditLogAfterOneChange(
        db,
        listing.actorUserId ? "admin" : "system",
        listing.actorUserId,
        "identity_profile_updated",
        "identity",
        identity.id,
        { ...edit.changes, reason: "Named representative provisioning" },
        listing.at,
      ),
    );
  }
  return {
    identityId: identity.id,
    createdAt: persistedUtcInstant(identity.created_at),
    profileStatements,
    statement: prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM identities identity JOIN users person ON person.id=identity.user_id AND person.active=1
             WHERE identity.id=? AND identity.user_id=? AND identity.organization_id=?
               AND identity.email_id IS ? AND identity.job_title IS ? AND identity.biography IS ?
               AND identity.links_json IS ? AND identity.source=? AND identity.show_on_organization_profile=?
               AND identity.organization_profile_listing_approved IS ?
               AND identity.invited_at=? AND identity.started_at=? AND identity.created_at=? AND identity.updated_at=?
               AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
               AND person.email=? AND person.first_name IS ? AND person.last_name IS ?
               AND EXISTS (${address.sql})`,
      bindings: [
        identity.id,
        user.id,
        organizationId,
        identity.email_id,
        identity.job_title,
        identity.biography,
        identity.links_json,
        identity.source,
        identity.show_on_organization_profile,
        identity.organization_profile_listing_approved,
        identity.invited_at,
        identity.started_at,
        identity.created_at,
        identity.updated_at,
        user.email,
        user.first_name,
        user.last_name,
        ...address.bindings,
      ],
    }),
  };
}

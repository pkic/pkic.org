import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { agendaSpeakerOrganizationSchema, type AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { agendaCreditedIdentityIds } from "../../../../assets/shared/agenda-speaker-organizations";
import { organizationLogoUrl } from "../organization-content/fields";

const BATCH = 100;

/**
 * The organization each credited acting identity represents, with the organization's existing
 * public logo (`/api/v1/members/:organizationId/logo`, the R2 object the member migration and
 * organization profile maintain). Branding is projected live; a credit's frozen text is untouched.
 */
export async function readAgendaSpeakerOrganizations(
  db: DatabaseLike,
  identityIds: readonly string[],
): Promise<NonNullable<AgendaSnapshot["speakerOrganizations"]>> {
  const organizations: NonNullable<AgendaSnapshot["speakerOrganizations"]> = {};
  for (let offset = 0; offset < identityIds.length; offset += BATCH) {
    const rows = await all<{ identity_id: string; organization_id: string; name: string; logo_r2_key: string | null }>(
      db,
      `SELECT identity.id AS identity_id,organization.id AS organization_id,organization.name,organization.logo_r2_key
        FROM identities identity JOIN organizations organization ON organization.id=identity.organization_id
        WHERE identity.id IN (SELECT value FROM json_each(?)) ORDER BY identity.id LIMIT ${BATCH}`,
      [JSON.stringify(identityIds.slice(offset, offset + BATCH))],
    );
    for (const row of rows) {
      const parsed = agendaSpeakerOrganizationSchema.safeParse({
        name: row.name,
        logoUrl: organizationLogoUrl(row.organization_id, row.logo_r2_key),
      });
      if (parsed.success) organizations[row.identity_id] = parsed.data;
    }
  }
  return organizations;
}

/** Attach the live organizations of every credit the snapshot carries (drafts included for organizers). */
export async function withAgendaSpeakerOrganizations<T extends AgendaSnapshot>(
  db: DatabaseLike,
  snapshot: T,
): Promise<T> {
  return {
    ...snapshot,
    speakerOrganizations: await readAgendaSpeakerOrganizations(db, agendaCreditedIdentityIds(snapshot.occurrences)),
  };
}

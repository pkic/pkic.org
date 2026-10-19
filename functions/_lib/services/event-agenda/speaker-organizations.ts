import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { agendaSpeakerOrganizationSchema, type AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { agendaCreditedOrganizationIds } from "../../../../assets/shared/agenda-speaker-affiliations";
import { organizationLogoUrl } from "../organization-content/fields";

const BATCH = 100;

/**
 * Each credited organization with its existing public logo (`/api/v1/members/:organizationId/logo`,
 * the R2 object the member migration and organization profile maintain). Branding is projected
 * live by organization; a credit's frozen title and organization name are untouched.
 */
export async function readAgendaSpeakerOrganizations(
  db: DatabaseLike,
  organizationIds: readonly string[],
): Promise<NonNullable<AgendaSnapshot["speakerOrganizations"]>> {
  const organizations: NonNullable<AgendaSnapshot["speakerOrganizations"]> = {};
  for (let offset = 0; offset < organizationIds.length; offset += BATCH) {
    // A credit naming a merged organization shows the organization it was merged into.
    const rows = await all<{ id: string; current_id: string; name: string; logo_r2_key: string | null }>(
      db,
      `SELECT organization.id,current.id AS current_id,current.name,current.logo_r2_key
         FROM organizations organization
         JOIN organizations current ON current.id = COALESCE(organization.merged_into_organization_id, organization.id)
        WHERE organization.id IN (SELECT value FROM json_each(?)) ORDER BY organization.id LIMIT ${BATCH}`,
      [JSON.stringify(organizationIds.slice(offset, offset + BATCH))],
    );
    for (const row of rows) {
      const parsed = agendaSpeakerOrganizationSchema.safeParse({
        name: row.name,
        logoUrl: organizationLogoUrl(row.current_id, row.logo_r2_key),
      });
      if (parsed.success) organizations[row.id] = parsed.data;
    }
  }
  return organizations;
}

/** Attach the live organizations every approved affiliation in the snapshot credits. */
export async function withAgendaSpeakerOrganizations<T extends AgendaSnapshot>(
  db: DatabaseLike,
  snapshot: T,
): Promise<T> {
  return {
    ...snapshot,
    speakerOrganizations: await readAgendaSpeakerOrganizations(db, agendaCreditedOrganizationIds(snapshot.occurrences)),
  };
}

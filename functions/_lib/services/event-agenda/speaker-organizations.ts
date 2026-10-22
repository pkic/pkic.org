import type { DatabaseLike } from "../../types";
import { agendaSpeakerOrganizationSchema, type AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { agendaCreditedOrganizationIds } from "../../../../assets/shared/agenda-speaker-affiliations";
import { organizationLogoUrl } from "../organization-content/fields";

const BATCH = 100;
export interface AgendaOrganizationRow {
  id: string;
  current_id: string;
  name: string;
  logo_r2_key: string | null;
}

function prepareOrganizationRows(db: DatabaseLike, selection: string, bindings: unknown[], limit: number) {
  return db
    .prepare(`SELECT organization.id,current.id AS current_id,current.name,current.logo_r2_key
    FROM organizations organization
    JOIN organizations current ON current.id=COALESCE(organization.merged_into_organization_id,organization.id)
    WHERE organization.id IN(${selection}) ORDER BY organization.id LIMIT ?`)
    .bind(...bindings, limit);
}

/** Restrict candidates to this event's credited people and historical affiliations; decode retains exact credits. */
export function prepareAgendaEventOrganizations(db: DatabaseLike, eventId: string) {
  return prepareOrganizationRows(
    db,
    `
      SELECT identity.organization_id FROM identities identity WHERE identity.user_id IN(
        SELECT speaker.user_id FROM event_agenda_occurrence_speakers speaker
        JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id WHERE occurrence.event_id=?)
      UNION SELECT json_extract(affiliation.value,'$.organizationId')
        FROM event_agenda_session_history history
        JOIN event_agenda_occurrences occurrence ON occurrence.id=history.occurrence_id
        JOIN json_each(history.metadata_json,'$.appearances') appearance
        JOIN json_each(appearance.value,'$.affiliations') affiliation WHERE occurrence.event_id=?`,
    [eventId, eventId],
    600001,
  );
}

export function decodeAgendaSpeakerOrganizations(rows: AgendaOrganizationRow[]) {
  const organizations: NonNullable<AgendaSnapshot["speakerOrganizations"]> = {};
  for (const row of rows) {
    const parsed = agendaSpeakerOrganizationSchema.safeParse({
      name: row.name,
      logoUrl: organizationLogoUrl(row.current_id, row.logo_r2_key),
    });
    if (parsed.success) organizations[row.id] = parsed.data;
  }
  return organizations;
}

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
    const { results: rows } = await prepareOrganizationRows(
      db,
      "SELECT value FROM json_each(?)",
      [JSON.stringify(organizationIds.slice(offset, offset + BATCH))],
      BATCH,
    ).all<AgendaOrganizationRow>();
    Object.assign(organizations, decodeAgendaSpeakerOrganizations(rows));
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

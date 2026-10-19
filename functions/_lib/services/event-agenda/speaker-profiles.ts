import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { agendaSpeakerSchema, type AgendaOccurrence } from "../../../../assets/shared/schemas/event-agenda";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { identityJobTitleSql } from "../identities/affiliation-projection";
import { creditedIdentityIdSql } from "./credited-identity";
import { publicUserHeadshotPath } from "../user-headshot";
import { agendaSpeakerDisplayNameSql } from "./speaker-name";

/**
 * Each credited person as the identity they speak as says now (the one rule in
 * `credited-identity.ts`), with the person's own photo. Available person data stays in the
 * authorized editing read model; representation requires explicit review.
 */
export async function readAgendaSpeakers(db: DatabaseLike, eventId: string, occurrenceIds: string[]) {
  const rows = occurrenceIds.length
    ? await all<{
        occurrence_id: string;
        user_id: string;
        display_name: string;
        role: string;
        attendance_mode: "physical" | "remote";
        room_id: string | null;
        identity_id: string | null;
        organization_name: string | null;
        job_title: string | null;
        biography: string | null;
        links_json: string | null;
        headshot_r2_key: string | null;
      }>(
        db,
        `SELECT credited.occurrence_id,credited.user_id,credited.role,credited.attendance_mode,credited.room_id,
          credited.display_name,
          CASE WHEN credited.available=1 THEN spoken_as.id END AS identity_id,
          CASE WHEN credited.available=1 THEN spoken_as_organization.name END AS organization_name,
          CASE WHEN credited.available=1 THEN ${identityJobTitleSql("spoken_as.id")} END AS job_title,
          CASE WHEN credited.available=1 THEN spoken_as.biography END AS biography,
          CASE WHEN credited.available=1 THEN spoken_as.links_json END AS links_json,
          CASE WHEN credited.available=1 THEN credited.headshot_r2_key END AS headshot_r2_key
        FROM (
          SELECT speaker.occurrence_id,speaker.user_id,speaker.role,speaker.attendance_mode,speaker.room_id,
            ${agendaSpeakerDisplayNameSql} AS display_name, user.headshot_r2_key,
            (user.active=1 AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL) AS available,
            ${creditedIdentityIdSql("speaker.occurrence_id", "speaker.user_id")} AS identity_id
          FROM event_agenda_occurrence_speakers speaker
          JOIN users user ON user.id=speaker.user_id
          JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id
          WHERE speaker.occurrence_id IN(SELECT value FROM json_each(?)) AND occurrence.event_id=? LIMIT 60000
        ) credited
        LEFT JOIN identities spoken_as ON spoken_as.id=credited.identity_id
        LEFT JOIN organizations spoken_as_organization ON spoken_as_organization.id=spoken_as.organization_id`,
        [JSON.stringify(occurrenceIds), eventId],
      )
    : [];
  const groups = new Map<string, AgendaOccurrence["speakers"]>();
  for (const row of rows) {
    const group = groups.get(row.occurrence_id) ?? [];
    group.push(
      agendaSpeakerSchema.parse({
        userId: row.user_id,
        displayName: row.display_name,
        role: row.role,
        attendanceMode: row.attendance_mode,
        roomId: row.room_id,
        profileCandidate: {
          identityId: row.identity_id,
          organizationName: row.organization_name,
          jobTitle: row.job_title,
          biography: row.biography,
          links: parseLinksJson(row.links_json),
          photoUrl: publicUserHeadshotPath(row.user_id, row.headshot_r2_key),
        },
      }),
    );
    groups.set(row.occurrence_id, group);
  }
  return groups;
}

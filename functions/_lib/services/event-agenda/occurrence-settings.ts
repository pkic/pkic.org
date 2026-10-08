import type { DatabaseLike, StatementLike } from "../../types";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { prepareAgendaSponsorSelection } from "./sponsors";
import { agendaSettingsObject, agendaSettingsWriteSql } from "./settings-object";

type OccurrenceDetails = { id: string; kind: string; virtualRoomUrl?: string | null; sponsorIds?: string[] };

/** Media and sponsor leaves share one settings CAS, including a multi-day manual break command. */
export async function prepareAgendaOccurrenceSettings(
  db: DatabaseLike,
  eventId: string,
  candidates: readonly OccurrenceDetails[],
): Promise<StatementLike[]> {
  const changes = candidates.filter(
    (candidate) => candidate.virtualRoomUrl !== undefined || candidate.sponsorIds !== undefined,
  );
  if (!changes.length) return [];
  const event = await first<{ settings_json: string }>(db, "SELECT settings_json FROM events WHERE id=?", [eventId]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const selected = [...new Set(changes.flatMap((candidate) => candidate.sponsorIds ?? []))];
  for (const candidate of changes)
    if (candidate.sponsorIds?.length && candidate.kind !== "break")
      throw new AppError(422, "AGENDA_BREAK_SPONSOR_REQUIRED", "Sponsor credits belong to break or lunch items.");
  const sponsorGuards = await prepareAgendaSponsorSelection(db, eventId, selected);
  const record = agendaSettingsObject;
  const agenda = record(record(JSON.parse(event.settings_json)).agenda);
  const media = record(agenda.sessionMedia),
    sponsors = record(agenda.sessionSponsors);
  let mediaChanged = false,
    sponsorsChanged = false;
  for (const candidate of changes) {
    if (candidate.virtualRoomUrl !== undefined) {
      const details = record(media[candidate.id]);
      if (candidate.virtualRoomUrl === null) delete details.joinUrl;
      else details.joinUrl = candidate.virtualRoomUrl;
      media[candidate.id] = details;
      mediaChanged = true;
    }
    if (candidate.sponsorIds !== undefined) {
      const details = record(sponsors[candidate.id]);
      if (candidate.sponsorIds.length) details.sponsorIds = candidate.sponsorIds;
      else delete details.sponsorIds;
      sponsors[candidate.id] = details;
      sponsorsChanged = true;
    }
  }
  if (mediaChanged) agenda.sessionMedia = media;
  if (sponsorsChanged) agenda.sessionSponsors = sponsors;
  return [
    ...sponsorGuards,
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM events WHERE id=? AND settings_json=? AND NOT EXISTS(SELECT 1 FROM json_each(?) chosen
        WHERE NOT EXISTS(SELECT 1 FROM event_agenda_occurrences occurrence WHERE occurrence.id=chosen.value AND occurrence.event_id=?))`,
      bindings: [eventId, event.settings_json, JSON.stringify(changes.map((candidate) => candidate.id)), eventId],
    }),
    db
      .prepare(`UPDATE events SET settings_json=${agendaSettingsWriteSql},updated_at=? WHERE id=? AND settings_json=?`)
      .bind(JSON.stringify(agenda), nowIso(), eventId, event.settings_json),
  ];
}

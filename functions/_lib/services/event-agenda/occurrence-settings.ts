import type { DatabaseLike, StatementLike } from "../../types";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { prepareAgendaSponsorSelection } from "./sponsors";
import { agendaSettingsObject, agendaSettingsWriteSql } from "./settings-object";

type OccurrenceDetails = {
  id: string;
  kind: string;
  virtualRoomUrl?: string | null;
  sponsorIds?: string[];
  speakerUserIds?: string[];
  speakerIdentityIds?: Record<string, string[]>;
};

/** Media, sponsor, and speaker-order leaves share one settings CAS, including a multi-day manual break command. */
export async function prepareAgendaOccurrenceSettings(
  db: DatabaseLike,
  eventId: string,
  candidates: readonly OccurrenceDetails[],
): Promise<StatementLike[]> {
  const changes = candidates.filter(
    (candidate) =>
      candidate.virtualRoomUrl !== undefined ||
      candidate.sponsorIds !== undefined ||
      candidate.speakerUserIds !== undefined ||
      candidate.speakerIdentityIds !== undefined,
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
    sponsors = record(agenda.sessionSponsors),
    speakerOrder = record(agenda.sessionSpeakerOrder),
    speakerIdentities = record(agenda.sessionSpeakerIdentities);
  let mediaChanged = false,
    sponsorsChanged = false,
    speakerOrderChanged = false,
    speakerIdentitiesChanged = false;
  const identityGuards: StatementLike[] = [];
  for (const candidate of changes) {
    if (
      Object.keys(candidate.speakerIdentityIds ?? {}).length ||
      (candidate.speakerUserIds !== undefined && Object.hasOwn(speakerIdentities, candidate.id))
    ) {
      const identities = record(speakerIdentities[candidate.id]);
      if (candidate.speakerUserIds) {
        for (const userId of Object.keys(identities))
          if (!candidate.speakerUserIds.includes(userId)) delete identities[userId];
      }
      for (const [userId, identityIds] of Object.entries(candidate.speakerIdentityIds ?? {})) {
        if (candidate.speakerUserIds && !candidate.speakerUserIds.includes(userId))
          throw new AppError(
            422,
            "AGENDA_SPEAKER_IDENTITY_INVALID",
            "Choose an identity belonging to a session speaker.",
          );
        for (const identityId of identityIds) {
          const valid = await first(
            db,
            `SELECT 1 FROM identities identity JOIN users person ON person.id=identity.user_id
          WHERE identity.id=? AND identity.user_id=? AND identity.started_at IS NOT NULL
          AND identity.ended_at IS NULL AND identity.blocked_at IS NULL AND person.active=1
          AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL`,
            [identityId, userId],
          );
          if (!valid)
            throw new AppError(
              422,
              "AGENDA_SPEAKER_IDENTITY_INVALID",
              "Choose an active identity belonging to the speaker.",
            );
          identityGuards.push(
            prepareAuthorizationGuard(db, {
              sql: `SELECT 1 FROM identities identity JOIN users person ON person.id=identity.user_id
            WHERE identity.id=? AND identity.user_id=? AND identity.started_at IS NOT NULL
            AND identity.ended_at IS NULL AND identity.blocked_at IS NULL AND person.active=1
            AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL`,
              bindings: [identityId, userId],
            }),
          );
        }
        identities[userId] = identityIds;
      }
      if (Object.keys(identities).length) speakerIdentities[candidate.id] = identities;
      else delete speakerIdentities[candidate.id];
      speakerIdentitiesChanged = true;
    }
    if (
      candidate.speakerUserIds !== undefined &&
      (candidate.speakerUserIds.length || Object.hasOwn(speakerOrder, candidate.id))
    ) {
      if (candidate.speakerUserIds.length) speakerOrder[candidate.id] = candidate.speakerUserIds;
      else delete speakerOrder[candidate.id];
      speakerOrderChanged = true;
    }
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
  if (!mediaChanged && !sponsorsChanged && !speakerOrderChanged && !speakerIdentitiesChanged) return [];
  if (mediaChanged) agenda.sessionMedia = media;
  if (sponsorsChanged) agenda.sessionSponsors = sponsors;
  if (speakerOrderChanged) agenda.sessionSpeakerOrder = speakerOrder;
  if (speakerIdentitiesChanged) agenda.sessionSpeakerIdentities = speakerIdentities;
  return [
    ...sponsorGuards,
    ...identityGuards,
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

import { creditAffiliations } from "../../../../assets/shared/agenda-speaker-affiliations";
import { readLiveCreditIdentities } from "./live-credit-identities";
import { agendaOccurrenceSchema } from "../../../../assets/shared/schemas/event-agenda";
import { liveRoomSessionSchema, type LiveRoomSession } from "../../../../assets/shared/schemas/live-session-room";
import { agendaSpeakerContent } from "../../../../assets/shared/public-agenda-content";
import {
  canonicalSessionCredits,
  sessionDisplayCredits,
  publicSessionCreditRole,
} from "../../../../assets/shared/session-public-credits";
import { first } from "../../db/queries";
import { z } from "zod";
import { agendaDisplayRoleShiftSchema } from "../../../../assets/shared/schemas/event-agenda";
import { LIVE_MODERATOR_ROLE_LABEL, liveSessionHosts } from "../../../../assets/shared/live-room-credits";
import { parseJsonSafe } from "../../utils/json";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";

/** What a room knows about its session: the approved schedule, its credits and who is credited. */
export interface LiveRoomSessionRecord {
  eventId: string;
  session: LiveRoomSession;
  /** Accounts credited on the approved session; they may mark questions answered. */
  speakerUserIds: string[];
  roomIds: string[];
}

/** The session's credits a room carries, speakers first. */
const LIVE_ROOM_SESSION_CREDITS_MAX = 50;

function unavailable() {
  return new AppError(404, "LIVE_SESSION_NOT_FOUND", "This session is not on the approved agenda.");
}

/** The duties the published agenda shows, for the hosts a room offers as lower thirds. */
async function readPublishedDisplayRoles(db: DatabaseLike, eventId: string) {
  const row = await first<{ display_roles: string | null }>(
    db,
    `SELECT json_extract(publication.snapshot_json,'$.displayRoles') AS display_roles
     FROM event_agenda_publications publication
     JOIN event_agenda_state state ON state.event_id=publication.event_id AND state.published_revision=publication.revision
     WHERE publication.event_id=?`,
    [eventId],
  );
  const parsed = z
    .array(agendaDisplayRoleShiftSchema)
    .safeParse(parseJsonSafe<unknown>(row?.display_roles ?? null, []));
  return parsed.success ? parsed.data : [];
}

/**
 * A live room exists only for a scheduled, non-break session on the event's
 * approved agenda. Admitting a socket also reads the people its lower thirds
 * name: the hosts the agenda shows on duty, and each credited person's
 * identity for their title and organization. The checks on every later
 * message need neither, so they stay within their query budget.
 */
export async function readLiveRoomSession(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  options: { people?: boolean } = {},
): Promise<LiveRoomSessionRecord> {
  const row = await first<{ payload_json: string; timezone: string }>(
    db,
    `SELECT approved.payload_json,event.timezone FROM event_agenda_state state
     JOIN event_agenda_published_occurrences approved ON approved.event_id=state.event_id AND approved.revision=state.published_revision
     JOIN events event ON event.id=state.event_id
     WHERE state.event_id=? AND approved.occurrence_id=?`,
    [eventId, occurrenceId],
  );
  if (!row) throw unavailable();
  const parsed = agendaOccurrenceSchema.safeParse(JSON.parse(row.payload_json));
  if (!parsed.success) throw unavailable();
  const occurrence = parsed.data;
  if (occurrence.kind === "break" || occurrence.placeholder || !occurrence.startAt || !occurrence.endAt)
    throw unavailable();
  const displayed = sessionDisplayCredits(occurrence);
  // Each person appears as the identity they act as: an approved appearance names it; someone credited
  // without one appears as the agenda's one rule resolves it (their proposal choice, else primary).
  // Its title and organization are read now.
  const acting = displayed.map((credit) =>
    "userId" in credit ? (creditAffiliations(credit)[0]?.identityId ?? null) : null,
  );
  const unnamed = displayed.flatMap((credit, index) =>
    "userId" in credit && acting[index] === null && !creditAffiliations(credit).length ? [credit.userId] : [],
  );
  const read = options.people
    ? await readLiveCreditIdentities(
        db,
        acting.filter((id): id is string => id !== null),
        { occurrenceId: occurrence.id, userIds: unnamed },
      )
    : { identities: new Map(), primary: new Map<string, string>() };
  const credits = displayed.map((credit, index) => {
    const content = agendaSpeakerContent(occurrence, credit);
    const identityId = acting[index] ?? ("userId" in credit ? read.primary.get(credit.userId) : undefined);
    // A source credit, or an appearance as an individual, keeps the capacity its record names: there is no identity to read.
    const recorded = identityId ? null : creditAffiliations(credit)[0];
    return {
      key: "userId" in credit ? `user:${credit.userId}` : `credit:${index}`,
      name: content.name,
      moderator: publicSessionCreditRole(occurrence, credit) === "moderator",
      roleLabel: publicSessionCreditRole(occurrence, credit) === "moderator" ? LIVE_MODERATOR_ROLE_LABEL : null,
      photoUrl: content.imageSrc ?? null,
      identity: identityId
        ? (read.identities.get(identityId) ?? null)
        : recorded && (recorded.title || recorded.organizationName)
          ? { title: recorded.title?.trim() || null, organization: recorded.organizationName?.trim() || null }
          : null,
    };
  });
  const hosts = options.people
    ? liveSessionHosts(
        await readPublishedDisplayRoles(db, eventId),
        occurrence,
        credits.map((credit) => credit.name),
      ).map((host) => ({
        key: host.key,
        name: host.name,
        moderator: false,
        photoUrl: null,
        identity: null,
        roleLabel: host.roleLabel,
      }))
    : [];
  return {
    eventId,
    session: liveRoomSessionSchema.parse({
      occurrenceId: occurrence.id,
      title: occurrence.title,
      startAt: occurrence.startAt,
      endAt: occurrence.endAt,
      timeZone: row.timezone,
      credits: [...credits, ...hosts].slice(0, LIVE_ROOM_SESSION_CREDITS_MAX),
    }),
    roomIds: [occurrence.roomId, ...(occurrence.additionalRoomIds ?? [])].filter((id): id is string => id !== null),
    speakerUserIds: canonicalSessionCredits(occurrence).flatMap((credit) =>
      "userId" in credit ? [credit.userId] : [],
    ),
  };
}

import { publicSessionTiming } from "../../../../assets/shared/session-public-timing";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { agendaDisplayRoles } from "../../../../assets/shared/event-agenda-display-roles";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { publicSessionMediaUrls } from "../../../../assets/shared/schemas/event-session-history";

/** Prepare the same public-role snapshot for approval and authenticated draft preview. */
export function preparePublicAgendaSnapshot(
  snapshot: AgendaSnapshot,
  revision: number,
  approvedAt?: string,
  calendarPublic?: boolean,
): AgendaSnapshot {
  return {
    ...snapshot,
    revision,
    publishedRevision: revision,
    approvedAt,
    calendarPublic,
    occurrences: snapshot.occurrences
      .filter((item) => publicSessionTiming(item) !== undefined)
      .map((item) => ({
        ...item,
        ...publicSessionMediaUrls(item.history?.materials ?? []),
        speakers: item.speakers.map(({ profileCandidate: _candidate, ...speaker }) => speaker),
      })),
    displayRoles: [
      ...new Set(snapshot.blocks.map((block) => instantToDateTimeLocal(block.startAt, snapshot.timeZone).slice(0, 10))),
    ].flatMap((date) => agendaDisplayRoles(snapshot, date, true)),
    staffingReport: undefined,
    staffingRoles: [],
    staffingPosts: [],
    staffingRequirements: [],
    staffingPositions: [],
    roleMembers: [],
    assignments: [],
    blocks: [],
  };
}

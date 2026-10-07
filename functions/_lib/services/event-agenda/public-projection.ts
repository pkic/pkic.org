import { publicSessionTiming } from "../../../../assets/shared/session-public-timing";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import {
  publicSessionMaterials,
  publicSessionMediaUrls,
} from "../../../../assets/shared/schemas/event-session-history";

/** Exact document projection shared by authenticated previews and static publication extraction. */
export function publicAgendaProjection(approved: AgendaSnapshot, basePath: string | null): AgendaSnapshot {
  return {
    ...approved,
    publicAgendaPath:
      (basePath?.startsWith("/") && !basePath.startsWith("//")
        ? basePath.replace(/\/$/u, "")
        : `/events/${approved.eventSlug}`) + "/agenda/",
    occurrences: approved.occurrences
      .filter((item) => item.visibility === "public" && publicSessionTiming(item) !== undefined)
      .map((item) => ({
        ...item,
        virtualRoomUrl: undefined,
        sponsorIds: undefined,
        sponsors: item.kind === "break" ? item.sponsors : undefined,
        onlineAccessAvailable: Boolean(item.virtualRoomUrl),
        ...publicSessionMediaUrls(item.history?.materials ?? []),
        speakers: item.speakers.map((speaker) => ({
          userId: speaker.userId,
          displayName: speaker.displayName,
          role: speaker.role,
        })),
        promotionCopy: item.promotionCopy?.approvedAt ? item.promotionCopy : undefined,
        history: item.history
          ? {
              ...item.history,
              sourceDecisions: [],
              proposalRepresentations: [],
              materials: publicSessionMaterials(item.history.materials),
            }
          : undefined,
      })),
    staffingReport: undefined,
    shifts: [],
    assignments: [],
    roleMembers: [],
  };
}

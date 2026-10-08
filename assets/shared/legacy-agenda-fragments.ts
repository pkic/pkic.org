import { siteContentSlug } from "./site-content-slug";
import { legacyAgendaFragmentAnchorSchema } from "./schemas/event-agenda-legacy-fragments";
import type {
  ContentAgendaDayFragment,
  ContentAgendaSessionFragment,
  ContentAgendaSpeakerFragment,
  ContentAgendaDay,
} from "./site-agenda";

/** Unassigned aliases belong only to their session's native first-column dialog, without a physical room. */
export function legacyAgendaFragmentMatchesPlacement(
  fragment: ContentAgendaSessionFragment,
  session: Pick<ContentAgendaDay["slots"][number]["sessions"][number], "locations">,
  roomId: string | undefined,
  column: number,
) {
  return fragment.roomId === null ? session.locations.length === 0 && column === 0 : fragment.roomId === roomId;
}

/** Exact source-format IDs, never calculated from edited occurrence titles or times. */
export function authoredAgendaSessionFragments(
  authoredStart: string,
  authoredTitle: string | null,
  roomRefs: readonly string[],
  authoredRoomOrder: readonly string[],
): ContentAgendaSessionFragment[] {
  return roomRefs.flatMap((roomId) => {
    const index = authoredRoomOrder.indexOf(roomId);
    if (index < 0) return [];
    const anchor = `sessionModal-${authoredStart.replace(/:/gu, "")}-${index}-${siteContentSlug(authoredTitle ?? "")}`;
    if (!legacyAgendaFragmentAnchorSchema.safeParse(anchor).success) return [];
    return [
      { anchor, kind: "dialog" as const, roomId },
      { anchor: `${anchor}-label`, kind: "dialog_label" as const, roomId },
    ];
  });
}

export function authoredAgendaDayFragments(authoredDate: string): ContentAgendaDayFragment[] {
  const date = new Date(`${authoredDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== authoredDate) return [];
  const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getUTCDay()];
  return [
    { anchor: `nav-${weekday}`, kind: "day" },
    { anchor: `nav-${weekday}-tab`, kind: "day_tab" },
  ];
}

export const authoredAgendaSpeakerFragments: ContentAgendaSpeakerFragment[] = [
  { anchor: "speakers", kind: "speakers" },
  { anchor: "nav-speakers", kind: "speakers_tab" },
];

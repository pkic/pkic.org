import type { ContentAgendaDay, ContentAgendaSpeakerFragment } from "../../shared/site-agenda";
import { agendaRows } from "./agenda-layout";
import { legacyAgendaFragmentMatchesPlacement } from "../../shared/legacy-agenda-fragments";

/** Exact protected aliases share the document ID namespace with native agenda targets. */
export function agendaFragmentRegistry(
  days: readonly ContentAgendaDay[],
  speakerFragments: readonly ContentAgendaSpeakerFragment[],
  controlsHeight = 0,
) {
  const nativeIds = new Set(["agenda-speakers", "agenda-tab-speakers"]);
  const aliases = new Map<string, Set<string>>();
  const primary = new Map<string, Set<string>>();
  const emitted = new Set<string>();
  const claim = (map: Map<string, Set<string>>, anchor: string, target: string) => {
    const owners = map.get(anchor) ?? new Set<string>();
    owners.add(target);
    map.set(anchor, owners);
  };
  for (const day of days) {
    nativeIds.add(`agenda-day-${day.date}`);
    nativeIds.add(`agenda-tab-${day.date}`);
    for (const fragment of day.legacyFragments ?? []) claim(aliases, fragment.anchor, `day:${day.date}`);
    agendaRows(day, controlsHeight).forEach(({ cells }, slotIndex) => {
      cells.forEach((cell, roomIndex) => {
        cell?.sessions.forEach((session, sessionIndex) => {
          const dialogId = `agenda-session-${day.date}-${slotIndex}-${roomIndex}-${sessionIndex}`;
          nativeIds.add(dialogId);
          nativeIds.add(`${dialogId}-title`);
          const owner = session.id ?? `${day.date}:${slotIndex}:${day.slots[slotIndex]!.sessions.indexOf(session)}`;
          if (session.publicAnchor) claim(primary, session.publicAnchor, owner);
          for (const fragment of session.legacyFragments ?? []) {
            if (
              day.locations
                .slice(roomIndex, roomIndex + cell.colSpan)
                .some((room, offset) =>
                  legacyAgendaFragmentMatchesPlacement(fragment, session, room.id, roomIndex + offset),
                )
            )
              claim(aliases, fragment.anchor, `${dialogId}:${fragment.roomId ?? "unassigned"}`);
          }
        });
      });
    });
  }
  for (const fragment of speakerFragments) claim(aliases, fragment.anchor, "speakers");
  function take(anchor: string, permitted: boolean): string | undefined {
    if (!permitted || emitted.has(anchor)) return undefined;
    emitted.add(anchor);
    return anchor;
  }
  return {
    takeAlias: (anchor: string) =>
      take(anchor, aliases.get(anchor)?.size === 1 && !nativeIds.has(anchor) && !primary.has(anchor)),
    takePrimary: (anchor?: string) =>
      anchor ? take(anchor, primary.get(anchor)?.size === 1 && !nativeIds.has(anchor)) : undefined,
  };
}

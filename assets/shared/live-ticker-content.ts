import type { LiveTickerConfig, LiveTickerContext, LiveTickerSegment } from "./schemas/live-session-ticker";
import { DEFAULT_LIVE_TICKER_CONTEXT } from "./schemas/live-session-ticker";
import type { AgendaSnapshot, AgendaOccurrence } from "./schemas/event-agenda";
import { sessionDisplayCredits } from "./session-public-credits";
import { zonedDateTimeParts } from "./timezone";
import { LIVE_TICKER_NEAR_END_MS } from "./live-ticker-template";
import { renderOverlayTextMarkdown, type OverlayTemplateValue } from "./overlay-text-template";
function speakers(session: AgendaOccurrence | undefined) {
  return session
    ? sessionDisplayCredits(session)
        .map((credit) => credit.displayName)
        .join(", ")
    : "";
}
export function resolveTickerMessages(
  config: LiveTickerConfig,
  agenda: Pick<AgendaSnapshot, "rooms" | "occurrences"> | null,
  occurrenceId: string,
  now: number,
  context: LiveTickerContext = DEFAULT_LIVE_TICKER_CONTEXT,
  /** The latest attendee chat lines the room allows on air, oldest first. */
  chat: readonly string[] = [],
): LiveTickerSegment[] {
  const scheduled = (agenda?.occurrences ?? [])
    .filter(
      (item) =>
        item.visibility === "public" && !item.placeholder && item.startAt && item.endAt && item.kind !== "break",
    )
    .sort((a, b) => Date.parse(a.startAt!) - Date.parse(b.startAt!) || a.id.localeCompare(b.id));
  const current = scheduled.find((item) => item.id === occurrenceId),
    rooms = new Set([current?.roomId, ...(current?.additionalRoomIds ?? [])]);
  const upcoming = scheduled.filter(
    (item) =>
      item.id !== occurrenceId &&
      Date.parse(item.startAt!) >= Math.max(now, current?.endAt ? Date.parse(current.endAt) : now) &&
      (rooms.has(item.roomId) || (item.additionalRoomIds ?? []).some((id) => rooms.has(id))),
  );
  const [next, following] = upcoming,
    part = zonedDateTimeParts(new Date(now), context.timeZone),
    greeting = part.hour < 12 ? "Good morning" : part.hour < 18 ? "Good afternoon" : "Good evening";
  const until = (session: AgendaOccurrence | undefined) =>
    session?.startAt ? `${Math.max(0, Math.ceil((Date.parse(session.startAt) - now) / 60000))} min` : "";
  const time = (session: AgendaOccurrence | undefined) => {
    if (!session?.startAt) return "";
    const value = zonedDateTimeParts(session.startAt, context.timeZone);
    return `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
  };
  const other = (agenda?.rooms ?? [])
    .filter((room) => !rooms.has(room.id))
    .slice(0, 20)
    .flatMap((room) => {
      const session = scheduled.find(
        (item) =>
          Date.parse(item.startAt!) >= now &&
          (item.roomId === room.id || (item.additionalRoomIds ?? []).includes(room.id)),
      );
      return session ? [`${room.name}: ${session.title} · ${time(session)} · ${speakers(session)}`] : [];
    })
    .join(" · ");
  const sessionValues = (session: AgendaOccurrence | undefined) => ({
    title: session?.title ?? "",
    speakers: speakers(session),
    time: time(session),
    in: until(session),
  });
  const data: OverlayTemplateValue = {
    greeting,
    session: {
      ...sessionValues(current),
      minutes_remaining: current?.endAt
        ? String(Math.max(0, Math.ceil((Date.parse(current.endAt) - now) / 60000)))
        : "",
    },
    next: sessionValues(next),
    after_next: sessionValues(following),
    other_rooms: { next: other },
    sponsors: {
      summary: context.sponsorGroups.map((group) => `${group.tier}: ${group.names.join(", ")}`).join(" · "),
      tiers: context.sponsorGroups,
      tier: Object.fromEntries(context.sponsorGroups.map((group) => [group.key, group.names.join(", ")])),
    },
    chat: { latest: chat.join(" · ") },
  };
  return config.messages.flatMap((message) => {
    if (
      message.condition === "near-session-end" &&
      (!current?.startAt ||
        !current.endAt ||
        now < Date.parse(current.startAt) ||
        now > Date.parse(current.endAt) ||
        Date.parse(current.endAt) - now > LIVE_TICKER_NEAR_END_MS)
    )
      return [];
    let markdown: string;
    try {
      markdown = renderOverlayTextMarkdown(message.template, data).slice(0, 2000);
    } catch {
      return [];
    }
    return markdown.trim() ? [{ id: message.id, prefix: message.prefix, markdown }] : [];
  });
}

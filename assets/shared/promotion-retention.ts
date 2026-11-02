import { eventPhase } from "./event-phase";

/** How long badges and promotion files stay downloadable after an event ends. */
export const PROMOTION_RETENTION_DAYS = 30;

type EventWindow = { startsAt: string | null; endsAt: string | null };

/** Promotion invites people to come, so sharing closes when the event ends. */
export function promotionIsOpen(event: EventWindow, at = Date.now()): boolean {
  return eventPhase(event, at) !== "past";
}

/** Whether an event's badges and promotion files are still kept; an unscheduled event keeps them. */
export function promotionIsRetained(event: EventWindow, at = Date.now()): boolean {
  const end = Date.parse(event.endsAt ?? event.startsAt ?? "");
  return !Number.isFinite(end) || at < end + PROMOTION_RETENTION_DAYS * 86_400_000;
}

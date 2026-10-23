import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { prepareEventBySlug } from "../events";
import { preparePersonalCalendarRead } from "./calendar-entries";
import {
  prepareAgendaCalendarSubscription,
  prepareAgendaCalendarSettings,
  prepareCurrentAgendaCalendarSubscription,
  type AgendaCalendarFeedOrigin,
} from "./calendar-subscriptions";
import { readParticipantEvent } from "./participant-read-context";

/** The revocable token, owning event, and feed entries use the same request-session snapshot. */
export async function readAgendaCalendarFeed(db: DatabaseLike, slug: string, token: string) {
  const event = { slug };
  const subscription = await prepareAgendaCalendarSubscription(db, event, token);
  const calendar = preparePersonalCalendarRead(db, event, subscription);
  const [eventResult, subscriptionResult, ...entries] = await db.batch([
    prepareEventBySlug(db, slug),
    subscription.statement,
    ...calendar.statements,
  ]);
  if (!batchFirst(eventResult)) throw new AppError(404, "EVENT_NOT_FOUND", `Event '${slug}' not found`);
  subscription.decode([subscriptionResult]);
  return calendar.decode(entries);
}

export function readCurrentAgendaCalendarSubscription(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  origin: AgendaCalendarFeedOrigin,
) {
  return readParticipantEvent(db, request, env, origin.eventSlug, "existing", (userId, event) =>
    prepareCurrentAgendaCalendarSubscription(db, event, userId, origin),
  );
}

export function readAgendaCalendarSettings(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  slug: string,
) {
  return readParticipantEvent(db, request, env, slug, "existing", (userId, event) =>
    prepareAgendaCalendarSettings(db, event, userId),
  );
}

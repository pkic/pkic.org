import type { z } from "zod";
import type { DatabaseLike, Env } from "../../types";
import { promotionSessionsQuerySchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import { preparePromotionRequestActor } from "./promotion-request-context";
import { preparePublishedPromotionSessions } from "./promotion-access";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";

export async function readOwnPromotionSessions(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  query: z.infer<typeof promotionSessionsQuerySchema>,
  attendee = false,
) {
  const actor = await preparePromotionRequestActor(db, request, env);
  const list = preparePublishedPromotionSessions(db, { slug: eventSlug }, attendee ? null : actor.subjectId, query);
  const loaded = await db.batch([
    ...actor.statements,
    db
      .prepare(
        "SELECT event.id,event.timezone,EXISTS(SELECT 1 FROM registrations WHERE event_id=event.id AND user_id=? AND status='registered') AS registered FROM events event WHERE event.slug=?",
      )
      .bind(actor.subjectId, eventSlug),
    ...list.statements,
  ]);
  await actor.decode(loaded.slice(0, actor.statements.length));
  const event = batchFirst<{ id: string; timezone: string; registered: number }>(loaded[actor.statements.length]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  if (attendee && !event.registered)
    throw new AppError(
      403,
      "PROMOTION_REGISTRATION_REQUIRED",
      "Promotion materials are available to registered attendees.",
    );
  if (query.day && query.timeZone !== event.timezone)
    throw new AppError(
      409,
      "PROMOTION_TIME_ZONE_CHANGED",
      "The event time zone changed. Refresh before choosing a day.",
    );
  return list.decode(loaded.slice(actor.statements.length + 1));
}

import { eventTermsResponseSchema } from "../../../../assets/shared/schemas/forms";
import { batchFirst, batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { requiredTermReadModel } from "../event-read-models";
import { prepareEventBySlug, prepareRequiredTerms, type EventRecord, type EventTermRecord } from "../events";

export async function getEventTerms(db: DatabaseLike, eventSlug: string, audience: "attendee" | "speaker") {
  const [eventResult, termsResult] = await db.batch([
    prepareEventBySlug(db, eventSlug),
    prepareRequiredTerms(db, { slug: eventSlug }, audience),
  ]);
  const event = batchFirst<EventRecord>(eventResult);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", `Event '${eventSlug}' not found`);
  return eventTermsResponseSchema.parse({
    event: { id: event.id, slug: event.slug, name: event.name },
    audience,
    terms: batchRows<EventTermRecord>(termsResult).map(requiredTermReadModel),
  });
}

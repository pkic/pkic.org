import {
  eventFormsResponseSchema,
  type EventFormsPurpose,
  type EventFormsResponse,
} from "../../../../assets/shared/schemas/forms";
import type { DatabaseLike } from "../../types";
import { countRegisteredByEventDay, listEventDays } from "../event-days";
import { eventDayReadModels, requiredTermReadModel } from "../event-read-models";
import { getRequiredTerms, resolveEventSessionTypes, type EventRecord } from "../events";
import { getActiveFormForEvent, toEventFormResolutionEvent } from "../forms";

type EventConfigurationEvent = Pick<EventRecord, "id" | "slug" | "name" | "settings_json" | "source_mode">;

/**
 * Builds the single event-registration projection shared by public and group
 * routes. Portal events resolve only their exact D1 placement while Hugo and
 * integration events retain the explicit legacy fallback. Group routes use
 * the same source-aware policy as submission routes.
 * Counts and filtering inputs are resolved by D1-backed services.
 */
export async function getEventRegistrationConfiguration(
  db: DatabaseLike,
  event: EventConfigurationEvent,
  purpose: EventFormsPurpose,
): Promise<EventFormsResponse> {
  const audience = purpose === "proposal_submission" ? "speaker" : "attendee";
  const [form, requiredTerms, eventDays] = await Promise.all([
    getActiveFormForEvent(db, toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode }), purpose),
    getRequiredTerms(db, event.id, audience),
    listEventDays(db, event.id),
  ]);
  const registeredCounts =
    eventDays.length === 0 ? new Map<string, Map<string, number>>() : await countRegisteredByEventDay(db, event.id);

  return eventFormsResponseSchema.parse({
    event: { id: event.id, slug: event.slug, name: event.name },
    purpose,
    form,
    allowedSessionTypes: resolveEventSessionTypes(event.settings_json).map((sessionType) => sessionType.label),
    requiredTerms: requiredTerms.map(requiredTermReadModel),
    eventDays: eventDayReadModels(eventDays, registeredCounts),
  });
}

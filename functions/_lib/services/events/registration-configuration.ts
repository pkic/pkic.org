import {
  eventFormsResponseSchema,
  type EventFormsPurpose,
  type EventFormsResponse,
} from "../../../../assets/shared/schemas/forms";
import type { DatabaseLike } from "../../types";
import { countRegisteredByEventDay, listEventDays } from "../event-days";
import { eventDayReadModels, requiredTermReadModel } from "../event-read-models";
import { getRequiredTerms, resolveEventSessionTypes, type EventRecord } from "../events";
import { getActiveFormForResolution, type EventFormResolution } from "../forms";

export type EventRegistrationConfigurationResolution = EventFormResolution;

type EventConfigurationEvent = Pick<EventRecord, "id" | "slug" | "name" | "settings_json">;

/**
 * Builds the single event-registration projection shared by public and group
 * routes. Public events retain linked/event/global fallback behavior; a
 * group-scoped registration deliberately resolves only an active exact event
 * placement so the selected group cannot inherit unrelated configuration.
 * Counts and filtering inputs are resolved by D1-backed services.
 */
export async function getEventRegistrationConfiguration(
  db: DatabaseLike,
  event: EventConfigurationEvent,
  purpose: EventFormsPurpose,
  resolution: EventRegistrationConfigurationResolution = "public_fallback",
): Promise<EventFormsResponse> {
  const audience = purpose === "proposal_submission" ? "speaker" : "attendee";
  const [form, requiredTerms, eventDays] = await Promise.all([
    getActiveFormForResolution(db, event.id, purpose, resolution),
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

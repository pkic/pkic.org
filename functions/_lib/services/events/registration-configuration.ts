import {
  eventFormsResponseSchema,
  type EventFormsPurpose,
  type EventFormsResponse,
} from "../../../../assets/shared/schemas/forms";
import { normalizeEventRegistrationPolicy } from "./detail";
import { batchRows } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import {
  prepareRegisteredEventDayCounts,
  decodeRegisteredEventDayCounts,
  prepareEventDays,
  type EventDayRecord,
  type EventDayAttendanceCountRow,
} from "../event-days";
import { eventDayReadModels, requiredTermReadModel } from "../event-read-models";
import { prepareRequiredTerms, resolveEventSessionTypes, type EventRecord, type EventTermRecord } from "../events";
import { getActiveFormForEvent, toEventFormResolutionEvent, prepareEventFormDefinitionRead } from "../forms";

type EventConfigurationEvent = Pick<
  EventRecord,
  "id" | "slug" | "name" | "settings_json" | "source_mode" | "registration_mode"
>;

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
  const target = toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode });
  const formRead = prepareEventFormDefinitionRead(db, target, purpose);
  const [termsResult, daysResult, countsResult, ...formResults] = await db.batch([
    prepareRequiredTerms(db, event.id, audience),
    prepareEventDays(db, event.id),
    prepareRegisteredEventDayCounts(db, event.id),
    ...(formRead?.statements ?? []),
  ]);
  const form = formRead ? formRead.decode(formResults) : await getActiveFormForEvent(db, target, purpose);
  const requiredTerms = batchRows<EventTermRecord>(termsResult);
  const eventDays = batchRows<EventDayRecord>(daysResult);
  const registeredCounts = decodeRegisteredEventDayCounts(batchRows<EventDayAttendanceCountRow>(countsResult));

  return eventFormsResponseSchema.parse({
    event: { id: event.id, slug: event.slug, name: event.name },
    registrationPolicy: normalizeEventRegistrationPolicy(event.registration_mode),
    purpose,
    form,
    sessionTypes: resolveEventSessionTypes(event.settings_json),
    allowedSessionTypes: resolveEventSessionTypes(event.settings_json).map((sessionType) => sessionType.label),
    requiredTerms: requiredTerms.map(requiredTermReadModel),
    eventDays: eventDayReadModels(eventDays, registeredCounts),
  });
}

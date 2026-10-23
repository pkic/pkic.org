import {
  eventFormsResponseSchema,
  type EventFormsPurpose,
  type EventFormsResponse,
} from "../../../../assets/shared/schemas/forms";
import { normalizeEventRegistrationPolicy } from "./detail";
import { batchFirst, batchRows } from "../../db/pagination";
import type { DatabaseLike, D1StatementResult } from "../../types";
import {
  prepareRegisteredEventDayCounts,
  decodeRegisteredEventDayCounts,
  prepareEventDays,
  type EventDayRecord,
  type EventDayAttendanceCountRow,
} from "../event-days";
import { eventDayReadModels, requiredTermReadModel } from "../event-read-models";
import {
  prepareRequiredTerms,
  prepareEventBySlug,
  resolveEventSessionTypes,
  type EventRecord,
  type EventTermRecord,
} from "../events";
import {
  getActiveFormForEvent,
  toEventFormResolutionEvent,
  prepareEventFormDefinitionRead,
  type ActiveFormDefinition,
} from "../forms";
import { preparePlacedEventFormDefinition, eventFormResolutionFor } from "../forms/read";
import type { EventReadSelection } from "./selection";
import { AppError } from "../../errors";

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
  const target = toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode });
  const formRead = prepareEventFormDefinitionRead(db, target, purpose);
  const read = prepareRegistrationConfiguration(db, event.id, purpose, formRead);
  const snapshot = read.decode(await db.batch(read.statements));
  const form = formRead ? snapshot.form : await getActiveFormForEvent(db, target, purpose);
  return registrationConfiguration(event, purpose, snapshot, form);
}

/** Resolve the public slug and portal configuration in one complete request batch. */
export async function getEventRegistrationConfigurationBySlug(
  db: DatabaseLike,
  eventSlug: string,
  purpose: EventFormsPurpose,
): Promise<EventFormsResponse> {
  const selection = { slug: eventSlug };
  const formRead = preparePlacedEventFormDefinition(db, selection, purpose, "portal_owner");
  const read = prepareRegistrationConfiguration(db, selection, purpose, formRead);
  const [eventResult, ...details] = await db.batch([prepareEventBySlug(db, eventSlug), ...read.statements]);
  const event = batchFirst<EventRecord>(eventResult);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", `Event '${eventSlug}' not found`);
  const snapshot = read.decode(details);
  const target = toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode });
  const form =
    eventFormResolutionFor(target) === "event_placement"
      ? snapshot.form
      : await getActiveFormForEvent(db, target, purpose);
  return registrationConfiguration(event, purpose, snapshot, form);
}

function prepareRegistrationConfiguration(
  db: DatabaseLike,
  event: EventReadSelection,
  purpose: EventFormsPurpose,
  formRead: ReturnType<typeof prepareEventFormDefinitionRead>,
) {
  const audience = purpose === "proposal_submission" ? "speaker" : "attendee";
  return {
    statements: [
      prepareRequiredTerms(db, event, audience),
      prepareEventDays(db, event),
      prepareRegisteredEventDayCounts(db, event),
      ...(formRead?.statements ?? []),
    ],
    decode(results: D1StatementResult[]) {
      const [termsResult, daysResult, countsResult, ...formResults] = results;
      return {
        form: formRead?.decode(formResults) ?? null,
        requiredTerms: batchRows<EventTermRecord>(termsResult),
        eventDays: batchRows<EventDayRecord>(daysResult),
        registeredCounts: decodeRegisteredEventDayCounts(batchRows<EventDayAttendanceCountRow>(countsResult)),
      };
    },
  };
}

function registrationConfiguration(
  event: EventConfigurationEvent,
  purpose: EventFormsPurpose,
  snapshot: ReturnType<ReturnType<typeof prepareRegistrationConfiguration>["decode"]>,
  form: ActiveFormDefinition | null,
): EventFormsResponse {
  const { requiredTerms, eventDays, registeredCounts } = snapshot;
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

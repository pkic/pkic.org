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
import { prepareRequiredTerms, resolveEventSessionTypes, type EventRecord, type EventTermRecord } from "../events";
import { toEventFormResolutionEvent, prepareEventFormDefinitionRead, type ActiveFormDefinition } from "../forms";
import { preparePlacedEventFormDefinition } from "../forms/read";
import type { EventReadSelection } from "./selection";
import { AppError } from "../../errors";
import type { PreparedRequestViewerRead } from "../../auth/optional-request-viewer";
import { prepareAudienceEventBySlug } from "./audience-event";

type EventConfigurationEvent = Pick<
  EventRecord,
  "id" | "slug" | "name" | "settings_json" | "source_mode" | "registration_mode"
>;

/** One placement-based registration projection for every event source and route. */
export async function getEventRegistrationConfiguration(
  db: DatabaseLike,
  event: EventConfigurationEvent,
  purpose: EventFormsPurpose,
): Promise<EventFormsResponse> {
  const target = toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode });
  const formRead = prepareEventFormDefinitionRead(db, target, purpose);
  const read = prepareRegistrationConfiguration(db, event.id, purpose, formRead);
  const snapshot = read.decode(await db.batch(read.statements));
  return registrationConfiguration(event, purpose, snapshot, snapshot.form);
}

/**
 * Resolve the slug and event configuration in one complete request batch.
 * The event is selected through the canonical audience predicate, so a
 * caller who cannot read the event cannot read its forms either; the
 * viewer's session is decoded from the same batch before anything is released.
 */
export async function getEventRegistrationConfigurationBySlug(
  db: DatabaseLike,
  eventSlug: string,
  purpose: EventFormsPurpose,
  auth: PreparedRequestViewerRead | null = null,
): Promise<EventFormsResponse> {
  const selection = { slug: eventSlug };
  const formRead = preparePlacedEventFormDefinition(db, selection, purpose);
  const read = prepareRegistrationConfiguration(db, selection, purpose, formRead);
  const authentication = auth?.statements ?? [];
  const loaded = await db.batch([
    ...authentication,
    prepareAudienceEventBySlug(db, eventSlug, auth),
    ...read.statements,
  ]);
  if (auth) await auth.decode(loaded.slice(0, authentication.length));
  const [eventResult, ...details] = loaded.slice(authentication.length);
  const event = batchFirst<EventRecord>(eventResult);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found or not visible to this caller");
  const snapshot = read.decode(details);
  return registrationConfiguration(event, purpose, snapshot, snapshot.form);
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
      ...formRead.statements,
    ],
    decode(results: D1StatementResult[]) {
      const [termsResult, daysResult, countsResult, ...formResults] = results;
      return {
        form: formRead.decode(formResults),
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

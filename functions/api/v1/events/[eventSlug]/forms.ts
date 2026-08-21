import { dispatchRequestMethod, json } from "../../../../_lib/http";
import { getActiveFormByPurpose } from "../../../../_lib/services/forms";
import { getEventBySlug, getRequiredTerms, resolveEventSessionTypes } from "../../../../_lib/services/events";
import {
  countRegisteredByEventDay,
  listEventDays,
  resolveAttendanceOptions,
} from "../../../../_lib/services/event-days";
import { logError } from "../../../../_lib/logging";
import { eventFormsGetRouteSchema, eventFormsResponseSchema } from "../../../../../assets/shared/schemas/forms";
import { openApiRoute } from "../../../../_lib/openapi/route";

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("no such table");
}

async function getEventForm(c: any, purpose: "event_registration" | "proposal_submission"): Promise<Response> {
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const audience = purpose === "proposal_submission" ? "speaker" : "attendee";

  let form: Awaited<ReturnType<typeof getActiveFormByPurpose>> | null;
  let requiredTerms: Awaited<ReturnType<typeof getRequiredTerms>>;
  let eventDays: Awaited<ReturnType<typeof listEventDays>>;

  try {
    form = await getActiveFormByPurpose(c.env.DB, event.id, purpose);
  } catch (error) {
    if (isMissingTableError(error)) {
      logError("EVENT_FORMS_TABLE_MISSING", { eventSlug: event.slug, purpose });
      return json(
        {
          error: {
            code: "BACKEND_SCHEMA_MISSING",
            message: "Forms schema is not available yet. Run the latest database migrations.",
          },
        },
        503,
      );
    }
    throw error;
  }

  try {
    requiredTerms = await getRequiredTerms(c.env.DB, event.id, audience);
  } catch (error) {
    if (isMissingTableError(error)) {
      logError("EVENT_TERMS_TABLE_MISSING", { eventSlug: event.slug, purpose });
      return json(
        {
          error: {
            code: "BACKEND_SCHEMA_MISSING",
            message: "Terms schema is not available yet. Run the latest database migrations.",
          },
        },
        503,
      );
    }
    throw error;
  }

  try {
    eventDays = await listEventDays(c.env.DB, event.id);
  } catch (error) {
    if (isMissingTableError(error)) {
      logError("EVENT_DAYS_TABLE_MISSING", { eventSlug: event.slug, purpose });
      return json(
        {
          error: {
            code: "BACKEND_SCHEMA_MISSING",
            message: "Event days schema is not available yet. Run the latest database migrations.",
          },
        },
        503,
      );
    }
    throw error;
  }

  const registeredCounts = await countRegisteredByEventDay(c.env.DB, event.id);

  const allowedSessionTypes = resolveEventSessionTypes(event.settings_json).map((sessionType) => sessionType.label);

  return json(
    eventFormsResponseSchema.parse({
      event: { id: event.id, slug: event.slug, name: event.name },
      purpose,
      form,
      allowedSessionTypes,
      requiredTerms: requiredTerms.map((term) => ({
        termKey: term.term_key,
        version: term.version,
        required: term.required === 1,
        contentRef: term.content_ref,
        displayText: term.display_text,
        helpText: term.help_text ?? null,
      })),
      eventDays: eventDays.map((day) => ({
        dayDate: day.day_date,
        label: day.label,
        inPersonCapacity: day.in_person_capacity,
        sortOrder: day.sort_order,
        attendanceOptions: resolveAttendanceOptions(day).map((option) => {
          const capacity = option.capacity ?? null;
          const registered = registeredCounts.get(day.id)?.get(option.value) ?? 0;
          const spotsRemainingPercent =
            capacity != null && capacity > 0 ? Math.round(((capacity - registered) / capacity) * 100) : null;
          return { value: option.value, label: option.label, spotsRemainingPercent };
        }),
      })),
    }),
  );
}

export const EventFormsGet = openApiRoute(eventFormsGetRouteSchema, async (c: any, data) =>
  getEventForm(c, data.query.purpose),
);

export async function onRequestGet(c: any): Promise<Response> {
  const parsed = eventFormsGetRouteSchema.request.query.safeParse(
    Object.fromEntries(new URL(c.req.raw.url).searchParams),
  );
  if (!parsed.success) {
    return json({ error: { code: "VALIDATION_ERROR", message: "Invalid form purpose" } }, 400);
  }
  return getEventForm(c, parsed.data.purpose);
}

export async function onRequest(c: any): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet });
}

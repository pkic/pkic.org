import { json } from "../../../../_lib/http";
import { getActiveFormByPurpose } from "../../../../_lib/services/forms";
import { getEventBySlug, getRequiredTerms } from "../../../../_lib/services/events";
import { countRegisteredByEventDay, listEventDays, resolveAttendanceOptions } from "../../../../_lib/services/event-days";
import { parseJsonSafe } from "../../../../_lib/utils/json";
import { logError } from "../../../../_lib/logging";
import type { PagesContext } from "../../../../_lib/types";

type FormsPurpose = "event_registration" | "proposal_submission";

function resolvePurpose(value: string | null): FormsPurpose | null {
  if (!value) {
    return "event_registration";
  }

  if (value === "event_registration" || value === "proposal_submission") {
    return value;
  }

  return null;
}

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("no such table");
}

export async function onRequestGet(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  const purpose = resolvePurpose(new URL(context.request.url).searchParams.get("purpose"));
  if (!purpose) {
    return json(
      { error: { code: "VALIDATION_ERROR", message: "purpose must be event_registration or proposal_submission" } },
      400,
    );
  }

  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const audience = purpose === "proposal_submission" ? "speaker" : "attendee";

  let form = null;
  let requiredTerms = [] as Awaited<ReturnType<typeof getRequiredTerms>>;
  let eventDays = [] as Awaited<ReturnType<typeof listEventDays>>;

  try {
    form = await getActiveFormByPurpose(context.env.DB, event.id, purpose);
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
    requiredTerms = await getRequiredTerms(context.env.DB, event.id, audience);
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
    eventDays = await listEventDays(context.env.DB, event.id);
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

  const registeredCounts = await countRegisteredByEventDay(context.env.DB, event.id);

  const eventSettings = parseJsonSafe<{ proposal?: { sessionTypes?: string[] } }>(event.settings_json, {});
  const allowedSessionTypes: string[] =
    Array.isArray(eventSettings.proposal?.sessionTypes) && eventSettings.proposal.sessionTypes.length > 0
      ? eventSettings.proposal.sessionTypes
      : ["talk", "keynote", "panel"];

  return json({
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
          capacity != null && capacity > 0
            ? Math.round(((capacity - registered) / capacity) * 100)
            : null;
        return { value: option.value, label: option.label, spotsRemainingPercent };
      }),
    })),
  });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestGet(context);
}

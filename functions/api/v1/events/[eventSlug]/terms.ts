import { json } from "../../../../_lib/http";
import { getEventBySlug, getRequiredTerms } from "../../../../_lib/services/events";
import type { PagesContext } from "../../../../_lib/types";

export async function onRequestGet(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  const audience = new URL(context.request.url).searchParams.get("audience") === "speaker" ? "speaker" : "attendee";
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const terms = await getRequiredTerms(context.env.DB, event.id, audience);
  return json({
    event: { id: event.id, slug: event.slug, name: event.name },
    audience,
    terms: terms.map((term) => ({
      termKey: term.term_key,
      version: term.version,
      required: term.required === 1,
      contentRef: term.content_ref,
      displayText: term.display_text,
      helpText: term.help_text ?? null,
    })),
  });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestGet(context);
}

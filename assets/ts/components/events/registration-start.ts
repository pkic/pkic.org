/**
 * Tells the server, once per event and page load, that a signed-in person
 * started filling in the registration form, so an unfinished registration can
 * be reminded. Nothing depends on the answer.
 */
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { postJson } from "../../shared/api-client";

const started = new Set<string>();

export function markRegistrationStarted(apiBase: string, eventSlug: string): void {
  if (started.has(eventSlug)) return;
  started.add(eventSlug);
  postJson(
    `${apiBase}/events/${encodeURIComponent(eventSlug)}/registrations/unfinished`,
    {},
    successResponseSchema,
  ).catch(() => started.delete(eventSlug));
}

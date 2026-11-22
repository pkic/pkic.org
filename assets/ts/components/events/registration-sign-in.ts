/**
 * What event registration hands the sign-in card: its own progress and the
 * name of the event the person came to register for. The card loads this on
 * demand and knows nothing else about registration.
 */
import { eventDetailResponseSchema } from "../../../shared/schemas/event-management";
import { requestJson } from "../../shared/api-client";

export { RegistrationProgress } from "./RegistrationProgress";

/**
 * The event's public name, or null when the event cannot be read. Read while
 * signed out, so the response must not enter the browser cache: the event app
 * reads the same URL once signed in, and a cached signed-out copy would show
 * the person as not registered.
 */
export async function registrationEventName(eventSlug: string): Promise<string | null> {
  try {
    const { event } = await requestJson(`/api/v1/events/${encodeURIComponent(eventSlug)}`, eventDetailResponseSchema, {
      method: "GET",
      cache: "no-store",
    });
    return event.name;
  } catch {
    return null;
  }
}

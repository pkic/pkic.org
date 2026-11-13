/**
 * What event registration hands the sign-in card: its own progress and the
 * name of the event the person came to register for. The card loads this on
 * demand and knows nothing else about registration.
 */
import { eventDetailResponseSchema } from "../../../shared/schemas/event-management";
import { getJson } from "../../shared/api-client";

export { RegistrationProgress } from "./RegistrationProgress";

/** The event's public name, or null when the event cannot be read. */
export async function registrationEventName(eventSlug: string): Promise<string | null> {
  try {
    const { event } = await getJson(`/api/v1/events/${encodeURIComponent(eventSlug)}`, eventDetailResponseSchema);
    return event.name;
  } catch {
    return null;
  }
}

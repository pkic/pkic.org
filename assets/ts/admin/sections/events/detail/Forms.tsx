import { EventFormResponses as SharedEventFormResponses } from "../../../../components/forms/management/FormManagement";
import type { EventFormsPurpose } from "../../../../../shared/schemas/forms";

/** Temporary event adapter for the shared form-management surface. */
export function EventFormResponses({ slug, purpose }: { slug: string; purpose: EventFormsPurpose }) {
  return <SharedEventFormResponses eventSlug={slug} purpose={purpose} />;
}

/** The portal embeds the same registration flow as the public registration page. */
import { eventFormsResponseSchema } from "../../../shared/schemas/forms";
import type { RegistrationSubmissionResponse } from "../../../shared/schemas/registration";
import { useData } from "../../hooks/useData";
import { getJson } from "../../shared/api-client";
import { parseQueryContext } from "../../shared/query-context";
import { Alert } from "../../ui/Alert";
import { Spinner } from "../Spinner";
import { RegistrationFlow } from "./RegistrationFlow";

export function EventRegistrationCreate({
  slug,
  onRegistered,
}: {
  slug: string;
  onRegistered: (result: RegistrationSubmissionResponse) => Promise<void>;
}) {
  const loaded = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/forms/placements/event_registration`,
        eventFormsResponseSchema,
      ),
    [slug],
  );
  if (loaded.loading) return <Spinner label="Loading registration…" />;
  if (!loaded.data) return <Alert tone="danger">{loaded.error}</Alert>;
  return (
    <RegistrationFlow
      mode="create"
      autoSession
      forms={loaded.data}
      context={{ eventSlug: slug, apiBase: "/api/v1", eventPagePath: null, query: parseQueryContext("") }}
      onRegistered={onRegistered}
    />
  );
}

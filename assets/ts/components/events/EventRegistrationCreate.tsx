/** The portal embeds the same registration flow as the public registration page. */
import { useRef } from "preact/hooks";
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
  entrySearch = "",
  onRegistered,
}: {
  slug: string;
  /** The query of the link that opened registration (`invite`, `id`, `ref`, `source`), so the invitation stays attached. */
  entrySearch?: string;
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
  const query = parseQueryContext(entrySearch);
  // The invitation gate is built on mount, so another invitation in the link starts the flow afresh.
  // Dropping a refused invitation, or any other query change such as the step, keeps the form.
  const invitationKey = useRef("");
  if (query.inviteToken || query.inviteId) invitationKey.current = `${query.inviteToken ?? ""}:${query.inviteId ?? ""}`;
  if (loaded.loading) return <Spinner label="Loading registration…" />;
  if (!loaded.data) return <Alert tone="danger">{loaded.error}</Alert>;
  return (
    <RegistrationFlow
      key={invitationKey.current}
      mode="create"
      autoSession
      forms={loaded.data}
      context={{ eventSlug: slug, apiBase: "/api/v1", eventPagePath: null, query }}
      onRegistered={onRegistered}
    />
  );
}

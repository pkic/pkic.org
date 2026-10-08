import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { Button } from "../../../../../../ui/Button";
import { sitePublicationRequestListSchema } from "../../../../../../../shared/schemas/site-publication-requests";

const deliveryLabels = {
  queued: "Website update queued",
  rendering: "Website update in progress",
  awaiting_activation: "Website update built; activation pending",
  delivered: "Website update published",
  failed: "Website update failed; publication needs attention",
  obsolete: "This update was superseded",
} as const;

export function AgendaDeliveryStatus({ slug, revision }: { slug: string; revision: number }) {
  const state = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/publication-requests?limit=1&sort=-sequence`,
        sitePublicationRequestListSchema,
      ),
    [slug, revision],
  );
  const latest = state.data?.requests?.[0];
  return (
    <div class="pk-cluster" role="status" aria-live="polite">
      <span>
        {state.error
          ? "Website delivery status is unavailable"
          : latest
            ? latest.documentEffects.length && !latest.documentEffectsCompletedAt
              ? "Public download withdrawal is pending; retry will continue"
              : deliveryLabels[latest.status]
            : state.loading
              ? "Checking website delivery…"
              : "No website delivery has been recorded"}
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={state.loading || state.refreshing}
        onClick={() => void state.reload()}
      >
        Refresh delivery status
      </Button>
    </div>
  );
}

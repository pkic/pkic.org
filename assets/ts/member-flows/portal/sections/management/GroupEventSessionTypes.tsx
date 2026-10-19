import { eventManagementDetailResponseSchema } from "../../../../../shared/schemas/event-management";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { GeneralTab } from "../events/detail/settings/GeneralTab";

/** Session type configuration uses the complete event read model and its existing settings contract. */
export function GroupEventSessionTypes({
  slug,
  groupId,
  eventId,
  canEdit,
  onUpdated,
}: {
  slug: string;
  groupId: string;
  eventId: string;
  canEdit: boolean;
  onUpdated?: () => void | Promise<void>;
}) {
  const detail = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}`, eventManagementDetailResponseSchema),
    [slug],
  );
  if (detail.loading) return <Spinner label="Loading session types…" />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data) return null;
  return (
    <GeneralTab
      event={detail.data.event}
      section="session-types"
      groupSettings={{
        groupId,
        eventId,
        canEdit,
        onSaved: async () => {
          await detail.reload();
          await onUpdated?.();
        },
      }}
      onUpdated={() => {
        void detail.reload();
        void onUpdated?.();
      }}
    />
  );
}

import { eventManagementDetailResponseSchema } from "../../../../../shared/schemas/event-management";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { GeneralTab } from "../events/detail/settings/GeneralTab";
import { ProposalCallSettings } from "../events/detail/settings/ProposalCallSettings";

export function GroupEventSettingsSection({
  slug,
  onUpdated,
  section = "cfp",
  groupSettings,
}: {
  slug: string;
  section?: "cfp" | "general" | "location" | "registration";
  onUpdated?: () => void | Promise<void>;
  groupSettings?: { groupId: string; eventId: string; canEdit: boolean };
}) {
  const detail = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}`, eventManagementDetailResponseSchema),
    [slug],
  );
  if (detail.loading) return <Spinner label="Loading event settings…" />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data) return null;
  const updated = () => {
    void detail.reload();
    void onUpdated?.();
  };
  if (section !== "cfp")
    return (
      <GeneralTab
        event={detail.data.event}
        section={section}
        onUpdated={updated}
        groupSettings={
          groupSettings
            ? {
                ...groupSettings,
                onSaved: async (savedSlug) => {
                  await onUpdated?.();
                  if (!savedSlug || savedSlug === slug) await detail.reload();
                },
              }
            : undefined
        }
      />
    );
  return (
    <ProposalCallSettings
      event={detail.data.event}
      groupSettings={groupSettings ? { ...groupSettings, onSaved: updated } : undefined}
      onUpdated={() => {
        void detail.reload();
        void onUpdated?.();
      }}
    />
  );
}

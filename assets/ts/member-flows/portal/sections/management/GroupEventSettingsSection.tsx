import { readEventSettings } from "./event-settings-detail";
import { useData } from "../../../../hooks/useData";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { GeneralTab } from "../events/detail/settings/GeneralTab";
import { InvitationSettingsTab } from "../events/detail/settings/InvitationSettingsTab";
import { ProposalCallSettings } from "../events/detail/settings/ProposalCallSettings";

export function GroupEventSettingsSection({
  slug,
  onUpdated,
  section = "cfp",
  groupSettings,
}: {
  slug: string;
  section?: "cfp" | "general" | "location" | "registration" | "invitation";
  onUpdated?: () => void | Promise<void>;
  groupSettings?: { groupId: string; eventId: string; canEdit: boolean };
}) {
  const detail = useData(() => readEventSettings(slug, groupSettings?.groupId), [slug, groupSettings?.groupId]);
  if (detail.loading) return <Spinner label="Loading event settings…" />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data) return null;
  const updated = async () => {
    await detail.reload();
    await onUpdated?.();
  };
  if (section === "invitation")
    return (
      <InvitationSettingsTab
        event={detail.data.event}
        onUpdated={() => void updated()}
        groupTarget={groupSettings ? { ...groupSettings, onSaved: updated } : undefined}
      />
    );
  if (section !== "cfp")
    return (
      <GeneralTab
        event={detail.data.event}
        section={section}
        onUpdated={() => {
          void updated();
        }}
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

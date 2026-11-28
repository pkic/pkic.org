/**
 * The event settings kept on the Retention tab. They are read once and shared, so a save from
 * one panel gives the other the event's new version instead of leaving it to conflict.
 */
import { eventLiveChatSettings } from "../../../../../../../shared/live-chat-retention";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../ui/Spinner";
import { hasEventAgendaPermission } from "../../event-agenda-access";
import { LiveChatArchive } from "./LiveChatArchive";
import { LiveChatRetentionPanel } from "./LiveChatRetentionPanel";
import { RegistrationRetentionPanel } from "./RegistrationRetentionPanel";
import { useLoadedEventSettings, type EventSettingsSectionProps } from "./useLoadedEventSettings";

export function EventRetentionSettings({ slug, groupId, canEdit }: EventSettingsSectionProps) {
  const { event, error, onUpdated, groupTarget } = useLoadedEventSettings(slug, groupId);
  if (error) return <ErrorAlert error={error} />;
  if (!event) return <Spinner label="Loading retention settings…" />;
  // Each panel restarts only when its own saved value changes, so a save from the other panel keeps an open draft.
  return (
    <>
      <RegistrationRetentionPanel
        key={`registration-${event.userRetentionDays ?? "unset"}`}
        event={event}
        canEdit={canEdit}
        onUpdated={onUpdated}
        groupTarget={groupTarget}
      />
      <LiveChatRetentionPanel
        key={`chat-${eventLiveChatSettings(event.settings).keepDays}`}
        event={event}
        canEdit={canEdit}
        onUpdated={onUpdated}
        groupTarget={groupTarget}
      />
      {/* The kept chat is downloaded and erased beside the choice of how long it is kept, by the event's organizers. */}
      {hasEventAgendaPermission(event.id, "events:write") ? <LiveChatArchive slug={slug} /> : null}
    </>
  );
}

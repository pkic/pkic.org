/**
 * How long the event's live rooms keep their attendee chat after each
 * session: the week every room keeps, or 90 days so organizers can download
 * it for the event's records.
 */
import { useState } from "preact/hooks";
import {
  eventLiveChatSettings,
  LIVE_CHAT_KEEP_DAYS,
  type EventLiveChatSettings,
} from "../../../../../../../shared/live-chat-retention";
import { eventSettingsUpdateSchema, type EventDetail } from "../../../../../../../shared/schemas/event-management";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useData } from "../../../../../../hooks/useData";
import { Alert } from "../../../../../../ui/Alert";
import { Radio } from "../../../../../../ui/Checkbox";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { EditActions } from "../../../../../../ui/EditActions";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Spinner } from "../../../../../../ui/Spinner";
import { readEventSettings } from "../../../management/event-settings-detail";
import { useEventSettingsSave } from "./useEventSettingsSave";

type KeepDays = EventLiveChatSettings["keepDays"];

const CHOICES: Record<KeepDays, { label: string; hint: string }> = {
  7: { label: "1 week", hint: "The chat goes with the rest of the session's live room." },
  90: {
    label: "90 days",
    hint: "Only the attendee chat stays, so live moderators can download it from Studio settings. Polls, questions, and the operator chat still go after a week.",
  },
};

export function LiveChatRetentionSettings({
  slug,
  groupId,
  canEdit,
}: {
  slug: string;
  groupId?: string;
  /** Who may change the event's settings; everyone else reads the choice. */
  canEdit: boolean;
}) {
  const loaded = useData(() => readEventSettings(slug, groupId), [slug, groupId]);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const current = event ?? loaded.data?.event ?? null;
  if (loaded.error) return <ErrorAlert error={loaded.error} />;
  if (!current) return <Spinner label="Loading chat settings…" />;
  return (
    <LiveChatRetentionPanel
      key={current.updatedAt}
      event={current}
      canEdit={canEdit}
      onUpdated={setEvent}
      groupTarget={
        groupId
          ? { groupId, eventId: current.id, canEdit: true, onSaved: () => loaded.reload().then(() => setEvent(null)) }
          : undefined
      }
    />
  );
}

function LiveChatRetentionPanel({
  event,
  canEdit,
  onUpdated,
  groupTarget,
}: {
  event: EventDetail;
  canEdit: boolean;
  onUpdated: (event: EventDetail) => void;
  groupTarget?: Parameters<typeof useEventSettingsSave>[3];
}) {
  const saved = eventLiveChatSettings(event.settings).keepDays;
  const [keepDays, setKeepDays] = useState<KeepDays>(saved);
  const form = useContractForm(eventSettingsUpdateSchema, {
    expectedUpdatedAt: event.updatedAt,
    liveChat: { keepDays },
  });
  const { editing, setEditing, saving, error, setError, save } = useEventSettingsSave(
    event.slug,
    form,
    onUpdated,
    groupTarget,
  );
  function reset() {
    setKeepDays(saved);
    form.reset();
    setError("");
  }
  return (
    <Panel aria-label="Live chat">
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader title="Live chat">
          {canEdit && (
            <EditActions
              label="Live chat settings actions"
              editing={editing}
              saving={saving}
              saveLabel="Save chat settings"
              onEdit={() => {
                reset();
                setEditing(true);
              }}
              onCancel={() => {
                reset();
                setEditing(false);
              }}
            />
          )}
        </PanelHeader>
        <PanelBody class="pk-stack">
          {editing && canEdit ? (
            <Field
              group
              {...form.of("liveChat.keepDays")}
              label="Keep the attendee chat after each session for"
              help="A shorter choice takes effect within a day, including for sessions that have already ended."
            >
              {(control) => (
                <div class="pk-stack">
                  {LIVE_CHAT_KEEP_DAYS.map((days) => (
                    <Radio
                      key={days}
                      name="liveChatKeepDays"
                      value={String(days)}
                      label={CHOICES[days].label}
                      hint={CHOICES[days].hint}
                      checked={keepDays === days}
                      aria-describedby={control["aria-describedby"]}
                      aria-invalid={control["aria-invalid"]}
                      onChange={() => setKeepDays(days)}
                    />
                  ))}
                </div>
              )}
            </Field>
          ) : (
            <DescriptionList
              items={[{ term: "Attendee chat kept", value: `${CHOICES[saved].label} after each session` }]}
            />
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </PanelBody>
      </form>
    </Panel>
  );
}

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
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { Radio } from "../../../../../../ui/Checkbox";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { EditActions } from "../../../../../../ui/EditActions";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { useEventSettingsSave, type EventSettingsGroupTarget } from "./useEventSettingsSave";

type KeepDays = EventLiveChatSettings["keepDays"];

const CHOICES: Record<KeepDays, { label: string; hint: string }> = {
  7: { label: "1 week", hint: "The chat goes with the rest of the session's live room." },
  90: {
    label: "90 days",
    hint: "Only the attendee chat stays, with its reports and the classifier's scores, so organizers can download it. Polls, questions, and the operator chat still go after a week.",
  },
};

export function LiveChatRetentionPanel({
  event,
  canEdit,
  onUpdated,
  groupTarget,
}: {
  event: EventDetail;
  canEdit: boolean;
  onUpdated: (event: EventDetail) => void;
  groupTarget?: EventSettingsGroupTarget;
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

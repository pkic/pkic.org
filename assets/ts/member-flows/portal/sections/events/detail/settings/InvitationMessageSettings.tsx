/**
 * The event's invitation wording: the headline and message an invited person
 * reads on their Home card, in the invitation dialog, and in the invitation
 * email. Left empty, they read a neutral line built from the event's name.
 */
import { useState } from "preact/hooks";
import { eventInvitationWording } from "../../../../../../../shared/event-invitation-copy";
import { eventSettingsUpdateSchema, type EventDetail } from "../../../../../../../shared/schemas/event-management";
import {
  EVENT_INVITATION_HEADLINE_MAX,
  EVENT_INVITATION_MESSAGE_MAX,
} from "../../../../../../../shared/schemas/event-invitation-message";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useEventSettingsSave, type EventSettingsGroupTarget } from "./useEventSettingsSave";
import { Alert } from "../../../../../../ui/Alert";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { EditActions } from "../../../../../../ui/EditActions";
import { Field } from "../../../../../../ui/Field";
import { Markdown } from "../../../../../../ui/Markdown";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Textarea, TextInput } from "../../../../../../ui/TextControl";

function orNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

export function InvitationMessageSettings({
  event,
  onUpdated,
  groupTarget,
}: {
  event: EventDetail;
  onUpdated: (event: EventDetail) => void;
  /** A group event saves through its group's settings endpoint. */
  groupTarget?: EventSettingsGroupTarget;
}) {
  const saved = event.invitationMessage ?? null;
  const [headline, setHeadline] = useState(saved?.headline ?? "");
  const [message, setMessage] = useState(saved?.message ?? "");
  // The revision this draft started from, so a save made elsewhere meanwhile is refused, not overwritten.
  const [basedOn, setBasedOn] = useState(event.updatedAt);
  const form = useContractForm(eventSettingsUpdateSchema, {
    expectedUpdatedAt: basedOn,
    invitationMessage: { headline: orNull(headline), message: orNull(message) },
  });
  const { editing, setEditing, saving, error, setError, save } = useEventSettingsSave(
    event.slug,
    form,
    onUpdated,
    groupTarget,
  );
  const canEdit = groupTarget ? groupTarget.canEdit : event.capabilities.includes("write");
  const shown = eventInvitationWording(event, saved);
  function reset() {
    setBasedOn(event.updatedAt);
    setHeadline(saved?.headline ?? "");
    setMessage(saved?.message ?? "");
    form.reset();
    setError("");
  }
  return (
    <Panel aria-label="Invitation message">
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader title="Invitation message">
          {canEdit && (
            <EditActions
              label="Invitation message actions"
              editing={editing}
              saving={saving}
              saveLabel="Save invitation message"
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
          {editing ? (
            <>
              <Field
                {...form.of("invitationMessage.headline")}
                label="Headline"
                help={`Up to ${EVENT_INVITATION_HEADLINE_MAX} characters. Leave empty to use "${eventInvitationWording(event, null).headline}".`}
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="invitationMessage.headline"
                    maxLength={EVENT_INVITATION_HEADLINE_MAX}
                    value={headline}
                    onInput={(inputEvent) => setHeadline(inputEvent.currentTarget.value)}
                  />
                )}
              </Field>
              <Field
                {...form.of("invitationMessage.message")}
                label="Message"
                help={`A few lines on why to attend. Markdown is supported. Up to ${EVENT_INVITATION_MESSAGE_MAX} characters.`}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    name="invitationMessage.message"
                    rows={6}
                    maxLength={EVENT_INVITATION_MESSAGE_MAX}
                    value={message}
                    onInput={(inputEvent) => setMessage(inputEvent.currentTarget.value)}
                  />
                )}
              </Field>
            </>
          ) : (
            <DescriptionList
              items={[
                {
                  term: "Headline",
                  value: (
                    <>
                      {shown.headline}
                      {!saved?.headline && <span class="pk-muted"> (default)</span>}
                    </>
                  ),
                },
                {
                  term: "Message",
                  value: shown.message ? <Markdown markdown={shown.message} profile="text" /> : "No message.",
                },
              ]}
            />
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </PanelBody>
      </form>
    </Panel>
  );
}

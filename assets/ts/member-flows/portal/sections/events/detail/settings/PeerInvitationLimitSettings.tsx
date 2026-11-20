/**
 * The peer invitation limit: how many colleagues each registered attendee can
 * invite through "Invite a colleague". Zero turns peer invitations off.
 */
import { useState } from "preact/hooks";
import { formatNumber } from "../../../../../../../shared/format-number";
import { eventSettingsUpdateSchema, type EventDetail } from "../../../../../../../shared/schemas/event-management";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useEventSettingsSave, type EventSettingsGroupTarget } from "./useEventSettingsSave";
import { Alert } from "../../../../../../ui/Alert";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { EditActions } from "../../../../../../ui/EditActions";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { TextInput } from "../../../../../../ui/TextControl";

export function PeerInvitationLimitSettings({
  event,
  onUpdated,
  groupTarget,
}: {
  event: EventDetail;
  onUpdated: (event: EventDetail) => void;
  /** A group event saves through its group's settings endpoint. */
  groupTarget?: EventSettingsGroupTarget;
}) {
  const saved = event.inviteLimitAttendee;
  const [limit, setLimit] = useState(String(saved));
  // The revision this draft started from, so a save made elsewhere meanwhile is refused, not overwritten.
  const [basedOn, setBasedOn] = useState(event.updatedAt);
  const form = useContractForm(eventSettingsUpdateSchema, {
    expectedUpdatedAt: basedOn,
    inviteLimitAttendee: limit.trim() === "" ? undefined : Number(limit),
  });
  const { editing, setEditing, saving, error, setError, save } = useEventSettingsSave(
    event.slug,
    form,
    onUpdated,
    groupTarget,
  );
  const canEdit = groupTarget ? groupTarget.canEdit : event.capabilities.includes("write");
  function reset() {
    setBasedOn(event.updatedAt);
    setLimit(String(saved));
    form.reset();
    setError("");
  }
  return (
    <Panel aria-label="Peer invitations">
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader title="Peer invitations">
          {canEdit && (
            <EditActions
              label="Peer invitation actions"
              editing={editing}
              saving={saving}
              saveLabel="Save peer invitation limit"
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
            <Field
              {...form.of("inviteLimitAttendee")}
              label="Peer invitation limit"
              help="How many colleagues each registered attendee can invite, up to 50. Enter 0 to turn peer invitations off."
              required
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="inviteLimitAttendee"
                  type="number"
                  inputMode="numeric"
                  value={limit}
                  onInput={(inputEvent) => setLimit(inputEvent.currentTarget.value)}
                />
              )}
            </Field>
          ) : (
            <DescriptionList
              items={[
                {
                  term: "Peer invitation limit",
                  value: saved === 0 ? "Off" : `${formatNumber(saved)} per attendee`,
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

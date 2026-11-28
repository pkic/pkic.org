/**
 * How many days after the event ends its registration data is kept: the window in
 * which sponsors can view and download their sponsor leads, after which the
 * registrations are due for removal.
 */
import { useState } from "preact/hooks";
import { formatNumber } from "../../../../../../../shared/format-number";
import { eventSettingsUpdateSchema, type EventDetail } from "../../../../../../../shared/schemas/event-management";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { EditActions } from "../../../../../../ui/EditActions";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { TextInput } from "../../../../../../ui/TextControl";
import { useEventSettingsSave, type EventSettingsGroupTarget } from "./useEventSettingsSave";

export function RegistrationRetentionPanel({
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
  const saved = event.userRetentionDays;
  const [days, setDays] = useState(saved ? String(saved) : "");
  const form = useContractForm(eventSettingsUpdateSchema, {
    expectedUpdatedAt: event.updatedAt,
    // A blank period is sent as null so the contract refuses it: the period can be changed, not removed.
    userRetentionDays: days.trim() ? Number(days) : null,
  });
  const { editing, setEditing, saving, error, setError, save } = useEventSettingsSave(
    event.slug,
    form,
    onUpdated,
    groupTarget,
  );
  function reset() {
    setDays(saved ? String(saved) : "");
    form.reset();
    setError("");
  }
  return (
    <Panel aria-label="Registration data">
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader title="Registration data">
          {canEdit && (
            <EditActions
              label="Registration data settings actions"
              editing={editing}
              saving={saving}
              saveLabel="Save registration data settings"
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
          <p>
            Sponsors can download their sponsor leads, and organizers can see attendee contact details, until this many
            days after the event ends. After that, the event&rsquo;s registrations are due for removal. A longer period
            can&rsquo;t reopen access that has already ended.
          </p>
          {editing && canEdit ? (
            <fieldset class="pk-fieldset" disabled={saving}>
              <Field {...form.of("userRetentionDays")} label="Days after the event ends">
                {(control) => (
                  <TextInput
                    {...control}
                    name="userRetentionDays"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={days}
                    placeholder="Not set"
                    onInput={(inputEvent) => setDays(inputEvent.currentTarget.value)}
                  />
                )}
              </Field>
            </fieldset>
          ) : (
            <DescriptionList
              items={[
                {
                  term: "Registration data kept",
                  value: saved ? `${formatNumber(saved)} days after the event ends` : "Not set",
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

/**
 * The event's attendance settings: how long someone has to stay in a session
 * for their check-in to count toward it.
 */
import { useState } from "preact/hooks";
import { eventAttendanceSettings, MINIMUM_STAY_PERCENT } from "../../../../../../../shared/attendance-attribution";
import { eventSettingsUpdateSchema, type EventDetail } from "../../../../../../../shared/schemas/event-management";
import { formatNumber } from "../../../../../../../shared/format-number";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useEventSettingsSave } from "./useEventSettingsSave";
import { Alert } from "../../../../../../ui/Alert";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { EditActions } from "../../../../../../ui/EditActions";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { TextInput } from "../../../../../../ui/TextControl";

export function AttendanceSettings({
  event,
  onUpdated,
}: {
  event: EventDetail;
  onUpdated: (event: EventDetail) => void;
}) {
  const saved = eventAttendanceSettings(event.settings).minimumStayPercent;
  const [percent, setPercent] = useState(String(saved));
  const form = useContractForm(eventSettingsUpdateSchema, {
    expectedUpdatedAt: event.updatedAt,
    attendance: { minimumStayPercent: percent.trim() === "" ? undefined : Number(percent) },
  });
  const { editing, setEditing, saving, error, setError, save } = useEventSettingsSave(event.slug, form, onUpdated);
  function reset() {
    setPercent(String(saved));
    form.reset();
    setError("");
  }
  return (
    <Panel aria-label="Attendance">
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader title="Session attendance">
          {event.capabilities.includes("write") && (
            <EditActions
              label="Attendance settings actions"
              editing={editing}
              saving={saving}
              saveLabel="Save attendance settings"
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
              {...form.of("attendance.minimumStayPercent")}
              label="Minimum stay (% of the session)"
              help={`A check-in counts toward a session only when the person stays for at least this share of its scheduled length, from ${MINIMUM_STAY_PERCENT.min}% to ${MINIMUM_STAY_PERCENT.max}%. Shorter visits still appear in Movement, marked too short to count.`}
              required
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="minimumStayPercent"
                  type="number"
                  inputMode="numeric"
                  value={percent}
                  onInput={(inputEvent) => setPercent(inputEvent.currentTarget.value)}
                />
              )}
            </Field>
          ) : (
            <DescriptionList
              items={[
                {
                  term: "Minimum stay",
                  value: `${formatNumber(saved)}% of the session`,
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

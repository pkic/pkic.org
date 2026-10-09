import { agendaReminderMinuteChoices } from "../../../../../../../shared/schemas/event-agenda-calendar";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { EventPushNotifications } from "../../../../notifications/EventPushNotifications";
import type { useEventPushNotifications } from "../../../../notifications/useEventPushNotifications";
import type { AgendaCalendarAutosave } from "./useAgendaCalendarAutosave";

function leadTime(minutes: number) {
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour before" : `${minutes / 60} hours before`;
  return minutes === 1 ? "1 minute before" : `${minutes} minutes before`;
}

/** Email and, where it works, this device: both remind the same time before a session. */
export function AgendaReminders({
  autosave,
  push,
}: {
  autosave: AgendaCalendarAutosave;
  push: ReturnType<typeof useEventPushNotifications>;
}) {
  const { settings, form, saving, change } = autosave;
  const pushOn = push.state === "on";
  const choices = [...new Set([...agendaReminderMinuteChoices, settings.reminderMinutes])].sort((a, b) => a - b);
  return (
    <Panel aria-label="Reminders">
      <PanelHeader title="Reminders" />
      <PanelBody class="pk-stack" {...form.handlers}>
        <Checkbox
          role="switch"
          name="reminderEnabled"
          label="Email me before my sessions"
          checked={settings.reminderEnabled}
          disabled={saving}
          onChange={(event) => change({ reminderEnabled: event.currentTarget.checked })}
        />
        <EventPushNotifications push={push} reminderMinutes={settings.reminderMinutes} />
        {(settings.reminderEnabled || pushOn) && (
          <Field label="When" {...form.of("reminderMinutes")}>
            {(control) => (
              <Select
                {...control}
                name="reminderMinutes"
                value={String(settings.reminderMinutes)}
                disabled={saving || push.busy}
                onChange={(event) => {
                  const reminderMinutes = Number(event.currentTarget.value);
                  change({ reminderMinutes });
                  if (pushOn) void push.enable(reminderMinutes);
                }}
              >
                {choices.map((minutes) => (
                  <option key={minutes} value={String(minutes)}>
                    {leadTime(minutes)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </PanelBody>
    </Panel>
  );
}

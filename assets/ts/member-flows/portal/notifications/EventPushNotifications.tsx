import { eventWebPushRegisterSchema } from "../../../../shared/schemas/event-web-push";
import { useContractForm } from "../../../hooks/useContractForm";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { TextInput } from "../../../ui/TextControl";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { useEventPushNotifications } from "./useEventPushNotifications";
const preferencesSchema = eventWebPushRegisterSchema.pick({ reminderMinutes: true });
export function EventPushNotifications({ slug }: { slug: string }) {
  const push = useEventPushNotifications(slug);
  const form = useContractForm(preferencesSchema, { reminderMinutes: push.reminderMinutes });
  return (
    <section aria-label="Browser notifications">
      <h3>Browser notifications</h3>
      <p>
        Get reminders and schedule changes on this device. Notifications show a general message; open the portal for
        details. Your email preferences stay the same.
      </p>
      {push.state === "loading" ? (
        <p role="status">Loading notification settings…</p>
      ) : push.state === "unsupported" ? (
        <p>This browser cannot receive notifications here. You can still use email reminders.</p>
      ) : push.state === "unavailable" ? (
        <p>Browser notifications are not available yet. You can still use email reminders.</p>
      ) : push.state === "error" ? (
        <Button type="button" onClick={push.reload}>
          Retry notification settings
        </Button>
      ) : (
        <form
          noValidate
          {...form.handlers}
          onSubmit={(event) => {
            event.preventDefault();
            const checked = form.submit();
            if (checked.data) void push.enable(checked.data.reminderMinutes);
          }}
        >
          <p role="status">
            {push.state === "on"
              ? "Notifications are enabled for this event on this device."
              : "Notifications are off for this event on this device."}
          </p>
          <Field label="Minutes before a session" {...form.of("reminderMinutes")}>
            {(control) => (
              <TextInput
                {...control}
                type="number"
                name="reminderMinutes"
                value={push.reminderMinutes}
                onInput={(event) => push.setReminderMinutes(event.currentTarget.valueAsNumber)}
              />
            )}
          </Field>
          <Button type="submit" loading={push.busy}>
            {push.state === "on" ? "Save notification timing" : "Enable on this device"}
          </Button>
          {push.state === "on" && (
            <Button type="button" disabled={push.busy} onClick={() => void push.disable()}>
              Disable for this event
            </Button>
          )}
        </form>
      )}
      {push.error && <ErrorAlert error={push.error} />}
    </section>
  );
}

import { Checkbox } from "../../../ui/Checkbox";
import { ErrorAlert } from "../../../components/ErrorAlert";
import type { useEventPushNotifications } from "./useEventPushNotifications";

/**
 * This device's notifications for one event, as one switch. It appears only where it can work: a browser
 * that supports push and a server with push configured. Anywhere else the reader sees email reminders only.
 */
export function EventPushNotifications({
  push,
  reminderMinutes,
}: {
  push: ReturnType<typeof useEventPushNotifications>;
  reminderMinutes: number;
}) {
  if (push.state !== "on" && push.state !== "off") return null;
  return (
    <div class="pk-stack pk-stack--snug">
      <Checkbox
        role="switch"
        name="pushEnabled"
        label="Notify me on this device"
        hint="Before your sessions and when your schedule changes."
        checked={push.state === "on"}
        disabled={push.busy}
        aria-busy={push.busy ? "true" : undefined}
        onChange={(event) => void (event.currentTarget.checked ? push.enable(reminderMinutes) : push.disable())}
      />
      {push.error && <ErrorAlert error={push.error} />}
    </div>
  );
}

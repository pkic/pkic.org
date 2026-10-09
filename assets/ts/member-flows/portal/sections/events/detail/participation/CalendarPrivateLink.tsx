import { useState } from "preact/hooks";
import type { AgendaCalendarSettings } from "../../../../../../../shared/schemas/event-agenda-calendar";
import { Button } from "../../../../../../ui/Button";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { toast } from "../../../../ui";
import { copyText } from "../../../../../../shared/clipboard";
import type { AgendaCalendar } from "./useAgendaCalendar";

/** Copies a feed link; the disclosure below always shows it for a manual copy when the browser refuses. */
export function copyCalendarLink(url: string): Promise<boolean> {
  return copyText(url, {
    copied: "Link copied. Paste it where your calendar app asks for a calendar URL.",
    failed: "Copying was blocked. Open “Private calendar link” below to copy it yourself.",
    notify: toast,
  });
}

/** The link itself and what to do if it leaks: kept folded away, since most readers never need it. */
export function CalendarPrivateLink({
  calendar,
  settings,
}: {
  calendar: AgendaCalendar;
  settings: AgendaCalendarSettings;
}) {
  const [busy, setBusy] = useState(false);
  const url = calendar.link?.subscription?.url ?? null;
  const active = Boolean(calendar.link?.active);
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast(done, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Your calendar link could not be changed.", "error");
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    const confirmed = await confirmAction({
      title: "Reset your calendar link?",
      consequences: [
        "Calendars that use the current link stop updating.",
        "Add My agenda to your calendar again to use the new link.",
      ],
      confirmLabel: "Reset link",
    });
    if (confirmed) await run(() => calendar.createLink(settings), "Your calendar link was reset.");
  }
  async function turnOff() {
    const confirmed = await confirmAction({
      title: "Turn off your calendar link?",
      consequences: [
        "Calendars that use the link stop updating.",
        "Remove the calendar from your calendar app to clear its sessions.",
      ],
      confirmLabel: "Turn off link",
    });
    if (confirmed) await run(() => calendar.turnOffLink(), "Your calendar link is turned off.");
  }
  return (
    <details class="pk-calendar-link">
      <summary>Private calendar link</summary>
      <div class="pk-stack pk-calendar-link__body">
        {url ? (
          <Field label="Your link" help="Anyone with this link can see your agenda.">
            {(control) => (
              <TextInput {...control} value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
            )}
          </Field>
        ) : (
          <p>
            {active
              ? "Your calendar link is on. Reset it to see it here."
              : "No link yet. Choose a calendar above to create one."}
          </p>
        )}
        {active && (
          <>
            <p class="pk-calendar-link__note">
              Reset the link if you shared it by accident. The old link stops working.
            </p>
            <div class="pk-cluster">
              {url && (
                <Button type="button" disabled={busy} onClick={() => void copyCalendarLink(url)}>
                  Copy link
                </Button>
              )}
              <Button type="button" disabled={busy} onClick={() => void reset()}>
                Reset link
              </Button>
              <Button type="button" variant="danger-quiet" disabled={busy} onClick={() => void turnOff()}>
                Turn off calendar link
              </Button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

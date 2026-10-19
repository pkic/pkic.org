import type { AgendaCalendarSettings as Settings } from "../../../../../../../shared/schemas/event-agenda-calendar";
import { PageHeader } from "../../../../../../ui/PageHeader";
import { Button } from "../../../../../../ui/Button";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useEventPushNotifications } from "../../../../notifications/useEventPushNotifications";
import { AgendaReminders } from "./AgendaReminders";
import { CalendarSubscription } from "./CalendarSubscription";
import { useAgendaCalendar, type AgendaCalendar } from "./useAgendaCalendar";
import { useAgendaCalendarAutosave } from "./useAgendaCalendarAutosave";

export const AGENDA_CALENDAR_TITLE = "Calendar and reminders";

/**
 * What a participant does with their agenda outside the portal: put it in a calendar app and be
 * reminded before sessions. The event app's tabs lead back to the agenda, so the page has no back link.
 */
export function AgendaCalendarSettings({ slug, eventName }: { slug: string; eventName?: string }) {
  const calendar = useAgendaCalendar(slug);
  const push = useEventPushNotifications(slug);
  return (
    <div class="pk-stack">
      <PageHeader title={AGENDA_CALENDAR_TITLE} />
      {calendar.settings && calendar.link ? (
        <LoadedSettings
          key={slug}
          calendar={calendar}
          settings={calendar.settings}
          push={push}
          calendarName={eventName ? `${eventName} – My agenda` : "My agenda"}
        />
      ) : calendar.error ? (
        <div class="pk-stack">
          <ErrorAlert error={calendar.error} />
          <div class="pk-cluster">
            <Button type="button" onClick={calendar.reload}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <Spinner label="Loading your calendar settings…" />
      )}
    </div>
  );
}

function LoadedSettings({
  calendar,
  settings,
  push,
  calendarName,
}: {
  calendar: AgendaCalendar;
  settings: Settings;
  push: ReturnType<typeof useEventPushNotifications>;
  calendarName: string;
}) {
  const autosave = useAgendaCalendarAutosave(settings, calendar.saveSettings);
  return (
    <>
      <CalendarSubscription calendar={calendar} autosave={autosave} calendarName={calendarName} />
      <AgendaReminders autosave={autosave} push={push} />
    </>
  );
}

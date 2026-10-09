import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import {
  calendarSubscriptionLink,
  calendarSubscriptionProviderDetails,
  calendarSubscriptionProviders,
  type CalendarSubscriptionProvider,
} from "../../../../../../../shared/calendar-subscription-links";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { StrokeIcon } from "../../../../../../ui/MediaIcons";
import { toast } from "../../../../ui";
import { CalendarPrivateLink, copyCalendarLink } from "./CalendarPrivateLink";
import type { AgendaCalendar } from "./useAgendaCalendar";
import type { AgendaCalendarAutosave } from "./useAgendaCalendarAutosave";
import "./AgendaCalendar.css";

const icons: Record<CalendarSubscriptionProvider | "copy", ComponentChildren> = {
  google: <path d="M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3M5.5 9.5h2M5.5 11.5h5" />,
  "outlook-com": <path d="M2 4h12v8.5H2zM2 4.5l6 4.5 6-4.5" />,
  "microsoft-365": <path d="M2.5 5.5h11v8h-11zM6 5.5V3.5h4v2M2.5 9h11" />,
  apple: <path d="M5 1.5h6a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM7 12.5h2" />,
  copy: <path d="M6.5 9.5l3-3M7 4.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5L7.5 13a2.5 2.5 0 0 1-3.5-3.5L5.5 8" />,
};

function TileContent({ icon, label, hint }: { icon: ComponentChildren; label: string; hint: string }) {
  return (
    <>
      <StrokeIcon class="pk-calendar-tile__icon" width="20" height="20">
        {icon}
      </StrokeIcon>
      <span class="pk-calendar-tile__label">{label}</span>
      <span class="pk-calendar-tile__hint">{hint}</span>
    </>
  );
}

/** One tap per calendar app. Without a link yet, the first tap creates it and then opens the app. */
export function CalendarSubscription({
  calendar,
  autosave,
  calendarName,
}: {
  calendar: AgendaCalendar;
  autosave: AgendaCalendarAutosave;
  calendarName: string;
}) {
  const url = calendar.link?.subscription?.url ?? null;
  const [creating, setCreating] = useState<string | null>(null);
  async function addWithNewLink(provider: CalendarSubscriptionProvider) {
    const inBrowser = calendarSubscriptionProviderDetails[provider].opensInBrowser;
    // Open the tab inside the tap so a popup blocker allows it, then send it on once the link exists.
    const tab = inBrowser ? window.open("", "_blank") : null;
    if (tab) tab.opener = null;
    setCreating(provider);
    try {
      const href = calendarSubscriptionLink(provider, await calendar.createLink(autosave.settings), calendarName);
      if (tab) tab.location.href = href;
      else if (!inBrowser) window.location.assign(href);
      else toast("Your calendar link is ready. Choose your calendar again to open it.", "info");
    } catch (error) {
      tab?.close();
      toast(error instanceof Error ? error.message : "Your calendar link could not be created.", "error");
    } finally {
      setCreating(null);
    }
  }
  async function copy() {
    setCreating("copy");
    try {
      await copyCalendarLink(url ?? (await calendar.createLink(autosave.settings)));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Your calendar link could not be created.", "error");
    } finally {
      setCreating(null);
    }
  }
  return (
    <Panel aria-label="Add My agenda to your calendar">
      <PanelHeader title="Add My agenda to your calendar" />
      <PanelBody class="pk-stack">
        <p>Your sessions appear in your calendar app and stay up to date.</p>
        <ul class="pk-grid pk-calendar-tiles">
          {calendarSubscriptionProviders.map((provider) => {
            const details = calendarSubscriptionProviderDetails[provider];
            const content = <TileContent icon={icons[provider]} label={details.label} hint={details.hint} />;
            return (
              <li key={provider}>
                {url ? (
                  <a
                    class="pk-calendar-tile"
                    href={calendarSubscriptionLink(provider, url, calendarName)}
                    {...(details.opensInBrowser ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    {content}
                  </a>
                ) : (
                  <button
                    type="button"
                    class="pk-calendar-tile"
                    aria-busy={creating === provider ? "true" : undefined}
                    disabled={creating !== null}
                    onClick={() => void addWithNewLink(provider)}
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
          <li>
            <button
              type="button"
              class="pk-calendar-tile"
              aria-busy={creating === "copy" ? "true" : undefined}
              disabled={creating !== null}
              onClick={() => void copy()}
            >
              <TileContent icon={icons.copy} label="Copy link" hint="For any other calendar app" />
            </button>
          </li>
        </ul>
        <Checkbox
          role="switch"
          name="includeTentative"
          label="Include sessions you have not confirmed"
          hint="Starred sessions, and sessions waiting for approval or a free place."
          checked={autosave.settings.includeTentative}
          disabled={autosave.saving}
          onChange={(event) => autosave.change({ includeTentative: event.currentTarget.checked })}
        />
        <CalendarPrivateLink calendar={calendar} settings={autosave.settings} />
      </PanelBody>
    </Panel>
  );
}

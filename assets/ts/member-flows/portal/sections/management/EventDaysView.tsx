import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { EventDaysManagementResponse } from "../../../../../shared/schemas/event-configuration";
import { formatNumber } from "../../../../../shared/format-number";
import { useHashQueryParam } from "../../../../hooks/useHashQueryParam";
import { useMediaQuery } from "../../../../hooks/useMediaQuery";
import { EmptyState } from "../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TabList } from "../../../../ui/TabList";
import { EventAttendanceOptions } from "./EventAttendanceOptions";
import { EventAttendanceSchedule } from "./EventAttendanceSchedule";
import { attendanceSettingsDraft } from "./event-attendance-draft";
import "./EventAttendanceSettings.css";

export function EventDaysView({
  response,
  zone,
  menu,
  feedback,
}: {
  response: EventDaysManagementResponse;
  zone: string;
  menu?: ComponentChildren;
  feedback?: ComponentChildren;
}) {
  const draft = useMemo(() => attendanceSettingsDraft(response, zone), [response, zone]);
  const phone = useMediaQuery("(max-width: 52rem)");
  const [active, setActive] = useHashQueryParam("attendanceSettings", "schedule", ["schedule", "options"]);
  const [selectedDay, selectDay] = useHashQueryParam(
    "attendanceDay",
    draft.days[0]?.id ?? "",
    draft.days.map((day) => day.id),
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Panel aria-label="Attendance days" class="pk-attendance-settings" data-read-only>
      <PanelHeader title="Attendance days" menu={menu} />
      {feedback && <PanelBody>{feedback}</PanelBody>}
      <TabList
        label="Attendance settings"
        idPrefix="attendance-settings"
        activeId={active}
        onSelect={(id) => setActive(id === "options" ? "options" : "schedule")}
        items={[
          { id: "schedule", label: "Schedule", panelId: "attendance-schedule" },
          {
            id: "options",
            label: `Options · ${formatNumber(draft.definitions.length)}`,
            panelId: "attendance-options",
          },
        ]}
      />
      {!draft.days.length ? (
        <PanelBody>
          <EmptyState title="No attendance days configured" />
        </PanelBody>
      ) : active === "schedule" ? (
        <div
          id="attendance-schedule"
          role="tabpanel"
          aria-labelledby="attendance-settings-schedule"
          class="pk-attendance-settings__schedule"
        >
          {!phone && (
            <PanelBody>
              <p class="pk-small pk-muted">Local time: {zone}</p>
            </PanelBody>
          )}
          <EventAttendanceSchedule
            readOnly
            draft={draft}
            phone={phone}
            zone={zone}
            selectedDay={selectedDay}
            onSelectDay={selectDay}
          />
        </div>
      ) : (
        <div
          id="attendance-options"
          role="tabpanel"
          aria-labelledby="attendance-settings-options"
          class="pk-attendance-settings__options"
        >
          <EventAttendanceOptions readOnly draft={draft} phone={phone} expanded={expanded} onExpand={setExpanded} />
        </div>
      )}
    </Panel>
  );
}

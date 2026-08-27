import { useState } from "preact/hooks";
import type { EventOccurrence, GroupEventSeries } from "../../../../../shared/schemas/event-series";
import { Tabs, type TabItem } from "../../../../components/Tabs";
import { MeetingAttendance } from "./MeetingAttendance";
import { MeetingGuests } from "./MeetingGuests";
import { MeetingOccurrenceEditor } from "./MeetingOccurrenceEditor";

type OccurrenceTab = "settings" | "guests" | "attendance";

export function MeetingOccurrenceDetail({
  base,
  occurrence,
  series,
  canManage,
  canManageAttendance,
  onChanged,
}: {
  base: string;
  occurrence: EventOccurrence;
  series: GroupEventSeries;
  canManage: boolean;
  canManageAttendance: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [tab, setTab] = useState<OccurrenceTab>(canManage ? "settings" : "attendance");
  const idPrefix = `meeting-occurrence-tabs-${occurrence.id}`;
  const tabs: TabItem[] = [
    ...(canManage
      ? [
          { key: "settings", label: "Settings", panelId: `${idPrefix}-settings-panel` },
          ...(series.guestPolicy !== "none"
            ? [{ key: "guests", label: "Guests", panelId: `${idPrefix}-guests-panel` }]
            : []),
        ]
      : []),
    ...(canManageAttendance
      ? [{ key: "attendance", label: "Attendance", panelId: `${idPrefix}-attendance-panel` }]
      : []),
  ];
  const active = tabs.some((item) => item.key === tab) ? tab : (tabs[0]?.key as OccurrenceTab | undefined);
  const endpoint = `${base}/occurrences/${encodeURIComponent(occurrence.id)}`;

  return (
    <div id={`meeting-occurrence-detail-${occurrence.id}`} class="p-3 bg-body-tertiary">
      {tabs.length > 0 && (
        <Tabs items={tabs} active={active ?? ""} idPrefix={idPrefix} onChange={(key) => setTab(key as OccurrenceTab)} />
      )}
      {active === "settings" && (
        <div id={`${idPrefix}-settings-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-settings`}>
          <MeetingOccurrenceEditor
            endpoint={endpoint}
            occurrence={occurrence}
            timeZone={series.timezone}
            onChanged={onChanged}
          />
        </div>
      )}
      {active === "guests" && (
        <div id={`${idPrefix}-guests-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-guests`}>
          <MeetingGuests
            base={base}
            occurrence={occurrence}
            seriesInviteWindow={series.inviteWindow}
            timeZone={series.timezone}
          />
        </div>
      )}
      {active === "attendance" && (
        <div id={`${idPrefix}-attendance-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-attendance`}>
          <MeetingAttendance base={base} occurrence={occurrence} />
        </div>
      )}
    </div>
  );
}

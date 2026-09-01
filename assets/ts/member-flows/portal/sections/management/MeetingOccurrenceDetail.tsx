import { useHashQueryParam } from "../../../../hooks/useHashQueryParam";
import type { EventOccurrence, GroupEventSeries } from "../../../../../shared/schemas/event-series";
import { Tabs, type TabItem } from "../../../../components/Tabs";
import { Panel, PanelBody } from "../../../../ui/Panel";
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
  const defaultTab: OccurrenceTab = canManage ? "settings" : "attendance";
  const [rawTab, setTab] = useHashQueryParam("occurrenceTab", defaultTab);
  const tab: OccurrenceTab =
    rawTab === "settings" || rawTab === "guests" || rawTab === "attendance" ? rawTab : defaultTab;
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
    // The detail row this opens inside is already a sunk band with no padding
    // of its own, so the occurrence states what it is as a named panel rather
    // than as a tinted box. The panel's body owns the rhythm between the tabs
    // and the active section.
    <Panel
      class="pk"
      id={`meeting-occurrence-detail-${occurrence.id}`}
      aria-label={`Occurrence of ${series.eventName}`}
    >
      <PanelBody class="pk-stack pk-stack--snug">
        {tabs.length > 0 && (
          <Tabs items={tabs} active={active ?? ""} idPrefix={idPrefix} onChange={(key) => setTab(key)} />
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
      </PanelBody>
    </Panel>
  );
}

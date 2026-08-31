import { usePortalHashLocation } from "../../hash-location";
import type { GroupEventSeries } from "../../../../../shared/schemas/event-series";
import { Tabs, type TabItem } from "../../../../components/Tabs";
import { MeetingOccurrences } from "./MeetingOccurrences";
import { MeetingSeriesSettings } from "./MeetingSeriesSettings";

type SeriesTab = "occurrences" | "settings";

const DEFAULT_TAB: SeriesTab = "occurrences";

export function GroupMeetingSeriesDetail({
  groupId,
  series,
  initialTab,
  onChanged,
}: {
  groupId: string;
  series: GroupEventSeries;
  /** The URL-addressed tab segment, if any. Undefined or unrecognized selects the default tab. */
  initialTab?: string;
  onChanged: () => void | Promise<void>;
}) {
  const [, navigate] = usePortalHashLocation();
  const canManage = series.capabilities.includes("manage");
  const idPrefix = `meeting-series-tabs-${series.id}`;
  const tabs: TabItem[] = [
    { key: "occurrences", label: "Occurrences", panelId: `${idPrefix}-occurrences-panel` },
    ...(canManage ? [{ key: "settings", label: "Series settings", panelId: `${idPrefix}-settings-panel` }] : []),
  ];
  const requestedTab = (initialTab as SeriesTab | undefined) ?? DEFAULT_TAB;
  const tab = tabs.some((item) => item.key === requestedTab) ? requestedTab : DEFAULT_TAB;

  function tabPath(key: string): string {
    return `/groups/${encodeURIComponent(groupId)}/meetings/${encodeURIComponent(series.id)}/${key}`;
  }

  function goToTab(key: string): void {
    navigate(tabPath(key));
  }

  return (
    <div id={`meeting-series-detail-${series.id}`} class="p-3 bg-body-tertiary">
      <Tabs items={tabs} active={tab} idPrefix={idPrefix} onChange={goToTab} hrefFor={tabPath} />
      {tab === "occurrences" && (
        <div id={`${idPrefix}-occurrences-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-occurrences`}>
          <MeetingOccurrences groupId={groupId} series={series} onSeriesChanged={onChanged} />
        </div>
      )}
      {tab === "settings" && canManage && (
        <div id={`${idPrefix}-settings-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-settings`}>
          <MeetingSeriesSettings groupId={groupId} series={series} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

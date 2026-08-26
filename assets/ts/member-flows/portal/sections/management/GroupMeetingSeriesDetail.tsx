import { useEffect, useState } from "preact/hooks";
import type { GroupEventSeries } from "../../../../../shared/schemas/event-series";
import { Tabs, type TabItem } from "../../../../components/Tabs";
import { MeetingOccurrences } from "./MeetingOccurrences";
import { MeetingSeriesSettings } from "./MeetingSeriesSettings";

type SeriesTab = "occurrences" | "settings";

export function GroupMeetingSeriesDetail({
  groupId,
  series,
  onChanged,
}: {
  groupId: string;
  series: GroupEventSeries;
  onChanged: () => void | Promise<void>;
}) {
  const [tab, setTab] = useState<SeriesTab>("occurrences");
  const canManage = series.capabilities.includes("manage");
  const idPrefix = `meeting-series-tabs-${series.id}`;
  const tabs: TabItem[] = [
    { key: "occurrences", label: "Occurrences", panelId: `${idPrefix}-occurrences-panel` },
    ...(canManage ? [{ key: "settings", label: "Series settings", panelId: `${idPrefix}-settings-panel` }] : []),
  ];

  useEffect(() => {
    if (!canManage && tab === "settings") setTab("occurrences");
  }, [canManage, tab]);

  return (
    <div id={`meeting-series-detail-${series.id}`} class="p-3 bg-body-tertiary">
      <Tabs items={tabs} active={tab} idPrefix={idPrefix} onChange={(key) => setTab(key as SeriesTab)} />
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

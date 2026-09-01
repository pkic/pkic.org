import { usePortalHashLocation } from "../../hash-location";
import type { GroupEventSeries } from "../../../../../shared/schemas/event-series";
import { Tabs, type TabItem } from "../../../../components/Tabs";
import { PanelBody } from "../../../../ui/Panel";
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
  const tabs: TabItem[] = [
    { key: "occurrences", label: "Occurrences" },
    ...(canManage ? [{ key: "settings", label: "Series settings" }] : []),
  ];
  const requestedTab = (initialTab as SeriesTab | undefined) ?? DEFAULT_TAB;
  const tab = tabs.some((item) => item.key === requestedTab) ? requestedTab : DEFAULT_TAB;

  function tabPath(key: string): string {
    return `/groups/${encodeURIComponent(groupId)}/meetings/${encodeURIComponent(series.id)}/${key}`;
  }

  function goToTab(key: string): void {
    navigate(tabPath(key));
  }

  /*
   * The tabs navigate — each one is a URL — so they render as links carrying
   * `aria-current="page"`, not as the ARIA tab pattern. The regions below are
   * therefore named sections rather than `role="tabpanel"`: a tabpanel has to
   * point back at a `role="tab"`, and the `aria-labelledby` this surface used
   * to emit named ids no link ever carried, so both panels were announced
   * without a name. A page can hold several of these at once, so the name
   * says which series it belongs to.
   */
  return (
    // The expanded cell has no padding of its own — DataTable zeroes it so the
    // row's owner decides — so the panel body supplies it on the space scale
    // rather than a one-off padding utility, and brings the sunk ground with it.
    <PanelBody id={`meeting-series-detail-${series.id}`} class="pk-stack pk-stack--snug">
      <Tabs items={tabs} active={tab} label={`${series.eventName} sections`} onChange={goToTab} hrefFor={tabPath} />
      {tab === "occurrences" && (
        <section aria-label={`${series.eventName} occurrences`}>
          <MeetingOccurrences groupId={groupId} series={series} onSeriesChanged={onChanged} />
        </section>
      )}
      {tab === "settings" && canManage && (
        <section aria-label={`${series.eventName} series settings`}>
          <MeetingSeriesSettings groupId={groupId} series={series} onChanged={onChanged} />
        </section>
      )}
    </PanelBody>
  );
}

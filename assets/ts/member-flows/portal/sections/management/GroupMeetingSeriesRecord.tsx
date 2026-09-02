import { groupEventSeriesResponseSchema } from "../../../../../shared/schemas/event-series";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { usePortalHashLocation } from "../../hash-location";
import { fmt } from "../../ui";
import { MeetingOccurrences } from "./MeetingOccurrences";
import { MeetingSeriesSettings } from "./MeetingSeriesSettings";
// `pk-record-title` ships in Content.css; the module that names it loads it.
import "../../../../ui/Content.css";

/** The series record's facets. Each one loads its data when it is opened. */
const SERIES_RECORD_TABS = [
  { key: "occurrences", label: "Occurrences", manage: false },
  { key: "settings", label: "Series settings", manage: true },
] as const;

type SeriesRecordTab = (typeof SERIES_RECORD_TABS)[number]["key"];

const DEFAULT_TAB: SeriesRecordTab = "occurrences";

/**
 * A meeting series' own page: the way back to the list, the series as the
 * subject — name, profile, whether it is active, and when it next meets —
 * and one tab per facet. It fetches the series by id through the group
 * context, so a copied URL opens the same record the list row did, with the
 * same capabilities and occurrence count.
 */
export function GroupMeetingSeriesRecord({
  groupId,
  seriesId,
  initialTab,
  onLeave,
}: {
  groupId: string;
  seriesId: string;
  /** The URL-addressed tab segment, if any. Undefined or unavailable selects Occurrences. */
  initialTab?: string;
  onLeave: () => void;
}) {
  const [, navigate] = usePortalHashLocation();
  const detail = useData(
    () =>
      getJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(seriesId)}`,
        groupEventSeriesResponseSchema,
      ),
    [groupId, seriesId],
  );
  const series = detail.data?.series.id === seriesId ? detail.data.series : null;
  const canManage = series?.capabilities.includes("manage") ?? false;
  const tabs = SERIES_RECORD_TABS.filter((item) => !item.manage || canManage).map(({ key, label }) => ({
    key,
    label,
  }));
  const requested = initialTab as SeriesRecordTab | undefined;
  const tab: SeriesRecordTab = tabs.some((item) => item.key === requested)
    ? (requested as SeriesRecordTab)
    : DEFAULT_TAB;

  function tabPath(key: string): string {
    const base = `/groups/${encodeURIComponent(groupId)}/meetings/${encodeURIComponent(seriesId)}`;
    return key === DEFAULT_TAB ? base : `${base}/${key}`;
  }

  /*
   * The tabs navigate — each one is a URL — so they render as links carrying
   * `aria-current="page"`, not as the ARIA tab pattern. The regions below are
   * therefore named sections rather than `role="tabpanel"`, and the name
   * says which series each belongs to.
   */
  return (
    <div class="pk pk-stack">
      <div class="pk-cluster">
        <Button variant="link" size="sm" onClick={onLeave}>
          ← All meeting series
        </Button>
      </div>
      {detail.loading && !series && <Spinner label="Loading meeting series…" />}
      {detail.error && <ErrorAlert error={detail.error} />}
      {series && (
        <>
          <div class="pk-stack pk-stack--tight">
            {/* h3: the shell owns h1 and the workspace's PageHeader owns h2, so
                a record inside a workspace tab is the next level down. */}
            <h3 class="pk-record-title">{series.eventName}</h3>
            <div class="pk-cluster">
              <Badge status={series.profileKey} />
              <Badge status={series.active ? "active" : "inactive"} />
              <span class="pk-small pk-muted">
                Next {fmt(series.nextOccurrenceAt ?? series.startsAt)}
                {series.location ? ` · ${series.location}` : ""}
              </span>
            </div>
          </div>
          {tabs.length > 1 && (
            <Tabs
              items={tabs}
              active={tab}
              label={`${series.eventName} sections`}
              onChange={(key) => navigate(tabPath(key))}
              hrefFor={tabPath}
            />
          )}
          {tab === "occurrences" && (
            <section aria-label={`${series.eventName} occurrences`}>
              <MeetingOccurrences groupId={groupId} series={series} onSeriesChanged={detail.reload} />
            </section>
          )}
          {tab === "settings" && canManage && (
            <section aria-label={`${series.eventName} series settings`}>
              <MeetingSeriesSettings groupId={groupId} series={series} onChanged={detail.reload} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

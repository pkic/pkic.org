import { useState } from "preact/hooks";
import { BreadcrumbBranch } from "../../../../ui/BreadcrumbScope";
import { groupEventSeriesResponseSchema } from "../../../../../shared/schemas/event-series";
import { eventSeriesCancelResponseSchema } from "../../../../../shared/schemas/meeting-invitations";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { getJson, postJson } from "../../../../shared/api-client";
import { Dialog } from "../../../../ui/Dialog";
import { Menu } from "../../../../ui/Menu";
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import { usePortalHashLocation } from "../../hash-location";
import { fmt, toast } from "../../ui";
import { MeetingOccurrenceRecord } from "./MeetingOccurrenceRecord";
import { MeetingOccurrences } from "./MeetingOccurrences";
import { MeetingSeriesSettings } from "./MeetingSeriesSettings";
import { downloadMeetingCalendar } from "./meeting-calendar-actions";

/** The series record's facets. Each one loads its data when it is opened. */
const SERIES_RECORD_TABS = [
  { key: "occurrences", label: "Occurrences", manage: false },
  { key: "settings", label: "Series settings", manage: true },
] as const;

type SeriesRecordTab = (typeof SERIES_RECORD_TABS)[number]["key"];

const DEFAULT_TAB: SeriesRecordTab = "occurrences";

/**
 * A meeting series' own page: the series as the
 * subject — name, profile, whether it is active, and when it next meets —
 * and one tab per facet. It fetches the series by id through the group
 * context, so a copied URL opens the same record the list row did, with the
 * same capabilities and occurrence count.
 */
export function GroupMeetingSeriesRecord({
  groupId,
  seriesId,
  initialTab,
  occurrenceSegment,
  occurrenceTab,
}: {
  groupId: string;
  seriesId: string;
  /** The URL-addressed tab segment, if any. Undefined or unavailable selects Occurrences. */
  initialTab?: string;
  /** The segment below the occurrences tab: `"new"` opens the add page, an id opens that occurrence's record. */
  occurrenceSegment?: string;
  /** The facet of that occurrence's record. */
  occurrenceTab?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const openingOccurrence = tab === "occurrences" && occurrenceSegment !== undefined && occurrenceSegment !== "new";
  const addingOccurrence = tab === "occurrences" && occurrenceSegment === "new" && canManage;

  /** Cancelling the meeting: every upcoming occurrence, everyone invited, and the series itself (#126). */
  async function cancelMeeting(): Promise<void> {
    if (!series) return;
    setBusy(true);
    try {
      const result = await postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(seriesId)}/cancel`,
        { expectedUpdatedAt: series.updatedAt },
        eventSeriesCancelResponseSchema,
      );
      toast(
        result.cancelledOccurrences === 0
          ? "Meeting cancelled"
          : `Meeting cancelled; ${String(result.cancelledOccurrences)} upcoming ${
              result.cancelledOccurrences === 1 ? "occurrence" : "occurrences"
            } cancelled`,
        "success",
      );
      setCancelling(false);
      await detail.reload();
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  /*
   * The tabs navigate — each one is a URL — so they render as links carrying
   * `aria-current="page"`, not as the ARIA tab pattern. The regions below are
   * therefore named sections rather than `role="tabpanel"`, and the name
   * says which series each belongs to.
   */
  return (
    <div class="pk pk-stack">
      {detail.loading && !series && <Spinner label="Loading meeting series…" />}
      {detail.error && <ErrorAlert error={detail.error} />}
      {series && (
        <BreadcrumbBranch
          items={[
            { label: series.eventName, href: usePortalHashLocation.hrefs(tabPath(DEFAULT_TAB)) },
            {
              label: tabs.find((item) => item.key === tab)?.label ?? tab,
              href: usePortalHashLocation.hrefs(tabPath(tab)),
            },
          ]}
        >
          {openingOccurrence ? (
            // An occurrence is a record of its own under the series (#126):
            // its page replaces the series' tabs rather than opening inside
            // one of them.
            <MeetingOccurrenceRecord
              groupId={groupId}
              series={series}
              occurrenceId={occurrenceSegment}
              tab={occurrenceTab}
              onSeriesChanged={detail.reload}
            />
          ) : (
            <>
              {!addingOccurrence && (
                <ProfileHeader
                  headingLevel={3}
                  title={series.eventName}
                  context={
                    <>
                      <Badge status={series.profileKey} />
                      <Badge status={series.active ? "active" : "inactive"} />
                    </>
                  }
                  lede={
                    <>
                      Next {fmt(series.nextOccurrenceAt ?? series.startsAt)}
                      {series.location ? ` · ${series.location}` : ""}
                    </>
                  }
                  actions={
                    <Menu
                      label="Meeting series actions"
                      align="end"
                      items={[
                        {
                          id: "calendar",
                          label: "Download calendar",
                          onSelect: () => downloadMeetingCalendar(groupId, series.id),
                        },
                        ...(canManage && series.active
                          ? [
                              {
                                id: "cancel",
                                label: "Cancel meeting…",
                                danger: true,
                                disabled: busy,
                                onSelect: () => setCancelling(true),
                              },
                            ]
                          : []),
                      ]}
                    />
                  }
                />
              )}
              {canManage && cancelling && (
                <Dialog
                  open
                  destructive
                  title={`Cancel ${series.eventName}?`}
                  description="The meeting is taken off the schedule and nothing more is generated from it."
                  consequences={[
                    "Every upcoming occurrence is cancelled",
                    "Everyone invited to one receives a calendar cancellation",
                    "Occurrences that have already taken place are left as they are",
                  ]}
                  confirmLabel={busy ? "Cancelling…" : "Cancel meeting"}
                  cancelLabel="Keep meeting"
                  confirmDisabled={busy}
                  onConfirm={() => void cancelMeeting()}
                  onCancel={() => setCancelling(false)}
                />
              )}
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
                  <MeetingOccurrences
                    groupId={groupId}
                    series={series}
                    occurrenceSegment={occurrenceSegment}
                    onSeriesChanged={detail.reload}
                  />
                </section>
              )}
            </>
          )}
          {tab === "settings" && canManage && !openingOccurrence && (
            <section aria-label={`${series.eventName} series settings`}>
              <MeetingSeriesSettings groupId={groupId} series={series} onChanged={detail.reload} />
            </section>
          )}
        </BreadcrumbBranch>
      )}
    </div>
  );
}

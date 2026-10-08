import { useState } from "preact/hooks";
import { eventOccurrencesListResponseSchema, type GroupEventSeries } from "../../../../../shared/schemas/event-series";
import { formatCalendarDate, formatDateTimeInZone } from "../../../../../shared/format-date";
import { formatNumber } from "../../../../../shared/format-number";
import { Calendar } from "../../../../components/Calendar";
import { calendarDate, calendarRange, moveCalendar, type CalendarView } from "../../../../components/calendar-range";
import { Badge } from "../../../../components/Badge";
import { Pager } from "../../../../components/Pager";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useOffsetPager } from "../../../../hooks/useOffsetPager";
import {
  buildCollectionResetKey,
  useCollectionOffset,
  useServerCollection,
  type CollectionLoader,
} from "../../../../hooks/useServerCollection";
import { getJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../ui/Panel";
import { usePortalHashLocation } from "../../hash-location";
const load: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });
export function MeetingOccurrenceCalendar({ groupId, series }: { groupId: string; series: GroupEventSeries }) {
  const [date, setDate] = useState(() => calendarDate(new Date(), series.timezone));
  const [view, setView] = useState<CalendarView>("month");
  const range = calendarRange(date, view, series.timezone);
  const endpoint = `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(series.id)}/occurrences`;
  const pager = useOffsetPager();
  const filters = { overlapsFrom: range.from, overlapsTo: range.to, sort: "starts_at" };
  const offset = useCollectionOffset(buildCollectionResetKey(endpoint, filters), pager.offset, pager.resetPage);
  const collection = useServerCollection({
    endpoint,
    params: { ...filters, limit: String(pager.pageSize), offset: String(offset) },
    responseSchema: eventOccurrencesListResponseSchema,
    load,
    retainDataOnError: false,
  });
  const data = collection.data;
  const complete = Boolean(data && data.page.offset === 0 && !data.page.hasMore);
  const path = `/groups/${encodeURIComponent(groupId)}/meetings/${encodeURIComponent(series.id)}/occurrences`;
  return (
    <Panel aria-label="Meeting calendar">
      <PanelHeader title="Meeting calendar" class="pk-calendar__header">
        <Button size="sm" onClick={() => setDate(moveCalendar(date, view, -1))}>
          Previous {view}
        </Button>
        <Button size="sm" onClick={() => setDate(calendarDate(new Date(), series.timezone))}>
          Today
        </Button>
        <Button size="sm" onClick={() => setDate(moveCalendar(date, view, 1))}>
          Next {view}
        </Button>
        <Button size="sm" aria-pressed={view === "month"} onClick={() => setView("month")}>
          Month
        </Button>
        <Button size="sm" aria-pressed={view === "week"} onClick={() => setView("week")}>
          Week
        </Button>
      </PanelHeader>
      <PanelBody class="pk-stack">
        <p class="pk-muted" aria-live="polite">
          {formatCalendarDate(range.dates[0])} – {formatCalendarDate(range.dates[range.dates.length - 1])} ·{" "}
          {series.timezone}
        </p>
        {collection.error && <ErrorAlert error={collection.error.message} />}
        {collection.loading ? (
          <Spinner />
        ) : (
          data && (
            <>
              {!complete && (
                <p role="status">
                  Showing {formatNumber(data.occurrences.length)} of {formatNumber(data.page.total)} meetings in this
                  range. Use the pages below to see the remaining meetings; empty dates may have meetings on another
                  page.
                </p>
              )}
              <Calendar
                date={date}
                view={view}
                timeZone={series.timezone}
                items={data.occurrences}
                complete={complete}
                renderItem={(item) => (
                  <a
                    class="pk-calendar__entry"
                    href={usePortalHashLocation.hrefs(`${path}/${encodeURIComponent(item.id)}`)}
                  >
                    <strong>{series.eventName}</strong>
                    <br />
                    {formatDateTimeInZone(item.startsAt, series.timezone)}
                    <br />
                    <Badge status={item.status} />
                  </a>
                )}
              />
              <Pager
                {...pager.pagerProps({
                  hasMore: data.page.hasMore,
                  rowCount: data.occurrences.length,
                  total: data.page.total,
                  serverOffset: data.page.offset,
                })}
              />
            </>
          )
        )}
      </PanelBody>
    </Panel>
  );
}

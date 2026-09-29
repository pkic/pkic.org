import { GroupEvents } from "./GroupEvents";
import { CreateMeetingSeries } from "./CreateMeetingSeries";
import { Tabs } from "../../../../components/Tabs";
import { HashRedirect } from "../../HashRedirect";
import { usePortalHashLocation } from "../../hash-location";
import { GroupMeetingSeriesList } from "./GroupMeetingSeriesList";
import { GroupMeetingSeriesRecord } from "./GroupMeetingSeriesRecord";

const NEW_MEETING_SERIES_SEGMENT = "new";
/**
 * The meetings a migration brought over without a schedule. They are a view
 * of the same list, reached by its tab, rather than a second table stacked
 * under the first (#101).
 */
const UNSCHEDULED_SEGMENT = "unscheduled";

const MEETING_VIEWS = [
  { key: "meetings", label: "Meetings" },
  { key: UNSCHEDULED_SEGMENT, label: "Awaiting a schedule" },
] as const;

export function GroupMeetings({
  groupId,
  canManage,
  seriesSegment,
  seriesTab,
  seriesDetailId,
  seriesDetailTab,
}: {
  groupId: string;
  canManage: boolean;
  /** `undefined` for the list, `"unscheduled"` for its other view, `"new"` for the create page, or a series id for its record. */
  seriesSegment?: string;
  /** The URL-addressed tab segment below a series id. */
  seriesTab?: string;
  /** The segment below a series tab — `"new"` under occurrences opens the add page, an id opens that occurrence. */
  seriesDetailId?: string;
  /** The facet of that occurrence's record. */
  seriesDetailTab?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const meetingsPath = `/groups/${encodeURIComponent(groupId)}/meetings`;

  function leaveToList(): void {
    navigate(meetingsPath);
  }

  if (seriesSegment === NEW_MEETING_SERIES_SEGMENT) {
    if (!canManage) return <HashRedirect to={meetingsPath} />;
    return (
      // Creation is a page of its own: a way back, and the create form —
      // which names what is being created in its own heading — alone on the
      // screen rather than layered over the list.
      <div class="pk pk-stack">
        <CreateMeetingSeries
          groupId={groupId}
          existingEventId={seriesTab}
          onCreated={(createdSeriesId) => navigate(`${meetingsPath}/${encodeURIComponent(createdSeriesId)}`)}
          onCancel={leaveToList}
        />
      </div>
    );
  }

  if (seriesSegment && seriesSegment !== UNSCHEDULED_SEGMENT) {
    // A series is a record with facets — occurrences, settings — so it gets
    // its own page rather than an expansion between the list's rows.
    return (
      <GroupMeetingSeriesRecord
        groupId={groupId}
        seriesId={seriesSegment}
        initialTab={seriesTab}
        occurrenceSegment={seriesDetailId}
        occurrenceTab={seriesDetailTab}
      />
    );
  }

  const view = seriesSegment === UNSCHEDULED_SEGMENT ? UNSCHEDULED_SEGMENT : "meetings";

  return (
    // One list panel — head, table, pager inside one frame — and, for a
    // manager, a tab strip that switches which list it shows.
    <div class="pk pk-stack">
      {canManage && (
        <Tabs
          label="Meeting views"
          items={[...MEETING_VIEWS]}
          active={view}
          hrefFor={(key) => (key === UNSCHEDULED_SEGMENT ? `${meetingsPath}/${UNSCHEDULED_SEGMENT}` : meetingsPath)}
        />
      )}
      {view === UNSCHEDULED_SEGMENT ? (
        <GroupEvents groupId={groupId} collection="unscheduled_meetings" />
      ) : (
        <GroupMeetingSeriesList
          groupId={groupId}
          createAction={
            canManage
              ? { label: "New meeting", onSelect: () => navigate(`${meetingsPath}/${NEW_MEETING_SERIES_SEGMENT}`) }
              : undefined
          }
        />
      )}
    </div>
  );
}

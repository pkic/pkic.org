import { useEffect, useRef, useState } from "preact/hooks";
import {
  EVENT_OCCURRENCE_STATUSES,
  eventOccurrenceCreateSchema,
  eventOccurrenceResponseSchema,
  eventOccurrencesListResponseSchema,
  type GroupEventSeries,
  type EventOccurrence,
} from "../../../../../shared/schemas/event-series";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge, statusLabel } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { patchJson, postJson } from "../../../../shared/api-client";
import { RowActions } from "../../../../ui/RowActions";
import { useMeetingCancellation } from "./useMeetingCancellation";
import { downloadMeetingCalendar } from "./meeting-calendar-actions";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { fmt, toast } from "../../ui";
import { usePortalHashLocation } from "../../hash-location";
import { MeetingOccurrenceFields, type MeetingOccurrenceDraft } from "./MeetingOccurrenceFields";
import { defaultFutureDate, isoDateTimeValue } from "./meeting-form-utils";

function initialOccurrenceDraft(timeZone: string): MeetingOccurrenceDraft {
  return {
    startsAt: defaultFutureDate(7, 15, 0, timeZone),
    endsAt: defaultFutureDate(7, 16, 0, timeZone),
    location: "",
    providerUrlAction: "replace",
    providerJoinUrl: "",
  };
}

/** Reserved occurrence segment that routes to the add page instead of a record. */
const NEW_OCCURRENCE_SEGMENT = "new";

/** Redirects back to the list from an effect, not render — see its call site below. */
function OccurrencesRedirect({ onNavigate }: { onNavigate: () => void }) {
  useEffect(onNavigate, [onNavigate]);
  return null;
}

export function MeetingOccurrences({
  groupId,
  series,
  occurrenceSegment,
  onSeriesChanged,
}: {
  groupId: string;
  series: GroupEventSeries;
  /** `undefined` for the list, `"new"` for the add page. */
  occurrenceSegment?: string;
  onSeriesChanged: () => void | Promise<void>;
}) {
  const [, navigate] = usePortalHashLocation();
  const occurrencesPath = `/groups/${encodeURIComponent(groupId)}/meetings/${encodeURIComponent(series.id)}/occurrences`;
  const showCreate = occurrenceSegment === NEW_OCCURRENCE_SEGMENT;
  const actions = useRef<ApiTableActions | null>(null);
  const [draft, setDraft] = useState(() => initialOccurrenceDraft(series.timezone));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(series.id)}`;
  const canManage = series.capabilities.includes("manage");
  const cancellation = useMeetingCancellation<EventOccurrence>({
    label: (row) => `${series.eventName} — ${fmt(row.startsAt)}`,
    canCancel: (row) => canManage && row.status === "scheduled",
    cancel: (row) =>
      patchJson(
        `${base}/occurrences/${encodeURIComponent(row.id)}`,
        { expectedUpdatedAt: row.updatedAt, status: "cancelled" },
        eventOccurrenceResponseSchema,
      ),
    reload: async () => Promise.all([actions.current?.reload(), onSeriesChanged()]),
  });

  useEffect(() => {
    setDraft(initialOccurrenceDraft(series.timezone));
    setError("");
  }, [series.id, series.timezone]);

  async function create(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");
    let created = false;
    try {
      const input = eventOccurrenceCreateSchema.parse({
        startsAt: isoDateTimeValue(draft.startsAt, series.timezone),
        endsAt: isoDateTimeValue(draft.endsAt, series.timezone),
        locationOverride: draft.location.trim() || null,
        providerJoinUrl: draft.providerJoinUrl.trim() || null,
      });
      await postJson(`${base}/occurrences`, input, eventOccurrenceResponseSchema);
      setDraft(initialOccurrenceDraft(series.timezone));
      toast("Meeting occurrence created", "success");
      created = true;
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
    /*
     * Returning is the last thing, outside the flag's own scope: this surface
     * shares one `saving` with the occurrence editor below it, and a segment
     * change re-renders rather than remounts, so leaving the flag set on the
     * way out would strand the editor's button reading "Saving…".
     */
    if (created) {
      navigate(occurrencesPath);
      await Promise.all([actions.current?.reload(), onSeriesChanged()]);
    }
  }

  if (showCreate) {
    // Navigating away belongs in an effect, not in render.
    if (!canManage) return <OccurrencesRedirect onNavigate={() => navigate(occurrencesPath)} />;
    return (
      <div class="pk pk-stack">
        {/* The page's way back: adding has its own address, so leaving it is
            navigation rather than the disappearance of a layer. */}

        <Panel aria-label="New occurrence">
          <PanelHeader title="New occurrence" headingLevel={2} breadcrumb />
          <PanelBody class="pk-stack">
            <form class="pk-stack" onSubmit={(event) => void create(event)}>
              <MeetingOccurrenceFields draft={draft} disabled={saving} onChange={setDraft} />
              <div class="pk-cluster">
                <Button type="submit" variant="primary" size="sm" loading={saving} disabled={saving}>
                  {saving ? "Creating…" : "Create occurrence"}
                </Button>
                <Button size="sm" onClick={() => navigate(occurrencesPath)} disabled={saving}>
                  Cancel
                </Button>
              </div>
              {/* Below the actions rather than beside them: an alert is a
                  block, and sharing the button's row pushed the button off
                  the line as soon as the message ran to a second one. */}
              {error && <ErrorAlert error={error} />}
            </form>
          </PanelBody>
        </Panel>
      </div>
    );
  }

  return (
    <div class="pk pk-stack">
      <ApiDataTable
        caption={`Scheduled occurrences of ${series.eventName}`}
        endpoint={`${base}/occurrences`}
        responseSchema={eventOccurrencesListResponseSchema}
        resolve={(response) => response.occurrences}
        resolvePage={(response) => response.page}
        paginate
        initialSort="starts_at"
        actionsRef={actions}
        onData={(response) => cancellation.onRows(response.occurrences)}
        selection={canManage ? cancellation.selection : undefined}
        bulkBar={canManage ? cancellation.bulkBar : undefined}
        createAction={
          canManage
            ? { label: "Add occurrence", onSelect: () => navigate(`${occurrencesPath}/${NEW_OCCURRENCE_SEGMENT}`) }
            : undefined
        }
        columns={[
          {
            header: "Starts",
            cell: (occurrence) => fmt(occurrence.startsAt),
            sort: { asc: "starts_at", desc: "-starts_at", defaultDirection: "asc" },
          },
          {
            header: "Ends",
            cell: (occurrence) => fmt(occurrence.endsAt),
            width: "fit",
            sort: { asc: "ends_at", desc: "-ends_at" },
          },
          {
            header: "Status",
            cell: (occurrence) => <Badge status={occurrence.status} />,
            width: "fit",
            sort: { asc: "status", desc: "-status" },
            filter: {
              param: "status",
              options: [
                { value: "", label: "All statuses" },
                ...EVENT_OCCURRENCE_STATUSES.map((status) => ({ value: status, label: statusLabel(status) })),
              ],
            },
          },
          // Who was told and what their calendars answered (#126), read from
          // the end like the other counts.
          {
            header: { label: "Invited", className: "pk-end" },
            cell: (occurrence) => occurrence.invitedCount,
            width: "fit",
          },
          {
            header: { label: "Accepted", className: "pk-end" },
            cell: (occurrence) => occurrence.rsvp.accepted,
            width: "fit",
          },
          // Counts are compared down the column, so they read from the end
          // and hug their content instead of claiming slack.
          {
            header: { label: "Guests", className: "pk-end" },
            cell: (occurrence) => occurrence.guestCount,
            width: "fit",
          },
          {
            header: { label: "Joined", className: "pk-end" },
            cell: (occurrence) => occurrence.joinConfirmedCount,
            width: "fit",
          },
          {
            header: { label: "Verified", className: "pk-end" },
            cell: (occurrence) => occurrence.attendanceVerifiedCount,
            width: "fit",
          },
          {
            header: "",
            cell: (occurrence) => (
              <RowActions
                subject={fmt(occurrence.startsAt)}
                actions={[
                  {
                    id: "calendar",
                    label: "Download calendar",
                    onSelect: () => downloadMeetingCalendar(groupId, series.id, occurrence.id),
                  },
                  ...(canManage
                    ? [
                        {
                          id: "edit",
                          label: "Change occurrence…",
                          onSelect: () => navigate(`${occurrencesPath}/${encodeURIComponent(occurrence.id)}/settings`),
                        },
                        {
                          id: "cancel",
                          label: "Cancel occurrence…",
                          danger: true,
                          disabled: cancellation.busy || occurrence.status !== "scheduled",
                          onSelect: () => void cancellation.cancelRows([occurrence]),
                        },
                      ]
                    : []),
                ]}
              />
            ),
          },
        ]}
        empty="No meeting occurrences have been generated."
        rowKey={(occurrence) => occurrence.id}
        // Activating a row opens the occurrence's own page (#126) — a record
        // with facets, never an expansion between the rows.
        rowAction={(occurrence) => ({
          label: `Open the occurrence starting ${fmt(occurrence.startsAt)}`,
          href: usePortalHashLocation.hrefs(`${occurrencesPath}/${encodeURIComponent(occurrence.id)}`),
        })}
      />
    </div>
  );
}

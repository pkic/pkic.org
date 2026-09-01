import { useEffect, useRef, useState } from "preact/hooks";
import {
  eventOccurrenceCreateSchema,
  eventOccurrenceResponseSchema,
  eventOccurrencesListResponseSchema,
  type EventOccurrence,
  type GroupEventSeries,
} from "../../../../../shared/schemas/event-series";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { postJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { fmt, toast } from "../../ui";
import { MeetingOccurrenceDetail } from "./MeetingOccurrenceDetail";
import { MeetingOccurrenceFields, type MeetingOccurrenceDraft } from "./MeetingOccurrenceFields";
import { defaultFutureDate, isoDateTimeValue } from "./meeting-form-utils";

function initialOccurrenceDraft(timeZone: string): MeetingOccurrenceDraft {
  return {
    startsAt: defaultFutureDate(7, 15, 0, timeZone),
    endsAt: defaultFutureDate(7, 16, 0, timeZone),
    location: "",
    providerUrlAction: "replace",
    providerJoinUrl: "",
    status: "scheduled",
  };
}

export function MeetingOccurrences({
  groupId,
  series,
  onSeriesChanged,
}: {
  groupId: string;
  series: GroupEventSeries;
  onSeriesChanged: () => void | Promise<void>;
}) {
  const actions = useRef<ApiTableActions | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(() => initialOccurrenceDraft(series.timezone));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(series.id)}`;
  const canManage = series.capabilities.includes("manage");
  const canManageAttendance = series.capabilities.includes("manage_attendance");

  useEffect(() => {
    setDraft(initialOccurrenceDraft(series.timezone));
    setShowCreate(false);
    setError("");
  }, [series.id, series.timezone]);

  async function create(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const input = eventOccurrenceCreateSchema.parse({
        startsAt: isoDateTimeValue(draft.startsAt, series.timezone),
        endsAt: isoDateTimeValue(draft.endsAt, series.timezone),
        locationOverride: draft.location.trim() || null,
        providerJoinUrl: draft.providerJoinUrl.trim() || null,
      });
      await postJson(`${base}/occurrences`, input, eventOccurrenceResponseSchema);
      setShowCreate(false);
      setDraft(initialOccurrenceDraft(series.timezone));
      toast("Meeting occurrence created", "success");
      await actions.current?.reload();
      await onSeriesChanged();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="pk pk-stack">
      {canManage && (
        <div class="pk-cluster">
          <Button
            size="sm"
            variant="primary"
            aria-expanded={showCreate}
            onClick={() => setShowCreate((shown) => !shown)}
          >
            {showCreate ? "Hide occurrence form" : "Add occurrence"}
          </Button>
        </div>
      )}
      {canManage && showCreate && (
        <Panel>
          <PanelHeader title="New occurrence" />
          <PanelBody class="pk-stack">
            <form class="pk-stack" onSubmit={(event) => void create(event)}>
              <MeetingOccurrenceFields
                idPrefix={`meeting-occurrence-create-${series.id}`}
                draft={draft}
                disabled={saving}
                onChange={setDraft}
              />
              <div class="pk-cluster">
                <Button type="submit" variant="primary" size="sm" loading={saving} disabled={saving}>
                  {saving ? "Creating…" : "Create occurrence"}
                </Button>
              </div>
              {/* Below the actions rather than beside them: an alert is a
                  block, and sharing the button's row pushed the button off
                  the line as soon as the message ran to a second one. */}
              {error && <ErrorAlert error={error} />}
            </form>
          </PanelBody>
        </Panel>
      )}
      <ApiDataTable
        caption={`Scheduled occurrences of ${series.eventName}`}
        endpoint={`${base}/occurrences`}
        responseSchema={eventOccurrencesListResponseSchema}
        resolve={(response) => response.occurrences}
        resolvePage={(response) => response.page}
        paginate
        initialSort="starts_at"
        actionsRef={actions}
        columns={[
          {
            header: "Starts",
            cell: (occurrence) => fmt(occurrence.startsAt),
            sort: { asc: "starts_at", desc: "-starts_at", defaultDirection: "asc" },
          },
          { header: "Ends", cell: (occurrence) => fmt(occurrence.endsAt), sort: { asc: "ends_at", desc: "-ends_at" } },
          {
            header: "Status",
            cell: (occurrence) => <Badge status={occurrence.status} />,
            sort: { asc: "status", desc: "-status" },
          },
          { header: "Guests", cell: (occurrence) => occurrence.guestCount },
          { header: "Joined", cell: (occurrence) => occurrence.joinConfirmedCount },
          { header: "Verified", cell: (occurrence) => occurrence.attendanceVerifiedCount },
          ...(canManage || canManageAttendance
            ? [
                {
                  header: "Actions",
                  className: "pk-end",
                  cell: (occurrence: EventOccurrence) => (
                    // A disclosure, not a navigation: the detail row opens in
                    // place, so the control keeps aria-expanded/aria-controls
                    // and the row itself stays a plain row.
                    <Button
                      size="sm"
                      aria-expanded={selectedId === occurrence.id}
                      aria-controls={`meeting-occurrence-detail-${occurrence.id}`}
                      onClick={() => setSelectedId((current) => (current === occurrence.id ? null : occurrence.id))}
                    >
                      {selectedId === occurrence.id ? "Hide" : "Manage"}
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
        empty="No meeting occurrences have been generated."
        rowKey={(occurrence) => occurrence.id}
        detailRow={(occurrence) =>
          selectedId === occurrence.id ? (
            <MeetingOccurrenceDetail
              base={base}
              occurrence={occurrence}
              series={series}
              canManage={canManage}
              canManageAttendance={canManageAttendance}
              onChanged={async () => {
                await actions.current?.reload();
                await onSeriesChanged();
              }}
            />
          ) : null
        }
      />
    </div>
  );
}

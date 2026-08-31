import { useRef, useState } from "preact/hooks";
import {
  attendanceVerifySchema,
  eventAttendanceListResponseSchema,
  eventAttendanceResponseSchema,
  type EventOccurrence,
} from "../../../../../shared/schemas/event-series";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { putJson } from "../../../../shared/api-client";
import { fmt, toast } from "../../ui";

export function MeetingAttendance({ base, occurrence }: { base: string; occurrence: EventOccurrence }) {
  const actions = useRef<ApiTableActions | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const endpoint = `${base}/occurrences/${encodeURIComponent(occurrence.id)}/attendance`;

  async function verify(confirmationId: string): Promise<void> {
    setPendingId(confirmationId);
    try {
      await putJson(
        `${endpoint}/${encodeURIComponent(confirmationId)}`,
        attendanceVerifySchema.parse({ source: "manual" }),
        eventAttendanceResponseSchema,
      );
      toast("Attendance verified", "success");
      await actions.current?.reload();
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <ApiDataTable
      caption="Meeting attendance"
      endpoint={endpoint}
      responseSchema={eventAttendanceListResponseSchema}
      resolve={(response) => response.confirmations}
      resolvePage={(response) => response.page}
      paginate
      searchPlaceholder="Search attendance…"
      initialSort="-confirmed_at"
      actionsRef={actions}
      columns={[
        {
          header: "Attendee",
          cell: (entry) => (
            <>
              <span class="fw-semibold">{entry.name}</span>
              {entry.affiliation && (
                <>
                  <br />
                  <span class="small text-muted">{entry.affiliation}</span>
                </>
              )}
            </>
          ),
          sort: { asc: "name", desc: "-name" },
        },
        { header: "Intentional joins", cell: (entry) => entry.joinCount },
        {
          header: "Last joined",
          cell: (entry) => fmt(entry.confirmedAt),
          sort: { asc: "confirmed_at", desc: "-confirmed_at", defaultDirection: "desc" },
        },
        {
          header: "Attendance",
          cell: (entry) =>
            entry.attendanceVerifiedAt ? `Verified ${fmt(entry.attendanceVerifiedAt)}` : "Not verified",
        },
        {
          header: "",
          className: "text-end",
          cell: (entry) =>
            entry.attendanceVerifiedAt ? null : (
              <button
                type="button"
                class="btn btn-sm btn-outline-success"
                disabled={pendingId === entry.id}
                onClick={() => void verify(entry.id)}
              >
                {pendingId === entry.id ? "Verifying…" : "Verify"}
              </button>
            ),
        },
      ]}
      empty="No intentional meeting joins have been recorded."
      rowKey={(entry) => entry.id}
    />
  );
}

import { useRef, useState } from "preact/hooks";
import {
  attendanceVerifySchema,
  eventAttendanceListResponseSchema,
  eventAttendanceResponseSchema,
  type EventOccurrence,
} from "../../../../../shared/schemas/event-series";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { FilterSelect } from "../../../../components/FilterSelect";
import { Button } from "../../../../ui/Button";
import { putJson } from "../../../../shared/api-client";
import { fmt, toast } from "../../ui";

export function MeetingAttendance({ base, occurrence }: { base: string; occurrence: EventOccurrence }) {
  const actions = useRef<ApiTableActions | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  /** `""` lists everyone; `"true"`/`"false"` narrow to verified or unverified attendance. */
  const [verifiedFilter, setVerifiedFilter] = useState("");
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
      params={verifiedFilter ? { verified: verifiedFilter } : {}}
      toolbar={({ resetPage }) => (
        // The list contract already accepts `verified`; the toolbar exposes
        // it instead of leaving verification a concept the reader must scan
        // the Attendance column for.
        <FilterSelect
          ariaLabel="Attendance verification"
          value={verifiedFilter}
          options={[
            { value: "", label: "All attendance" },
            { value: "true", label: "Verified" },
            { value: "false", label: "Not verified" },
          ]}
          onChange={(value) => {
            setVerifiedFilter(value);
            resetPage();
          }}
        />
      )}
      columns={[
        {
          header: "Attendee",
          cell: (entry) => (
            <>
              <span class="pk-strong">{entry.name}</span>
              {entry.affiliation && (
                <>
                  <br />
                  <span class="pk-small pk-muted">{entry.affiliation}</span>
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
          className: "pk-end",
          cell: (entry) =>
            entry.attendanceVerifiedAt ? null : (
              // Named after the row it verifies: a column of controls all
              // reading "Verify" is nothing to choose between when the
              // controls are listed on their own.
              <Button
                size="sm"
                variant="secondary"
                loading={pendingId === entry.id}
                disabled={pendingId === entry.id}
                aria-label={`Verify attendance for ${entry.name}`}
                onClick={() => void verify(entry.id)}
              >
                {pendingId === entry.id ? "Verifying…" : "Verify"}
              </Button>
            ),
        },
      ]}
      empty="No intentional meeting joins have been recorded."
      rowKey={(entry) => entry.id}
    />
  );
}

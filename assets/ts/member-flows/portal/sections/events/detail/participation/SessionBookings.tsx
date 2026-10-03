import { useRef, useState } from "preact/hooks";
import type { z } from "zod";
import {
  sessionBookingsResponseSchema,
  sessionBookingRowSchema,
} from "../../../../../../../shared/schemas/event-participation-reporting";
import {
  sessionParticipationStatusSchema,
  sessionParticipationResponseSchema,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { sessionReviewRequestSchema } from "../../../../../../../shared/schemas/route-contracts-session-participation";
import { ApiDataTable, type ApiTableActions } from "../../../../../../components/ApiDataTable";
import { putJson } from "../../../../../../shared/api-client";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
type Participant = z.infer<typeof sessionBookingRowSchema>;
export function SessionBookings({ slug, occurrenceId }: { slug: string; occurrenceId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const actions = useRef<ApiTableActions | null>(null);
  async function review(userId: string, decision: z.infer<typeof sessionReviewRequestSchema>["decision"]) {
    setBusy(true);
    setError("");
    try {
      await putJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/${occurrenceId}/participation/${userId}`,
        sessionReviewRequestSchema.parse({ decision }),
        sessionParticipationResponseSchema,
      );
      await actions.current?.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not review request.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && <ErrorAlert error={error} />}
      <ApiDataTable<Participant, z.infer<typeof sessionBookingsResponseSchema>>
        caption="Session participation and approvals"
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/agenda/${occurrenceId}/participation`}
        responseSchema={sessionBookingsResponseSchema}
        resolve={(response) => response.participants}
        resolvePage={(response) => response.page}
        paginate
        initialSort="createdAt"
        initialFilters={{ status: "approval_pending" }}
        searchPlaceholder="Find a participant…"
        empty="No participants match these filters."
        rowKey={(row) => row.id}
        actionsRef={actions}
        columns={[
          { header: "Participant", cell: (row) => row.displayName ?? "Attendee", sort: { asc: "name", desc: "-name" } },
          { header: "Attendance", cell: (row) => (row.attendanceMode === "physical" ? "In person" : "Remote") },
          {
            header: "Status",
            cell: (row) => row.status.replaceAll("_", " "),
            filter: {
              param: "status",
              options: [
                { value: "", label: "All statuses" },
                ...sessionParticipationStatusSchema.options.map((value) => ({
                  value,
                  label: value.replaceAll("_", " "),
                })),
              ],
            },
          },
          {
            header: "Review",
            cell: (row) =>
              row.status === "approval_pending" ? (
                <>
                  <Button
                    size="sm"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void review(row.userId, "approve");
                    }}
                  >
                    Approve
                  </Button>{" "}
                  <Button
                    size="sm"
                    type="button"
                    variant="danger-quiet"
                    disabled={busy}
                    onClick={() => {
                      void review(row.userId, "reject");
                    }}
                  >
                    Reject
                  </Button>
                </>
              ) : (
                "—"
              ),
          },
        ]}
      />
    </>
  );
}

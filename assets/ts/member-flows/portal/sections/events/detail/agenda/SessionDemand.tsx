import { formatNumber } from "../../../../../../../shared/format-number";
import { roomRecommendationsResponseSchema } from "../../../../../../../shared/schemas/event-room-recommendations";
import { getJson } from "../../../../../../shared/api-client";
import { useData } from "../../../../../../hooks/useData";
import { DataTable } from "../../../../../../ui/DataTable";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";

/** Live participation belongs to this selected editor, separate from its scheduling draft. */
export function SessionDemand({ slug, occurrenceId }: { slug: string; occurrenceId: string }) {
  const source = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(occurrenceId)}/room-recommendations`,
        roomRecommendationsResponseSchema,
      ),
    [slug, occurrenceId],
  );
  const demand = source.data?.demand;
  const rows = demand ? (["physical", "remote"] as const).map((mode) => ({ mode, ...demand[mode] })) : [];
  return (
    <section class="pk-stack pk-stack--snug" aria-label="Current session demand">
      <div class="pk-cluster">
        <h3>Current session demand</h3>
        <Button
          type="button"
          size="sm"
          disabled={source.loading || source.refreshing}
          onClick={() => void source.reload()}
        >
          Refresh demand
        </Button>
      </div>
      <p class="pk-muted">
        Saved preferences express interest, not reserved places. Draft schedule changes do not change these counts.
        Assigned staff, booking holds and badge scans are separate.
      </p>
      {source.error && <ErrorAlert error={source.error} />}
      <DataTable
        caption="Current session demand"
        rows={rows}
        rowKey={(row) => row.mode}
        loading={source.loading}
        empty="Demand unavailable."
        columns={[
          { id: "mode", header: "Attendance", cell: (row) => (row.mode === "physical" ? "In person" : "Remote") },
          ...(["confirmed", "pending", "waitlisted", "preferences"] as const).map((status) => ({
            id: status,
            header:
              status === "confirmed"
                ? "Confirmed"
                : status === "pending"
                  ? "Pending approval"
                  : status === "waitlisted"
                    ? "Waitlisted"
                    : "Saved preferences",
            align: "end" as const,
            width: "fit" as const,
            cell: (row: (typeof rows)[number]) => formatNumber(row[status]),
          })),
        ]}
      />
    </section>
  );
}

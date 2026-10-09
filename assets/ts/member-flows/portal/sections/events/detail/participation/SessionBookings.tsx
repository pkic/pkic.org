import { CalendarReplyBadge, CalendarReplyReceipt } from "./CalendarReplyReceipt";
import { Badge as StatusBadge } from "../../../../../../components/Badge";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { RowActions } from "../../../../../../ui/RowActions";
import { RoomRecommendations, type RoomProposal } from "./RoomRecommendations";
import { SessionManagementTools } from "./SessionManagementTools";
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
export function SessionBookings({
  slug,
  occurrenceId,
  onReviewRoom,
}: {
  slug: string;
  occurrenceId: string;
  onReviewRoom?: (proposal: RoomProposal) => void;
}) {
  const [selected, setSelected] = useState<Participant | null>(null);
  const [tool, setTool] = useState<"management" | "rooms" | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
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
      setRefreshKey((value) => value + 1);
      setSelected(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not review request.");
    } finally {
      setBusy(false);
    }
  }
  if (selected)
    return (
      <Panel>
        <PanelHeader title={`Participation · ${selected.displayName ?? "Attendee"}`}>
          <Button onClick={() => setSelected(null)}>Back to participants</Button>
        </PanelHeader>
        <PanelBody>
          <div class="pk-stack">
            {error && <ErrorAlert error={error} />}
            <DescriptionList
              items={[
                { term: "Registration", value: <StatusBadge status={selected.status} /> },
                { term: "Attendance", value: selected.attendanceMode === "physical" ? "In person" : "Remote" },
              ]}
            />
            <CalendarReplyReceipt participant={selected} />
            {selected.status === "approval_pending" && (
              <div class="pk-cluster">
                <Button disabled={busy} onClick={() => void review(selected.userId, "approve")}>
                  Approve registration
                </Button>
                <Button variant="danger-quiet" disabled={busy} onClick={() => void review(selected.userId, "reject")}>
                  Reject registration
                </Button>
              </div>
            )}
          </div>
        </PanelBody>
      </Panel>
    );
  if (tool)
    return (
      <Panel>
        <PanelHeader title={tool === "management" ? "Session management" : "Room recommendations"}>
          <Button onClick={() => setTool(null)}>Back to participants</Button>
        </PanelHeader>
        <PanelBody>
          {tool === "management" ? (
            <SessionManagementTools
              slug={slug}
              occurrenceId={occurrenceId}
              onChanged={() => setRefreshKey((value) => value + 1)}
            />
          ) : (
            onReviewRoom && (
              <RoomRecommendations
                slug={slug}
                occurrenceId={occurrenceId}
                onReview={onReviewRoom}
                refreshKey={refreshKey}
              />
            )
          )}
        </PanelBody>
      </Panel>
    );
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
        searchPlaceholder="Find a participant…"
        empty="No participants match these filters."
        rowKey={(row) => row.id}
        actionsRef={actions}
        toolbar={() => (
          <RowActions
            subject="Session participation"
            actions={[
              { id: "management", label: "Session management", onSelect: () => setTool("management") },
              ...(onReviewRoom
                ? [{ id: "rooms", label: "Room recommendations", onSelect: () => setTool("rooms") }]
                : []),
            ]}
          />
        )}
        rowAction={(row) => ({
          label: `View participation for ${row.displayName ?? "Attendee"}`,
          onSelect: () => setSelected(row),
        })}
        columns={[
          { header: "Participant", cell: (row) => row.displayName ?? "Attendee", sort: { asc: "name", desc: "-name" } },
          { header: "Attendance", cell: (row) => (row.attendanceMode === "physical" ? "In person" : "Remote") },
          {
            header: "Status",
            cell: (row) => <StatusBadge status={row.status} />,
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
          { header: "Calendar reply", cell: (row) => <CalendarReplyBadge participant={row} /> },
          {
            header: "Actions",
            cell: (row) => (
              <RowActions
                subject={row.displayName ?? "Attendee"}
                actions={[{ id: "details", label: "View participation", onSelect: () => setSelected(row) }]}
              />
            ),
          },
        ]}
      />
    </>
  );
}

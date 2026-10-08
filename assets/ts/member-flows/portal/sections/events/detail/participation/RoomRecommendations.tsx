import { formatNumber } from "../../../../../../../shared/format-number";
import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import { roomRecommendationsResponseSchema } from "../../../../../../../shared/schemas/event-room-recommendations";
import { getJson } from "../../../../../../shared/api-client";
import { DataTable } from "../../../../../../ui/DataTable";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
type Response = z.infer<typeof roomRecommendationsResponseSchema>;
export type RoomProposal = Response["recommendations"][number];
export function RoomRecommendations({
  slug,
  occurrenceId,
  onReview,
  refreshKey = 0,
}: {
  slug: string;
  occurrenceId: string;
  onReview: (proposal: RoomProposal) => void;
  refreshKey?: number;
}) {
  const [data, setData] = useState<Response | null>(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    void getJson(
      `/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(occurrenceId)}/room-recommendations`,
      roomRecommendationsResponseSchema,
      { signal: controller.signal },
    )
      .then(setData)
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "Could not load room demand.");
      });
    return () => controller.abort();
  }, [slug, occurrenceId, refreshKey, refresh]);
  return (
    <section class="pk-stack" aria-label="Session demand and room fit">
      <div class="pk-cluster">
        <h3>Demand and room fit</h3>
        <Button size="sm" type="button" onClick={() => setRefresh((value) => value + 1)}>
          Refresh demand
        </Button>
      </div>
      <p>
        Preferences express interest, not reserved places. Review a proposal before saving; allocation and publication
        checks remain authoritative.
      </p>
      {data && (
        <div class="pk-stack">
          {(["physical", "remote"] as const).map((mode) => (
            <p key={mode}>
              <strong>{mode === "physical" ? "In person" : "Remote"}:</strong>{" "}
              {formatNumber(data.demand[mode].confirmed)} confirmed · {formatNumber(data.demand[mode].pending)} awaiting
              approval · {formatNumber(data.demand[mode].waitlisted)} waitlisted ·{" "}
              {formatNumber(data.demand[mode].preferences)} saved preferences.{" "}
              {formatNumber(data.demand[mode].occupied)} allocated places, including assigned staff and active booking
              holds. Badge scans are reported separately.
            </p>
          ))}
        </div>
      )}
      {error && <ErrorAlert error={error} />}
      <DataTable<RoomProposal>
        caption="Room recommendations"
        showCaption
        rows={data?.recommendations ?? []}
        rowKey={(room) => room.roomId}
        loading={!data && !error}
        empty="No event locations are configured."
        columns={[
          { id: "room", header: "Location", cell: (room) => room.name },
          {
            id: "capacity",
            header: "Physical capacity",
            align: "end",
            width: "fit",
            cell: (room) => (room.capacity === null ? "Unlimited" : formatNumber(room.capacity)),
          },
          { id: "facilities", header: "Equipment", cell: (room) => room.equipment.join(", ") || "No listed equipment" },
          {
            id: "fit",
            header: "Assessment",
            cell: (room) => (
              <div class="pk-stack">
                <strong>
                  {room.fit === "fits"
                    ? "Fits current demand"
                    : room.fit === "review"
                      ? "Review allocation and limits"
                      : "Unavailable"}
                </strong>
                {room.reasons.map((reason) => (
                  <small>{reason}</small>
                ))}
              </div>
            ),
          },
          {
            id: "review",
            header: "Review",
            cell: (room) => (
              <Button size="sm" type="button" disabled={room.fit === "unavailable"} onClick={() => onReview(room)}>
                Review {room.name}
              </Button>
            ),
          },
        ]}
      />
    </section>
  );
}

import { LazyAgendaConflictDetails } from "./LazyAgendaConflictDetails";
import { agendaConflictDetails } from "./agenda-conflict-details";
import { useEditorFocus } from "./useEditorFocus";
import { DataTable } from "../../../../../../components/Table";
import { useState } from "preact/hooks";
import {
  agendaScheduleApplySchema,
  agendaScheduleReviewSchema,
  type AgendaScheduleProposal,
} from "../../../../../../../shared/schemas/event-agenda-schedule";
import {
  agendaSnapshotSchema,
  type AgendaSnapshot,
  type AgendaOccurrence,
} from "../../../../../../../shared/schemas/event-agenda";
import { agendaOccurrenceRoomIds } from "../../../../../../../shared/event-agenda-rooms";
import { formatCalendarDate, formatTimeRangeInZone } from "../../../../../../../shared/format-date";
import { instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import { useData } from "../../../../../../hooks/useData";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
export function AgendaSchedulePreview({
  snapshot,
  proposal,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  proposal: AgendaScheduleProposal;
  onSaved: (snapshot: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const endpoint = `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/schedule`;
  const review = useData(async () => {
    try {
      return { review: await postJson(`${endpoint}/reviews`, proposal, agendaScheduleReviewSchema), refusal: null };
    } catch (failure) {
      const details = agendaConflictDetails(failure);
      if (!details) throw failure;
      return {
        review: null,
        refusal: { details, message: failure instanceof Error ? failure.message : "Schedule conflict" },
      };
    }
  }, [snapshot.eventSlug, JSON.stringify(proposal)]);
  const reviewed = review.data?.review;
  const [conflicts, setConflicts] = useState<ReturnType<typeof agendaConflictDetails>>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const form = useContractForm(agendaScheduleApplySchema, { ...proposal, reviewHash: reviewed?.reviewHash ?? "" });
  const describe = (item: AgendaOccurrence) =>
    item.startAt
      ? `${formatCalendarDate(instantToDateTimeLocal(item.startAt, snapshot.timeZone).slice(0, 10))} · ${formatTimeRangeInZone(item.startAt, item.endAt ?? undefined, snapshot.timeZone)} · ${
          agendaOccurrenceRoomIds(item)
            .map((id) => snapshot.rooms.find((room) => room.id === id)?.name ?? id)
            .join(" / ") || "Across all locations"
        }`
      : "Unscheduled";
  async function apply(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data || !reviewed || review.loading) return;
    setBusy(true);
    setError("");
    setConflicts(null);
    try {
      onSaved(await postJson(endpoint, checked.data, agendaSnapshotSchema));
      onClose();
    } catch (failure) {
      setError(form.refuse(failure));
      setConflicts(agendaConflictDetails(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title="Review schedule changes" />
      <PanelBody>
        <p>
          Times in {snapshot.timeZone}. Schedule order comes from the agenda, regardless of table filters or sorting.
          Moving up or down preserves durations and gaps; every affected session and break appears below.
        </p>
        {review.loading && <Spinner label="Checking the proposed schedule…" />}
        {(error || review.error || review.data?.refusal?.message) && (
          <ErrorAlert error={error || review.error || review.data?.refusal?.message || "Schedule conflict"} />
        )}
        {(conflicts || review.data?.refusal?.details) && (
          <LazyAgendaConflictDetails details={(conflicts || review.data?.refusal?.details)!} snapshot={snapshot} />
        )}
        {review.data?.refusal && (
          <Button disabled={review.loading || review.refreshing} onClick={() => void review.reload()}>
            Retry schedule review
          </Button>
        )}
        {reviewed && !review.loading && (
          <DataTable
            caption={`Before and after · ${reviewed.affected.length} sessions`}
            showCaption
            data={reviewed.affected}
            rowKey={(row) => row.before.id}
            columns={[
              {
                header: "Session",
                cell: (row) => (
                  <>
                    {row.before.title}
                    {row.before.kind !== "session" && (
                      <>
                        <br />
                        {row.before.kind}
                      </>
                    )}
                  </>
                ),
              },
              {
                header: "Before",
                cell: (row) => (
                  <>
                    {describe(row.before)}
                    <br />
                    Order {row.beforeOrder ?? "—"}
                  </>
                ),
              },
              {
                header: "After",
                cell: (row) => (
                  <>
                    {describe(row.after)}
                    <br />
                    Order {row.afterOrder ?? "—"}
                    {row.after.speakers
                      .filter(
                        (speaker) =>
                          speaker.roomId !==
                          row.before.speakers.find((before) => before.userId === speaker.userId)?.roomId,
                      )
                      .map((speaker) => (
                        <div key={speaker.userId}>
                          {speaker.displayName} ·{" "}
                          {snapshot.rooms.find((room) => room.id === speaker.roomId)?.name ?? "Primary location"}
                        </div>
                      ))}
                  </>
                ),
              },
            ]}
          />
        )}
        <form ref={focus} noValidate {...form.handlers} onSubmit={(event) => void apply(event)}>
          <div class="pk-cluster pk-cluster--end">
            <Button type="button" disabled={busy} onClick={onClose}>
              Cancel schedule changes
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || review.loading || !reviewed || Boolean(review.error)}
            >
              Apply reviewed schedule
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}

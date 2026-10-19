import { useEffect, useState } from "preact/hooks";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { Button } from "../../../../../../ui/Button";
import { CloseButton } from "../../../../../../ui/CloseButton";
import { LazyAgendaConflictDetails } from "./LazyAgendaConflictDetails";
import type { agendaConflictDetails } from "./agenda-conflict-details";
import "./AgendaPlacementRefusal.css";

export interface AgendaPlacementRefusalState {
  /** The service's reason, such as "This change conflicts with the agenda". */
  message: string;
  /** The first session the change would have moved, and how many it would have moved. */
  subject?: string;
  count: number;
  details: ReturnType<typeof agendaConflictDetails>;
}

function sentence(text: string) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** "“Keynote” was not changed." names what stayed put, so the reader knows the card did not move. */
export function agendaRefusalHeadline({ subject, count }: Pick<AgendaPlacementRefusalState, "subject" | "count">) {
  if (!subject) return "The agenda was not changed.";
  return count > 1 ? `“${subject}” and ${count - 1} more were not changed.` : `“${subject}” was not changed.`;
}

/**
 * A refused schedule change, shown in the planner's sticky toolbar so it appears where the organizer is
 * looking, at any scroll position. The status line is always present, so assistive technology announces each
 * refusal politely; the conflicts open on request.
 */
export function AgendaPlacementRefusal({
  refusal,
  snapshot,
  onDismiss,
}: {
  refusal: AgendaPlacementRefusalState | null;
  snapshot: AgendaSnapshot;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [refusal]);
  const detailsId = "agenda-placement-refusal-details";
  return (
    <div class={refusal ? "pk-agenda-refusal" : "pk-agenda-refusal pk-agenda-refusal--idle"}>
      <p class="pk-agenda-refusal__message" role="status">
        {refusal ? (
          <>
            <strong>{agendaRefusalHeadline(refusal)}</strong> {sentence(refusal.message)}
          </>
        ) : null}
      </p>
      {refusal && (
        <div class="pk-agenda-refusal__actions">
          {refusal.details && (
            <Button
              variant="secondary"
              aria-expanded={expanded ? "true" : "false"}
              aria-controls={detailsId}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Hide conflicts" : "Show conflicts"}
            </Button>
          )}
          <CloseButton label="Close this notice" onClick={onDismiss} />
        </div>
      )}
      {refusal?.details && expanded && (
        <div id={detailsId} class="pk-agenda-refusal__details">
          <LazyAgendaConflictDetails details={refusal.details} snapshot={snapshot} retryNote={false} />
        </div>
      )}
    </div>
  );
}

import { Button } from "../../../../../../ui/Button";
import type { AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import type { AgendaSessionEditor } from "../../../../../../site/AgendaSession";
import { agendaCardActions } from "./session-actions";
import { RowActions, type RowActionsProps } from "../../../../../../ui/RowActions";
import type { useAgendaTargetSelection } from "./useAgendaTargetSelection";
import type { useAgendaScheduling } from "./useAgendaScheduling";

/** Editing affordances sit on the shared session card without changing its public content. */
export function agendaSessionInteractions({
  occurrence,
  canEdit,
  canReview,
  locked,
  busy,
  target,
  scheduling,
  cancelProposal,
  actions,
}: {
  occurrence: AgendaOccurrence;
  canEdit: boolean;
  canReview: boolean;
  locked: boolean;
  busy: boolean;
  target: ReturnType<typeof useAgendaTargetSelection>;
  scheduling: ReturnType<typeof useAgendaScheduling>;
  cancelProposal: () => void;
  actions: (close?: () => void) => RowActionsProps["actions"];
}): AgendaSessionEditor {
  return {
    resizeHandle:
      canEdit && !locked ? (
        <>
          <button
            class="pk-agenda-editor__resize pk-agenda-editor__resize--start"
            type="button"
            disabled={busy}
            data-agenda-resize-edge="start"
            aria-label={`Resize ${occurrence.title} by dragging its top edge to a start time`}
            onKeyDown={(event) => {
              if (occurrence.startAt && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                event.preventDefault();
                event.stopPropagation();
                scheduling.resizeStart(
                  occurrence.id,
                  new Date(
                    Date.parse(occurrence.startAt) + (event.key === "ArrowUp" ? -1 : 1) * scheduling.timeStep * 60000,
                  ).toISOString(),
                  occurrence.roomId ?? "",
                );
              }
            }}
          >
            <span class="pk-sr-only">Resize start time</span>
          </button>
          <button
            data-agenda-resize-edge="end"
            class="pk-agenda-editor__resize"
            type="button"
            disabled={busy}
            aria-label={`Resize ${occurrence.title} by dragging its bottom edge to an end time`}
            onClick={() => {
              cancelProposal();
              target.select(occurrence.id, "resize");
            }}
          >
            <span class="pk-sr-only">Resize duration</span>
          </button>
        </>
      ) : null,
    controls:
      canEdit || canReview ? (
        <div class="pk-agenda-editor__card-actions">
          <RowActions subject={occurrence.title} actions={agendaCardActions(actions())} />
        </div>
      ) : null,
    onRoomChange: canEdit
      ? () =>
          actions()
            .find((action) => action.id === "locations")
            ?.onSelect?.()
      : undefined,
    moveControls:
      canEdit && !locked && occurrence.startAt ? (
        <div
          class="pk-cluster"
          data-agenda-card-control
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {([-1, 1] as const).map((direction) => (
            <Button
              variant="ghost"
              icon
              disabled={locked || busy || !scheduling.canMoveRoom(occurrence.id, direction)}
              aria-label={`Move ${occurrence.title} ${direction === -1 ? "left" : "right"}`}
              onClick={() => scheduling.moveRoom(occurrence.id, direction)}
            >
              {direction === -1 ? "←" : "→"}
            </Button>
          ))}
          {([-1, 1] as const).map((direction) => (
            <Button
              variant="ghost"
              icon
              disabled={locked || busy || !scheduling.canMoveAdjacent(occurrence.id, direction)}
              aria-label={`Move ${occurrence.title} ${direction === -1 ? "earlier" : "later"}`}
              onClick={() => scheduling.moveAdjacent(occurrence.id, direction)}
            >
              {direction === -1 ? "↑" : "↓"}
            </Button>
          ))}
        </div>
      ) : null,
    detailControls: (close) => <RowActions subject={occurrence.title} actions={agendaCardActions(actions(close))} />,
    onDurationChange:
      canEdit && !locked && occurrence.startAt
        ? (minutes) => scheduling.setDuration(occurrence.id, minutes)
        : undefined,
    durationDisabled: locked || busy,
    durationOptions: scheduling.durationOptions,
  };
}
